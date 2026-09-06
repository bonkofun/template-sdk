import { afterEach, describe, expect, it, vi } from "vitest";
import { connectStandaloneTemplate, type RuntimePresentation, type StandaloneTemplate, type StaticPresentation } from "./runtime-client.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(template: StandaloneTemplate) {
  const listeners = new Map<string, (event: unknown) => void>();
  const parent = { postMessage: vi.fn() };
  const channel = "a".repeat(32), origin = "https://host.example";
  vi.stubGlobal("window", {
    location: { href: `https://runtime.example/v3/${"b".repeat(64)}?parent=${encodeURIComponent(origin)}#${channel}` },
    parent,
    addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const dispose = connectStandaloneTemplate(template);
  const send = (body: Record<string, unknown>) => listeners.get("message")?.({ source: parent, origin, data: { protocol: 3, channel, ...body } });
  const init = (staticReason?: string) => send({ type: "init", state: "ready", reducedMotion: false, staticReason,
    content: { recipientName: "Alex", message: "Hello <text>", senderName: "", photoTransform: "translate(0px, 0px) scale(1)", photo: { bytes: new Uint8Array([1]).buffer, mime: "image/png" } },
    config: { accent: "blue" }, assets: {},
  });
  const types = () => parent.postMessage.mock.calls.map(([message]) => message.type);
  return { dispose, send, init, types, listeners };
}
describe("authored static presentation bridge", () => {
  it("renders static directly without starting interactive code or reporting natural completion", async () => {
    const render = vi.fn(), dispose = vi.fn(), cleanup = vi.fn();
    const renderStatic = vi.fn((_presentation: StaticPresentation) => cleanup);
    const s = setup({ render, dispose, renderStatic });
    s.init("reduced-motion");
    await Promise.resolve();
    expect(render).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    const presentation = renderStatic.mock.calls[0]?.[0];
    expect(presentation).toMatchObject({ reason: "reduced-motion", reducedMotion: true, content: { message: "Hello <text>" } });
    expect(presentation).not.toHaveProperty("runtime");
    expect(s.types()).toEqual(["audio-stop", "static-ready"]);
    s.dispose(); s.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(s.listeners.size).toBe(0);
  });
  it("cleans interactive resources once and suppresses retained controls after static transition", async () => {
    let saved!: RuntimePresentation;
    const render = vi.fn((p: RuntimePresentation) => { saved = p; });
    const dispose = vi.fn(), renderStatic = vi.fn();
    const s = setup({ render, dispose, renderStatic });
    s.init();
    s.send({ type: "static", reason: "skip" });
    s.send({ type: "static", reason: "natural" });
    s.send({ type: "state", state: "running", mode: "running" });
    saved.runtime.complete(); saved.runtime.report("running");
    saved.runtime.audio.tone(440, 100); await saved.runtime.audio.play("cue");
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderStatic).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(s.types()).toEqual(["ready", "audio-stop", "static-ready"]);
    s.dispose();
  });
  it("cleans an asynchronously committed static view after the host has already disposed", async () => {
    let finish!: (cleanup: () => void) => void;
    const cleanup = vi.fn();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const s = setup({ render() {}, dispose() {}, renderStatic: () => new Promise(resolve => { finish = resolve; }) });
    s.init("preview"); s.dispose(); finish(cleanup);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(s.types()).not.toContain("static-ready");
  });
  it("reports missing or rejected static entries instead of pretending the fallback rendered", async () => {
    for (const renderStatic of [undefined, async () => { throw new Error("Broken static view"); }]) {
      const s = setup({ render() {}, dispose() {}, renderStatic });
      s.init("preview");
      await Promise.resolve();
      expect(s.types()).toContain("error");
      expect(s.types()).not.toContain("static-ready");
      expect(s.listeners.size).toBe(0);
    }
  });
});
