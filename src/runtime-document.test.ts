import { describe, expect, it } from "vitest";
import { createRuntimeDocument, scriptIntegrity } from "./runtime-document.js";

describe("host-owned isolated runtime document", () => {
  it("hash-pins one script and denies ambient browser capabilities", async () => {
    const script = "globalThis.example = true;";
    const document = await createRuntimeDocument({
      script,
      parentOrigin: "https://bonko.fun",
    });
    expect(document.headers["Content-Security-Policy"]).toContain(
      `script-src '${await scriptIntegrity(script)}'`,
    );
    for (const directive of [
      "connect-src 'none'",
      "media-src 'none'",
      "worker-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "sandbox allow-scripts",
      "frame-ancestors https://bonko.fun",
    ])
      expect(document.headers["Content-Security-Policy"]).toContain(directive);
    expect(document.headers["Content-Security-Policy"]).not.toContain(
      "allow-same-origin",
    );
    expect(document.headers["Content-Security-Policy"]).not.toContain(
      "unsafe-eval",
    );
    expect(document.html).toContain('<div id="root"></div>');
    expect(document.headers["Referrer-Policy"]).toBe("no-referrer");
  });
  it.each([
    '</script><img src="https://example.invalid">',
    "<!-- hidden",
    '"</ScRiPt>"',
    "\u0000",
  ])("rejects HTML breakout %s", async (script) => {
    await expect(
      createRuntimeDocument({ script, parentOrigin: "https://bonko.fun" }),
    ).rejects.toThrow();
  });
  it.each([
    "https://bonko.fun/path",
    "http://bonko.fun",
    "https://user:pass@bonko.fun",
    "https://bonko.fun; unsafe-inline",
    "null",
  ])("rejects invalid parent origin %s", async (parentOrigin) => {
    await expect(
      createRuntimeDocument({ script: "void 0;", parentOrigin }),
    ).rejects.toThrow();
  });
  it("blocks style terminators and unbounded bundle input", async () => {
    await expect(
      createRuntimeDocument({
        script: "void 0;",
        stylesheet: "</style><script>bad()</script>",
        parentOrigin: "https://bonko.fun",
      }),
    ).rejects.toThrow();
    await expect(
      createRuntimeDocument({
        script: "x".repeat(8 * 1024 * 1024 + 1),
        parentOrigin: "https://bonko.fun",
      }),
    ).rejects.toThrow();
  });
});
