import {
  LIMITS,
  type CompletionReason,
  type PlaybackState,
} from "./protocol.js";

/** Pure clock: hidden/paused time is excluded, animation budget is cumulative. */
export class Playback {
  state: PlaybackState = "ready";
  mode: "running" | "waiting" = "running";
  reason: CompletionReason | null = null;
  animationMs = 0;
  idleMs = 0;
  private last = 0;
  constructor(
    private readonly changed: () => void = () => {},
    private readonly clock = () => performance.now(),
  ) {}
  start() {
    if (this.state !== "ready" && this.state !== "paused") return;
    this.last = this.clock();
    this.state = this.mode;
    this.changed();
  }
  tick() {
    const now = this.clock();
    const delta = Math.max(0, now - this.last);
    this.last = now;
    if (this.state === "running") this.animationMs += delta;
    if (this.state === "waiting") this.idleMs += delta;
    if (this.animationMs >= LIMITS.animationMs) this.finish("budget");
    else if (this.idleMs >= LIMITS.idleMs) this.finish("idle");
  }
  report(mode: "running" | "waiting") {
    this.tick();
    if (this.state !== "running" && this.state !== "waiting") return;
    if (this.mode === mode && this.state === mode) return;
    if (this.mode !== mode) this.idleMs = 0;
    this.mode = mode;
    this.state = mode;
    this.changed();
  }
  interact() {
    if (this.state === "waiting") {
      this.tick();
      this.idleMs = 0;
    }
  }
  pause() {
    this.tick();
    if (this.state === "running" || this.state === "waiting") {
      this.state = "paused";
      this.changed();
    }
  }
  finish(reason: CompletionReason) {
    if (this.state === "ended") return;
    this.reason = reason;
    this.state = "ended";
    this.changed();
  }
  complete() {
    if (this.state !== "running" && this.state !== "waiting") return;
    this.tick();
    this.finish("natural");
  }
}
