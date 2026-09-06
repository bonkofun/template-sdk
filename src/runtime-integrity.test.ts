import { describe, expect, it } from "vitest";
import { parseRuntimeIntegrity } from "./submission.js";
const assets = { cover: { path: "assets/cover.png", kind: "image" as const } };
const resource = { sha256: "a".repeat(64), byteSize: 10, contentType: "image/png" };
describe("server-derived runtime integrity", () => {
  it("copies exact logical IDs and bounded descriptors", () => {
    const input = { cover: { ...resource } };
    const result = parseRuntimeIntegrity(assets, input);
    expect(result).toEqual(input); expect(result.cover).not.toBe(input.cover);
  });
  it.each([{}, { cover: resource, extra: resource }, { cover: { ...resource, url: "https://evil.example" } },
    { cover: { ...resource, contentType: "audio/mpeg" } }, { cover: { ...resource, sha256: "bad" } },
    { cover: { ...resource, byteSize: 0 } }, { cover: { ...resource, byteSize: 26 * 1024 * 1024 } }])("rejects missing, extra or invalid metadata", input => {
    expect(() => parseRuntimeIntegrity(assets, input)).toThrow();
  });
});
