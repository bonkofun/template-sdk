import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRuntimeAssets, type RuntimeAssetLoad } from "./runtime-assets.js";

const bytes = new Uint8Array([1, 2, 3]);
const digest = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const fixture = (): RuntimeAssetLoad => ({
  content: { recipientName: "Alex", message: "Hello", senderName: "", photoTransform: "translate(0px, 0px) scale(1)" },
  photo: { url: "https://main.example/photo", mime: "image/png" },
  assets: { cover: { url: "https://assets.example/cover", mime: "image/png", byteSize: 3, sha256: digest },
    sound: { url: "https://assets.example/sound", mime: "audio/mpeg", byteSize: 3, sha256: digest } },
  allowedOrigins: ["https://main.example", "https://assets.example"], config: {}, hasSound: true,
});
function mockFetch() {
  return vi.fn(async (url: string) => new Response(bytes, { headers: { "content-type": url.endsWith("sound") ? "audio/mpeg" : "image/png" } }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("host runtime asset loader", () => {
  it("verifies bytes and exposes only image buffers and managed audio blob URLs", async () => {
    const fetcher = mockFetch(); vi.stubGlobal("fetch", fetcher);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const data = await loadRuntimeAssets(fixture(), new AbortController().signal);
    expect(new Uint8Array(data.content.photo.bytes)).toEqual(bytes);
    expect(new Uint8Array(data.images.cover.bytes)).toEqual(bytes);
    expect(data.audio.sound).toMatch(/^blob:/);
    expect(fetcher.mock.calls.length).toBe(3);
    data.dispose?.(); data.dispose?.(); expect(revoke).toHaveBeenCalledTimes(1);
  });
  it("rejects untrusted URLs and excessive totals before fetching", async () => {
    const fetcher = mockFetch(); vi.stubGlobal("fetch", fetcher);
    const input = fixture(); input.assets.cover.url = "https://evil.example/a";
    await expect(loadRuntimeAssets(input, new AbortController().signal)).rejects.toThrow("origin");
    input.assets.cover.url = "https://assets.example/a"; input.assets.cover.byteSize = 26 * 1024 * 1024;
    await expect(loadRuntimeAssets(input, new AbortController().signal)).rejects.toThrow("total");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["mime", "digest", "size"])("rejects a %s mismatch without creating audio URLs", async kind => {
    vi.stubGlobal("fetch", mockFetch()); const create = vi.spyOn(URL, "createObjectURL");
    const input = fixture();
    if (kind === "mime") input.assets.cover.mime = "image/webp";
    if (kind === "digest") input.assets.cover.sha256 = "a".repeat(64);
    if (kind === "size") input.assets.cover.byteSize = 2;
    await expect(loadRuntimeAssets(input, new AbortController().signal)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("cancels an oversized streaming body even without Content-Length", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); }, cancel }), { headers: { "content-type": "image/png" } })));
    const input = fixture(); input.assets = {};
    await expect(loadRuntimeAssets(input, new AbortController().signal)).rejects.toThrow("size limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not start requests for an already cancelled preview", async () => {
    const fetcher = mockFetch(); vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController(); abort.abort();
    await expect(loadRuntimeAssets(fixture(), abort.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps local preview photos in memory and never uploads them", async () => {
    const fetcher = mockFetch(); vi.stubGlobal("fetch", fetcher);
    const input = fixture(); input.assets = {}; input.photo = { bytes: bytes.buffer, mime: "image/png" };
    const result = await loadRuntimeAssets(input, new AbortController().signal);
    expect(result.content.photo.bytes).toEqual(bytes.buffer);
    expect(fetcher).not.toHaveBeenCalled(); result.dispose?.();
  });
  it("detects approved photo MIME and permits only same-host preview blobs", async () => {
    const fetcher = mockFetch(); vi.stubGlobal("fetch", fetcher);
    const input = fixture(); input.assets = {}; input.photo = { url: "blob:https://main.example/preview" };
    const result = await loadRuntimeAssets(input, new AbortController().signal);
    expect(result.content.photo.mime).toBe("image/png"); result.dispose?.();
    input.photo = { url: "blob:https://evil.example/preview" };
    await expect(loadRuntimeAssets(input, new AbortController().signal)).rejects.toThrow("origin");
  });
  it("limits concurrency to four and stops queued requests after cancellation", async () => {
    const abort = new AbortController(); const signals: AbortSignal[] = [];
    const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = options.signal!; signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const input = fixture();
    input.assets = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`asset-${index}`, input.assets.cover]));
    const result = loadRuntimeAssets(input, abort.signal);
    expect(fetcher).toHaveBeenCalledTimes(4);
    abort.abort();
    await expect(result).rejects.toThrow();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
