import { describe, expect, it, vi } from "vitest";
import { RuntimeHost, STATIC_COMMIT_MS } from "./runtime-host.js";
function setup() {
  let now = 0,
    sequence = 0;
  const source = {};
  const audio = {
    unlock: vi.fn(),
    stop: vi.fn(),
    silence: vi.fn(),
    play: vi.fn(async () => {}),
    tone: vi.fn(),
  };
  const post = vi.fn(),
    complete = vi.fn();
  const host = new RuntimeHost({
    channel: "a".repeat(32),
    source,
    post,
    audio,
    audioAssets: { cue: "blob:trusted-audio" },
    hasSound: true,
    muted: false,
    changed: vi.fn(),
    complete,
    clock: () => now,
  });
  const send = (
    body: Record<string, unknown>,
    otherSource = source,
    origin = "null",
  ) =>
    host.receive(
      { protocol: 3, channel: "a".repeat(32), sequence: sequence++, ...body },
      otherSource,
      origin,
    );
  return {
    host,
    audio,
    post,
    complete,
    send,
    advance: (ms: number) => {
      now += ms;
      host.tick();
    },
  };
}
describe("host-authoritative isolated playback", () => {
  it("waits for the exact static acknowledgment and ignores subsequent playback requests", () => {
    const s = setup();
    s.send({ type: "ready" }); s.host.start();
    s.host.presentStatic("skip");
    expect(s.host.staticState).toBe("pending");
    expect(s.complete).toHaveBeenCalledExactlyOnceWith("skip");
    expect(s.post).toHaveBeenLastCalledWith({ protocol: 3, channel: "a".repeat(32), type: "static", reason: "skip" });
    s.send({ type: "static-ready" }, {});
    s.send({ type: "static-ready" }, undefined, "https://runtime.example");
    s.send({ type: "ready" });
    expect(s.host.staticState).toBe("pending");
    s.send({ type: "audio-tone", frequency: 440, durationMs: 100 });
    s.send({ type: "audio-play", asset: "cue" });
    s.send({ type: "complete" });
    s.host.setMuted(false); s.host.start();
    expect(s.host.muted).toBe(true);
    expect(s.audio.unlock).toHaveBeenCalledTimes(1);
    expect(s.audio.play).not.toHaveBeenCalled();
    expect(s.audio.tone).not.toHaveBeenCalled();
    s.send({ type: "static-ready" });
    s.send({ type: "static-ready" });
    expect(s.host.staticState).toBe("ready");
    s.host.presentStatic("natural");
    expect(s.host.staticReason).toBe("skip");
    expect(s.complete).toHaveBeenCalledTimes(1);
  });
  it("supports direct static preview without a reveal completion or audio unlock", () => {
    const s = setup();
    s.host.presentStatic("preview", false);
    expect(s.post).not.toHaveBeenCalled();
    s.host.start(); s.host.setMuted(false);
    s.send({ type: "static-ready" });
    expect(s.host.staticState).toBe("ready");
    expect(s.audio.unlock).not.toHaveBeenCalled();
    expect(s.complete).not.toHaveBeenCalled();
    s.advance(100_000);
    expect(s.host.staticState).toBe("ready");
    expect(s.host.player.animationMs).toBe(0);
  });
  it.each(["skip", "idle", "budget", "reduced-motion", "error"] as const)("preserves %s when static rendering fails or acknowledges too late", reason => {
    const s = setup();
    s.host.presentStatic(reason);
    s.advance(STATIC_COMMIT_MS - 1);
    expect(s.host.staticState).toBe("pending");
    s.advance(1);
    s.send({ type: "static-ready" });
    expect(s.host.staticState).toBe("error");
    expect(s.complete).toHaveBeenCalledExactlyOnceWith(reason);
    expect(s.post).toHaveBeenLastCalledWith({ protocol: 3, channel: "a".repeat(32), type: "dispose" });
    s.host.start();
    expect(s.audio.unlock).not.toHaveBeenCalled();
  });
  it("retains natural completion but distinguishes a failed static presentation", () => {
    const s = setup();
    s.host.presentStatic("natural");
    expect(s.host.staticState).toBeNull();
    s.send({ type: "ready" }); s.host.start(); s.send({ type: "complete" });
    s.host.presentStatic("skip");
    expect(s.host.staticState).toBeNull();
    s.host.presentStatic("natural");
    s.send({ type: "error" });
    expect(s.host.staticState).toBe("error");
    expect(s.host.player.reason).toBe("natural");
    expect(s.complete).toHaveBeenCalledExactlyOnceWith("natural");
  });
  it("fails a static presentation on a flood, including after readiness", () => {
    const s = setup();
    s.host.presentStatic("preview"); s.send({ type: "static-ready" });
    for (let index = 0; index < 61; index++) s.send({ type: "unknown" });
    expect(s.host.staticState).toBe("error");
    expect(s.complete).not.toHaveBeenCalled();
    s.host.dispose(); s.host.presentStatic("preview");
    expect(s.host.staticState).toBe("error");
  });
  it("cannot touch a reused audio scope through controls retained after disposal", () => {
    const s = setup();
    s.send({ type: "ready" }); s.host.start(); s.host.dispose();
    s.audio.stop.mockClear(); s.audio.unlock.mockClear();
    s.host.pause(); s.host.setMuted(false); s.host.setMuted(true);
    s.host.visibility(false); s.host.visibility(true); s.host.start();
    s.host.presentStatic("skip"); s.host.finish("error");
    expect(s.audio.stop).not.toHaveBeenCalled();
    expect(s.audio.unlock).not.toHaveBeenCalled();
  });
  it("stops a cue without unlocking audio or revoking the next cue", () => {
    const s = setup();
    s.send({ type: "ready" });
    s.host.start();
    s.send({ type: "audio-stop" });
    expect(s.audio.silence).toHaveBeenCalledTimes(1);
    expect(s.audio.stop).not.toHaveBeenCalled();
    expect(s.audio.unlock).toHaveBeenCalledTimes(1);
    s.send({ type: "audio-tone", frequency: 440, durationMs: 100 });
    expect(s.audio.tone).toHaveBeenCalledTimes(1);
    s.host.pause();
    s.send({ type: "audio-stop" });
    s.send({ type: "audio-tone", frequency: 440, durationMs: 100 });
    expect(s.audio.unlock).toHaveBeenCalledTimes(1);
    expect(s.audio.tone).toHaveBeenCalledTimes(1);
  });
  it("requires exact frame source, opaque origin and host start", () => {
    const s = setup();
    s.send({ type: "ready" }, {});
    s.send({ type: "ready" }, undefined, "https://runtime.example");
    expect(s.host.ready).toBe(false);
    s.send({ type: "ready" });
    s.send({ type: "complete" });
    expect(s.host.player.state).toBe("ready");
    s.host.start();
    s.send({ type: "complete" });
    s.send({ type: "complete" });
    expect(s.complete).toHaveBeenCalledExactlyOnceWith("natural");
  });
  it("preserves a user start while the frame is loading, with a bounded deadline", () => {
    const s = setup();
    s.host.start();
    expect(s.host.player.state).toBe("ready");
    s.send({ type: "ready" });
    expect(s.host.player.state).toBe("running");
    const missing = setup();
    missing.advance(15_000);
    expect(missing.complete).toHaveBeenCalledWith("error");
  });
  it("pauses and stops sound when hidden and requires explicit resume", () => {
    const s = setup();
    s.send({ type: "ready" });
    s.host.start();
    s.advance(1000);
    s.host.visibility(false);
    s.advance(100_000);
    s.send({ type: "complete" });
    expect(s.host.player.state).toBe("paused");
    expect(s.host.player.animationMs).toBe(1000);
    s.host.visibility(true);
    expect(s.host.player.state).toBe("paused");
    s.host.start();
    expect(s.audio.unlock).toHaveBeenCalledTimes(2);
    expect(s.host.player.state).toBe("running");
  });
  it("resolves only approved audio IDs and enforces mute", () => {
    const s = setup();
    s.send({ type: "ready" });
    s.host.start();
    s.send({ type: "audio-play", asset: "missing" });
    expect(s.audio.play).not.toHaveBeenCalled();
    s.send({ type: "audio-play", asset: "cue" });
    expect(s.audio.play).toHaveBeenCalledWith("blob:trusted-audio");
    s.host.setMuted(true);
    s.send({ type: "audio-tone", frequency: 440, durationMs: 100 });
    expect(s.audio.tone).not.toHaveBeenCalled();
    expect(s.audio.stop).toHaveBeenCalled();
  });
  it("enforces animation and wait budgets independently of completion claims", () => {
    const s = setup();
    s.send({ type: "ready" });
    s.host.start();
    s.advance(30_000);
    s.send({ type: "complete" });
    expect(s.complete).toHaveBeenCalledExactlyOnceWith("budget");
    const waiting = setup();
    waiting.send({ type: "ready" });
    waiting.host.start();
    waiting.send({ type: "mode", mode: "waiting" });
    waiting.advance(60_000);
    expect(waiting.complete).toHaveBeenCalledExactlyOnceWith("idle");
  });
  it("fails closed on floods and cannot restart a disposed run", () => {
    const s = setup();
    for (let i = 0; i < 61; i++) s.send({ type: "nonsense" });
    expect(s.complete).toHaveBeenCalledExactlyOnceWith("error");
    s.host.dispose();
    s.host.start();
    s.send({ type: "ready" });
    expect(s.host.ready).toBe(false);
    expect(s.post).toHaveBeenLastCalledWith({
      protocol: 3,
      channel: "a".repeat(32),
      type: "dispose",
    });
  });
});
