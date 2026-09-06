import { LIMITS } from "../protocol/protocol.js";
import { validateRuntimeContent, type RuntimeContent } from "../protocol/runtime-messages.js";
import type { RuntimeFrameData } from "../react/runtime-react.js";

export interface RuntimeAssetSource {
  /** URL is resolved by trusted host code, never supplied by template code. */
  url: string;
  mime: string;
  byteSize: number;
  sha256: string;
}
export interface RuntimeAssetLoad {
  content: Omit<RuntimeContent, "photo">;
  /** Local preview files can be passed as bytes without uploading a test photo. */
  photo: RuntimeContent["photo"] | { url: string; mime?: "image/png" | "image/jpeg" | "image/webp" };
  assets: Record<string, RuntimeAssetSource>;
  config: RuntimeFrameData["config"];
  hasSound: boolean;
  /** Exact trusted origins from the host's deployment configuration. */
  allowedOrigins: readonly string[];
}
const images = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const audio = new Set(["audio/mpeg", "audio/ogg"]);
const photoLimit = 10 * 1024 * 1024;

function trustedUrl(value: string, origins: readonly string[], allowBlob = false) {
  const url = new URL(value);
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:" && !(allowBlob && url.protocol === "blob:")) || url.username || url.password || url.hash || !origins.includes(url.origin))
    throw new Error("Invalid runtime asset origin");
  return url.href;
}

async function read(source: { url: string; mime?: string; byteSize?: number; sha256?: string }, limit: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await fetch(source.url, { signal, redirect: "error", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Runtime asset unavailable");
  let complete = false;
  try {
    const length = response.headers.get("content-length");
    const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!response.ok || (source.mime ? mime !== source.mime : !["image/png", "image/jpeg", "image/webp"].includes(mime ?? "")) ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))) throw new Error("Invalid runtime asset response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new Error("Runtime asset exceeds size limit");
      chunks.push(result.value);
    }
    signal.throwIfAborted();
    if (!size || (source.byteSize !== undefined && source.byteSize !== size)) throw new Error("Runtime asset size mismatch");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (source.sha256) {
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
      if (digest !== source.sha256) throw new Error("Runtime asset digest mismatch");
    }
    complete = true;
    return { bytes: bytes.buffer, mime: mime! };
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Bounded host-side fetch; the child receives image bytes, never storage URLs. */
export async function loadRuntimeAssets(input: RuntimeAssetLoad, signal: AbortSignal): Promise<RuntimeFrameData> {
  signal.throwIfAborted();
  const entries = Object.entries(input.assets);
  if (entries.length > 100) throw new Error("Too many runtime assets");
  let total = 0;
  const sources = entries.map(([id, source]) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || (!images.has(source.mime) && !audio.has(source.mime)) ||
      !Number.isSafeInteger(source.byteSize) || source.byteSize < 1 || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid runtime asset descriptor");
    total += source.byteSize;
    return { ...source, id, url: trustedUrl(source.url, input.allowedOrigins) };
  });
  if (total > LIMITS.expanded) throw new Error("Runtime assets exceed total size limit");
  const photo = "url" in input.photo ? { ...input.photo, url: trustedUrl(input.photo.url, input.allowedOrigins, true) } : input.photo;
  if ("bytes" in photo) validateRuntimeContent({ ...input.content, photo });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) abort.abort();
  const results: { id: string; mime: string; bytes: ArrayBuffer }[] = [];
  let photoBytes: ArrayBuffer | undefined = "bytes" in photo ? photo.bytes : undefined;
  let photoMime: string | undefined = photo.mime;
  let cursor = 0;
  // Photo participates in the same four-request concurrency budget.
  const jobs = [...("url" in photo ? [async () => { const result = await read(photo, photoLimit, abort.signal); photoBytes = result.bytes; photoMime = result.mime; }] : []), ...sources.map(source => async () => {
    results.push({ id: source.id, ...(await read(source, source.byteSize, abort.signal)) });
  })];
  const urls: string[] = [];
  const dispose = () => { for (const url of urls.splice(0)) URL.revokeObjectURL(url); };
  try {
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length) { abort.signal.throwIfAborted(); await jobs[cursor++](); }
    }).map(worker => worker.catch(error => { abort.abort(); throw error; })));
    signal.throwIfAborted();
    if (photoMime !== "image/png" && photoMime !== "image/jpeg" && photoMime !== "image/webp") throw new Error("Invalid runtime photo MIME");
    const content = validateRuntimeContent({ ...input.content, photo: { bytes: photoBytes!, mime: photoMime } });
    const imageAssets: RuntimeFrameData["images"] = Object.create(null);
    const audioAssets: RuntimeFrameData["audio"] = Object.create(null);
    for (const resource of results) {
      if (images.has(resource.mime)) imageAssets[resource.id] = { bytes: resource.bytes, mime: resource.mime };
      else if (input.hasSound) {
        const url = URL.createObjectURL(new Blob([resource.bytes], { type: resource.mime }));
        urls.push(url);
        audioAssets[resource.id] = url;
      }
    }
    return { content, config: input.config, images: imageAssets, audio: audioAssets, hasSound: input.hasSound, dispose };
  } catch (error) {
    abort.abort();
    dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
