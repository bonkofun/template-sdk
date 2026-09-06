import { describe, it, expect, vi } from "vitest";
import { Playback } from "./playback.js";
import { readZip, writeZip, safePath, filesDigest } from "./node.js";
function clock() {
  let now = 0;
  const change = vi.fn();
  const player = new Playback(change, () => now);
  return {
    player,
    change,
    advance(ms: number) {
      now += ms;
      player.tick();
    },
  };
}
describe("v2 lifecycle", () => {
  it("ignores completion while paused and charges delayed completion to the budget", () => {
    let now = 0; const p = new Playback(() => {}, () => now);
    p.start(); p.pause(); p.complete(); expect(p.reason).toBeNull(); p.start(); now = 31_000; p.complete(); expect(p.reason).toBe("budget");
  });
  it("counts animation cumulatively across waiting and pause", () => {
    const { player: p, advance } = clock();
    p.start();
    advance(10_000);
    p.report("waiting");
    advance(40_000);
    p.pause();
    advance(100_000);
    expect(p.state).toBe("paused");
    p.start();
    p.report("running");
    advance(20_000);
    expect(p.reason).toBe("budget");
    expect(p.animationMs).toBe(30_000);
  });
  it("expires foreground waiting at 60 seconds and excludes hidden time", () => {
    const { player: p, advance } = clock();
    p.start();
    p.report("waiting");
    advance(59_000);
    p.pause();
    advance(90_000);
    expect(p.reason).toBeNull();
    p.start();
    advance(1000);
    expect(p.reason).toBe("idle");
  });
  it.each(["natural", "skip", "error", "reduced-motion"] as const)(
    "keeps the first %s completion and ignores repeats",
    (reason) => {
      const { player: p, change } = clock();
      p.start();
      p.finish(reason);
      const count = change.mock.calls.length;
      p.finish("natural");
      p.start();
      expect(p.reason).toBe(reason);
      expect(change).toHaveBeenCalledTimes(count);
    },
  );
  it("new playback has no previous timer budget", () => {
    const first = clock();
    first.player.start();
    first.advance(30_000);
    const next = clock();
    next.player.start();
    expect(next.player.reason).toBeNull();
    expect(next.player.animationMs).toBe(0);
  });
});
describe("bounded ZIP", () => {
  it("roundtrips deterministically regardless of entry insertion order", () => {
    const a = { "b.txt": Buffer.from("b"), "a.txt": Buffer.from("a") };
    const b = { "a.txt": a["a.txt"], "b.txt": a["b.txt"] };
    expect(writeZip(a)).toEqual(writeZip(b));
    expect(filesDigest(a)).toBe(filesDigest(b));
    expect(readZip(writeZip(a))["a.txt"].toString()).toBe("a");
  });
  it.each([
    "../x",
    "/x",
    "C:/x",
    "a/../x",
    "a\\x",
    ".env",
    "a//b",
    "a/.git/config",
  ])("rejects path %s", (value) => expect(() => safePath(value)).toThrow());
  it("rejects case-insensitive duplicate paths", () =>
    expect(() =>
      writeZip({ "a.txt": Buffer.from("a"), "A.txt": Buffer.from("b") }),
    ).toThrow("Duplicate"));
  it("rejects symlinks", () => {
    const b = writeZip({ "a.txt": Buffer.from("x") });
    const c = b.readUInt32LE(b.length - 6);
    b.writeUInt32LE(0xa1ff0000, c + 38);
    expect(() => readZip(b)).toThrow();
  });
  it("rejects crc corruption", () => {
    const b = writeZip({ "a.txt": Buffer.from("x") });
    b[35] ^= 1;
    expect(() => readZip(b)).toThrow();
  });
  it("rejects entry count and compressed size excess", () => {
    expect(() =>
      writeZip(
        Object.fromEntries(
          Array.from({ length: 129 }, (_, i) => [`a${i}`, Buffer.from("a")]),
        ),
      ),
    ).toThrow();
    expect(() => readZip(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow();
  });
  it("rejects unlisted suffixes and unsupported flags", () => {
    const b = writeZip({ "a.txt": Buffer.from("x") });
    expect(() => readZip(Buffer.concat([b, Buffer.from("x")]))).toThrow();
    const c = b.readUInt32LE(b.length - 6);
    b.writeUInt16LE(1, c + 8);
    expect(() => readZip(b)).toThrow();
  });
  it("rejects exaggerated expanded size before inflating", () => {
    const b = writeZip({ "a.txt": Buffer.from("x") });
    const c = b.readUInt32LE(b.length - 6);
    b.writeUInt32LE(26 * 1024 * 1024, c + 24);
    expect(() => readZip(b)).toThrow("expansion");
  });
});
