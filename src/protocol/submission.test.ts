import { describe, expect, it } from "vitest";
import {
  normalizeTags,
  parseTemplateCategory,
  parseTemplateSubmission,
  RUNTIME_SDK_VERSION,
} from "./submission.js";
import { inspectRuntimeBundle, packRuntimeBundle } from "../packaging/runtime-bundle.js";
import { writeZip } from "../packaging/node.js";

function manifest() {
  return {
    protocol: 3,
    sdkVersion: RUNTIME_SDK_VERSION,
    slug: "letter",
    version: "1.0",
    name: "A letter",
    description: "A personal letter",
    author: "Bonko Studio",
    templateType: "interactive",
    access: "free",
    tags: ["Letter"],
    cover: "cover",
    assets: { cover: { path: "assets/cover.png", kind: "image" } },
    entry: "runtime/entry.js",
    capabilities: [],
    config: {},
    sample: { recipientName: "Alex", message: "For you", senderName: "" },
    messagePresets: ["For you"],
    posterStyle: {
      background: "#ffffff",
      foreground: "#222222",
      accent: "#ff6633",
    },
  };
}
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    "manifest.json": Buffer.from(
      JSON.stringify({ ...manifest(), ...overrides }),
    ),
    "LICENSE.md": Buffer.from("Original synthetic test assets."),
    "runtime/entry.js": Buffer.from(
      'globalThis.testEntry = "This file is never executed by validation";',
    ),
    "source/entry.ts": Buffer.from("export const fixture = true;"),
    "source/dependencies.json": Buffer.from('{"react":"19.2.8"}'),
    // Signature-only fixture; the server's media decoder is tested separately.
    "assets/cover.png": Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  };
}
describe("administrator-owned classification and creator tags", () => {
  it("normalizes, removes empty tags and deduplicates without creating categories", () => {
    expect(
      normalizeTags([" Ｌｅｔｔｅｒ ", "letter", "  ", "感谢", "感谢"]),
    ).toEqual(["Letter", "感谢"]);
    expect(normalizeTags(["🎉".repeat(20)])).toEqual(["🎉".repeat(20)]);
  });
  it.each([
    ["a", "b", "c", "d", "e", "f"],
    ["a".repeat(21)],
    ["<script>"],
    ["a\nb"],
    [null],
  ])("rejects invalid tags %j", (...tags) => {
    expect(() => normalizeTags(tags)).toThrow();
  });
  it.each(["birthday", "anniversary", "pets", "achievement", "everyday"])(
    "accepts fixed category %s",
    (value) => {
      expect(parseTemplateCategory(value)).toBe(value);
    },
  );
  it.each(["pet", "custom-category", "__proto__", "constructor", null, ""])(
    "rejects unknown or missing category %s",
    (value) => {
      expect(() => parseTemplateCategory(value)).toThrow();
    },
  );
  it.each([
    "category",
    "categoryCode",
    "occasion",
    "status",
    "reviewed",
    "price",
  ])("does not trust creator-controlled %s", (key) => {
    expect(() =>
      parseTemplateSubmission({ ...manifest(), [key]: "approved" }),
    ).toThrow();
  });
});
describe("standalone runtime package contract", () => {
  it("parses complete packages without executing submitted code", () => {
    const bytes = packRuntimeBundle(fixture());
    const bundle = inspectRuntimeBundle(bytes);
    expect(bundle.submission.author).toBe("Bonko Studio");
    expect(bundle.submission.access).toBe("free");
    expect(bundle.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.runtimeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect("testEntry" in globalThis).toBe(false);
    expect(packRuntimeBundle(fixture())).toEqual(bytes);
  });
  it.each([
    { protocol: 4 },
    { sdkVersion: "latest" },
    { version: "1.1" },
    { access: "paid" },
    { author: "" },
    { entry: "https://example.invalid/code.js" },
    { stylesheet: "assets/style.css" },
    { cover: "missing" },
    { tags: ["x".repeat(21)] },
    { capabilities: ["network"] },
    { assets: { cover: { path: "../cover.png", kind: "image" } } },
    { assets: { cover: { path: "assets/cover.svg", kind: "image" } } },
    { config: { source: "https://example.invalid" } },
    {
      sample: { recipientName: "A".repeat(31), message: "Hi", senderName: "" },
    },
  ])("rejects invalid manifest %j", (overrides) => {
    expect(() => packRuntimeBundle(fixture(overrides))).toThrow();
  });
  it.each([
    "index.html",
    "install.sh",
    "package.json",
    "assets/nested.zip",
    "runtime/extra.js",
    "fixtures/user-photo.png",
  ])("rejects unexpected %s", (name) => {
    expect(() =>
      packRuntimeBundle({ ...fixture(), [name]: Buffer.from("unapproved") }),
    ).toThrow();
  });
  it("requires real audit source and pinned dependency disclosure", () => {
    const { "source/entry.ts": _source, ...files } = fixture();
    expect(() => packRuntimeBundle(files)).toThrow("Audit source");
    expect(() =>
      packRuntimeBundle({
        ...fixture(),
        "source/dependencies.json": Buffer.from('{"react":"^19.2.8"}'),
      }),
    ).toThrow("fixed versions");
  });
  it("rejects tampering and additional inventory fields", () => {
    const original = inspectRuntimeBundle(packRuntimeBundle(fixture()));
    expect(() =>
      inspectRuntimeBundle(
        writeZip({
          ...original.files,
          "runtime/entry.js": Buffer.from("changed"),
        }),
      ),
    ).toThrow("digest");
    const inventory = JSON.parse(original.files["bundle.json"].toString());
    expect(() =>
      inspectRuntimeBundle(
        writeZip({
          ...original.files,
          "bundle.json": Buffer.from(
            JSON.stringify({ ...inventory, approved: true }),
          ),
        }),
      ),
    ).toThrow("inventory");
  });
  it("requires declared audio capability and a packaged image cover", () => {
    expect(() =>
      parseTemplateSubmission({
        ...manifest(),
        assets: { cover: { kind: "audio", path: "assets/sound.mp3" } },
      }),
    ).toThrow();
  });
});
