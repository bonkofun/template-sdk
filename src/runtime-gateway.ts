import { createRuntimeDocument } from "./runtime-document.js";

/** Minimal R2 read binding; gateway has no database or main application identity. */
export interface RuntimeObjectStore {
  get(
    key: string,
  ): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}
export interface RuntimeGatewayEnvironment {
  store: RuntimeObjectStore;
  parentOrigins: readonly string[];
  previewSecret: string;
}
const digestPattern = /^[a-f0-9]{64}$/;
/** Strict shared configuration: no paths, wildcard parents, credentials or same-origin runtime. */
export function parseRuntimeOrigins(runtime: unknown, parents: unknown, allowLocal = false) {
  function origin(input: unknown) {
    if (typeof input !== "string") throw new Error("Missing runtime origin");
    const url = new URL(input);
    const local = allowLocal && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.origin !== input || url.hostname.includes("*") || (url.protocol !== "https:" && !local)) throw new Error("Invalid runtime origin");
    return url.origin;
  }
  const runtimeOrigin = origin(runtime);
  const values: unknown = typeof parents === "string" ? JSON.parse(parents) : parents;
  if (!Array.isArray(values) || !values.length || values.length > 8) throw new Error("Invalid runtime parents");
  const parentOrigins = values.map(origin);
  if (new Set(parentOrigins).size !== parentOrigins.length || parentOrigins.includes(runtimeOrigin)) throw new Error("Runtime must have a separate origin");
  if (runtimeOrigin.startsWith("http:") && parentOrigins.some(parent => !parent.startsWith("http:"))) throw new Error("Local runtime requires local parents");
  return { runtimeOrigin, parentOrigins };
}
const encode = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
async function signingKey(secret: string) {
  if (secret.length < 32)
    throw new Error("Preview signing secret is not configured");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function createRuntimePreviewToken(
  secret: string,
  digest: string,
  now = Date.now(),
) {
  if (!digestPattern.test(digest)) throw new Error("Invalid runtime digest");
  const expires = Math.floor(now / 1000) + 300;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(`bonko-runtime-preview-v3:${digest}:${expires}`),
  );
  return `${expires}.${encode(signature)}`;
}
export async function verifyRuntimePreviewToken(
  secret: string,
  digest: string,
  token: string,
  now = Date.now(),
) {
  if (!digestPattern.test(digest) || !/^\d{10}\.[a-zA-Z0-9_-]{43}$/.test(token))
    return false;
  const [expiration, signature] = token.split(".");
  const expires = Number(expiration);
  const current = Math.floor(now / 1000);
  if (expires <= current || expires > current + 300) return false;
  const bytes = Uint8Array.from(
    atob(signature.replaceAll("-", "+").replaceAll("_", "/") + "="),
    (c) => c.charCodeAt(0),
  );
  return crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    bytes,
    new TextEncoder().encode(`bonko-runtime-preview-v3:${digest}:${expires}`),
  );
}
const unavailable = (status: number) =>
  new Response("Runtime unavailable", {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
/** Only this trusted gateway wraps code; the template cannot set its headers. */
export async function serveRuntimeDocument(
  request: Request,
  env: RuntimeGatewayEnvironment,
) {
  try {
    if (request.method !== "GET" && request.method !== "HEAD")
      return unavailable(405);
    const url = new URL(request.url);
    const match = /^\/v3\/([a-f0-9]{64})$/.exec(url.pathname);
    const parent = url.searchParams.get("parent");
    if (
      !match ||
      !parent ||
      !env.parentOrigins.includes(parent) ||
      url.origin === parent
    )
      return unavailable(404);
    if (
      [...url.searchParams.keys()].some(
        (key) => !["parent", "preview"].includes(key),
      ) ||
      url.searchParams.getAll("parent").length !== 1 ||
      url.searchParams.getAll("preview").length > 1
    )
      return unavailable(404);
    const digest = match[1];
    const token = url.searchParams.get("preview");
    if (token !== null) {
      if (!(await verifyRuntimePreviewToken(env.previewSecret, digest, token)))
        return unavailable(404);
    } else {
      // Written only after database approval; archived versions retain this marker.
      const marker = await env.store.get(`runtime/published/${digest}.json`);
      if (!marker || marker.size > 1024) return unavailable(404);
      const record = JSON.parse(
        new TextDecoder().decode(await marker.arrayBuffer()),
      );
      if (record?.protocol !== 3 || record?.digest !== digest)
        return unavailable(404);
    }
    const object = await env.store.get(
      `runtime/packages/${digest}/document.json`,
    );
    if (!object || object.size > 9 * 1024 * 1024) return unavailable(404);
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength !== object.size) return unavailable(503);
    const content: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !content ||
      typeof content !== "object" ||
      !("script" in content) ||
      typeof content.script !== "string" ||
      ("stylesheet" in content && typeof content.stylesheet !== "string") ||
      Object.keys(content).some(
        (key) => !["script", "stylesheet"].includes(key),
      )
    )
      return unavailable(503);
    const document = await createRuntimeDocument({
      script: content.script,
      stylesheet:
        "stylesheet" in content ? (content.stylesheet as string) : undefined,
      parentOrigin: parent,
    });
    return new Response(request.method === "HEAD" ? null : document.html, {
      headers: document.headers,
    });
  } catch {
    // Never disclose object keys, code, signed preview tokens or infrastructure errors.
    return unavailable(503);
  }
}
