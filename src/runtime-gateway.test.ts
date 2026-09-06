import { describe, expect, it } from "vitest";
import {
  createRuntimePreviewToken,
  serveRuntimeDocument,
  verifyRuntimePreviewToken,
  type RuntimeGatewayEnvironment,
  parseRuntimeOrigins,
} from "./runtime-gateway.js";
const digest = "a".repeat(64);
const secret = "s".repeat(48);
function environment(published = false): RuntimeGatewayEnvironment {
  const files: Record<string, string> = {
    [`runtime/packages/${digest}/document.json`]: JSON.stringify({
      script: "globalThis.fixture = true;",
    }),
  };
  if (published)
    files[`runtime/published/${digest}.json`] = JSON.stringify({
      digest,
      protocol: 3,
    });
  return {
    previewSecret: secret,
    parentOrigins: ["https://bonko.fun"],
    store: {
      async get(key) {
        if (!Object.hasOwn(files, key)) return null;
        const bytes = new TextEncoder().encode(files[key]);
        return {
          size: bytes.byteLength,
          async arrayBuffer() {
            return bytes.buffer;
          },
        };
      },
    },
  };
}
const request = (query = "", method = "GET") =>
  new Request(
    `https://runtime.example/v3/${digest}?parent=https%3A%2F%2Fbonko.fun${query}`,
    { method },
  );
describe("R2 runtime gateway authorization", () => {
  it("validates shared origin configuration and explicit local development", () => {
    expect(parseRuntimeOrigins("https://runtime.example", '["https://bonko.fun"]')).toEqual({ runtimeOrigin: "https://runtime.example", parentOrigins: ["https://bonko.fun"] });
    expect(parseRuntimeOrigins("http://127.0.0.1:8787", ["http://localhost:3000"], true).parentOrigins).toHaveLength(1);
    expect(() => parseRuntimeOrigins("https://runtime.example", ["https://*.example"])).toThrow();
    for (const [runtime, parents] of [["https://bonko.fun", ["https://bonko.fun"]], ["https://runtime.example/path", ["https://bonko.fun"]], ["https://runtime.example", ["*"]], ["https://runtime.example", []], ["http://127.0.0.1:8787", ["https://bonko.fun"]]]) expect(() => parseRuntimeOrigins(runtime, parents)).toThrow();
  });
  it("keeps unapproved packages private", async () => {
    expect((await serveRuntimeDocument(request(), environment())).status).toBe(
      404,
    );
  });
  it("serves approved immutable code with host-owned security headers", async () => {
    const response = await serveRuntimeDocument(request(), environment(true));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "sandbox allow-scripts",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toContain("globalThis.fixture = true;");
  });
  it("allows short-lived preview capabilities without publication", async () => {
    const token = await createRuntimePreviewToken(secret, digest);
    expect(
      (await serveRuntimeDocument(request(`&preview=${token}`), environment()))
        .status,
    ).toBe(200);
    expect(
      (
        await serveRuntimeDocument(
          request("&preview=forged"),
          environment(true),
        )
      ).status,
    ).toBe(404);
  });
  it("binds capabilities to digest, expiration and secret", async () => {
    const now = 1_788_000_000_000;
    const token = await createRuntimePreviewToken(secret, digest, now);
    expect(await verifyRuntimePreviewToken(secret, digest, token, now)).toBe(
      true,
    );
    expect(
      await verifyRuntimePreviewToken(secret, "b".repeat(64), token, now),
    ).toBe(false);
    expect(
      await verifyRuntimePreviewToken("x".repeat(48), digest, token, now),
    ).toBe(false);
    expect(
      await verifyRuntimePreviewToken(secret, digest, token, now + 300_000),
    ).toBe(false);
    expect(
      await verifyRuntimePreviewToken(secret, digest, token, now - 1000),
    ).toBe(false);
  });
  it.each([
    "&parent=https://evil.invalid",
    "&unexpected=true",
    "&preview=a&preview=b",
  ])("rejects ambiguous parameters %s", async (query) => {
    expect(
      (await serveRuntimeDocument(request(query), environment(true))).status,
    ).toBe(404);
  });
  it("never permits same-origin runtime hosting or arbitrary parents", async () => {
    const sameOrigin = new Request(
      `https://bonko.fun/v3/${digest}?parent=https%3A%2F%2Fbonko.fun`,
    );
    expect(
      (await serveRuntimeDocument(sameOrigin, environment(true))).status,
    ).toBe(404);
    expect(
      (
        await serveRuntimeDocument(request(), {
          ...environment(true),
          parentOrigins: [],
        })
      ).status,
    ).toBe(404);
  });
  it("returns safe failures and rejects mutation methods", async () => {
    expect(
      (await serveRuntimeDocument(request("", "POST"), environment(true)))
        .status,
    ).toBe(405);
    const response = await serveRuntimeDocument(request(), {
      ...environment(),
      store: {
        async get() {
          throw new Error("secret infrastructure detail");
        },
      },
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Runtime unavailable");
  });
});
