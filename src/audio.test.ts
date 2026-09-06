import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioScope } from "./audio.js";
afterEach(() => vi.unstubAllGlobals());
describe("managed audio", () => {
  it("cancels a pending cue but permits the next cue without another unlock", async () => {
    const completions: (() => void)[] = [];
    const pauses: ReturnType<typeof vi.fn>[] = [];
    const play = vi.fn(() => new Promise<void>(resolve => completions.push(resolve)));
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("Audio", class {
      play = play;
      pause = vi.fn();
      constructor() { pauses.push(this.pause); }
      removeAttribute() {}
      load() {}
    });
    const audio = new AudioScope();
    audio.silence();
    await audio.play("/locked.mp3");
    expect(play).not.toHaveBeenCalled();
    audio.unlock();
    const first = audio.play("/first.mp3");
    audio.silence();
    const second = audio.play("/second.mp3");
    expect(play).toHaveBeenCalledTimes(2);
    completions[0]();
    completions[1]();
    await Promise.all([first, second]);
    expect(pauses[0]).toHaveBeenCalledTimes(2);
    expect(pauses[1]).not.toHaveBeenCalled();
    audio.stop();
    audio.silence();
    await audio.play("/locked-again.mp3");
    expect(play).toHaveBeenCalledTimes(2);
    expect(pauses[1]).toHaveBeenCalledTimes(1);
  });
  it("does not play before explicit unlock, and stops a pending play", async () => {
    let finish!: () => void;
    const pause = vi.fn(); const play = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("Audio", class { play = play; pause = pause; removeAttribute() {} load() {} });
    const audio = new AudioScope(); await audio.play("/clip.mp3"); expect(play).not.toHaveBeenCalled();
    audio.unlock(); const pending = audio.play("/clip.mp3"); audio.stop(); finish(); await pending; expect(pause).toHaveBeenCalledTimes(2);
    await audio.play("/clip.mp3"); expect(play).toHaveBeenCalledTimes(1);
  });
  it("stops oscillators, closes context, and does not resume implicitly", () => {
    const stop = vi.fn(); const close = vi.fn(async () => {}); const start = vi.fn();
    vi.stubGlobal("AudioContext", class { currentTime=0; destination={}; resume=async()=>{}; close=close;
      createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start,stop};}
      createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    });
    const audio = new AudioScope(); audio.unlock(); audio.tone(660,500); expect(start).toHaveBeenCalledTimes(1); audio.stop(); expect(close).toHaveBeenCalledTimes(1); expect(stop).toHaveBeenCalledTimes(2); audio.tone(660,500); expect(start).toHaveBeenCalledTimes(1);
  });
  it("disconnects both synthesis nodes immediately and preserves cue permission", () => {
    const disconnectNode = vi.fn(), disconnectGain = vi.fn();
    const start = vi.fn(), close = vi.fn(async () => {});
    vi.stubGlobal("AudioContext", class {
      currentTime = 0; destination = {}; resume = async () => {}; close = close;
      createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect: disconnectNode, start, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect: disconnectGain }; }
    });
    const audio = new AudioScope();
    audio.unlock();
    audio.tone(440, 100);
    audio.silence();
    expect(disconnectNode).toHaveBeenCalledTimes(1);
    expect(disconnectGain).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    audio.tone(660, 100);
    expect(start).toHaveBeenCalledTimes(2);
    audio.stop();
    audio.stop();
    expect(disconnectGain).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps the visual lifecycle usable when Web Audio is unavailable", () => { vi.stubGlobal("AudioContext",undefined); const audio = new AudioScope(); expect(()=>{audio.unlock();audio.tone(500,100);audio.stop();}).not.toThrow(); });
});
