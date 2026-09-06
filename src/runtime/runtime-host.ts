import { Playback } from "./playback.js";
import { RuntimeMessageGate, type HostEnvelope, type StaticReason } from "../protocol/runtime-messages.js";
import type { AudioScope } from "./audio.js";
import type { CompletionReason } from "../protocol/protocol.js";

export const STATIC_COMMIT_MS = 5_000;

export interface RuntimeHostOptions {
  channel: string;
  /** Exact contentWindow object, never an origin-only check. */
  source: object;
  post: (message: HostEnvelope) => void;
  audio: Pick<AudioScope, "unlock" | "stop" | "silence" | "play" | "tone">;
  audioAssets: Readonly<Record<string, string>>;
  hasSound: boolean;
  muted: boolean;
  changed: (host: RuntimeHost) => void;
  complete: (reason: CompletionReason) => void;
  clock?: () => number;
}

/** One host per iframe/run. Replay replaces the iframe and this controller. */
export class RuntimeHost {
  readonly player: Playback;
  private readonly gate: RuntimeMessageGate;
  ready = false;
  muted: boolean;
  staticState: "pending" | "ready" | "error" | null = null;
  staticReason?: StaticReason;
  private staticStartedAt = 0;
  private disposed = false;
  private delivered = false;
  private requestedStart = false;
  private visible = true;
  private readonly loadedAt: number;
  private readonly clock: () => number;
  constructor(private readonly options: RuntimeHostOptions) {
    this.clock = options.clock ?? (() => performance.now());
    this.loadedAt = this.clock();
    this.muted = options.muted || !options.hasSound;
    this.gate = new RuntimeMessageGate(options.channel, this.clock);
    this.player = new Playback(() => this.changed(), this.clock);
  }
  private changed() {
    if (this.disposed) return;
    if (this.player.state === "paused" || this.player.state === "ended")
      this.options.audio.stop();
    if (!this.staticState) this.options.post({
      protocol: 3,
      channel: this.options.channel,
      type: "state",
      state: this.player.state,
      mode: this.player.mode,
    });
    this.options.changed(this);
    if (this.player.reason && !this.delivered) {
      this.delivered = true;
      this.options.complete(this.player.reason);
    }
  }
  /** Call only from a trusted host action; this never accepts frame play requests. */
  start() {
    if (this.disposed || this.staticState || !this.visible || this.player.state === "ended") return;
    this.requestedStart = true;
    if (!this.muted) this.options.audio.unlock();
    if (this.ready) this.player.start();
  }
  pause() {
    if (this.disposed) return;
    this.requestedStart = false;
    this.options.audio.stop();
    if (!this.staticState) this.player.pause();
  }
  visibility(visible: boolean) {
    if (this.disposed) return;
    this.visible = visible;
    if (!visible) this.pause();
    // Returning to the foreground never resumes playback or audio.
  }
  setMuted(muted: boolean) {
    if (this.disposed) return;
    this.muted = muted || !this.options.hasSound || !!this.staticState;
    if (this.muted) this.options.audio.stop();
    else if (this.visible && ["running", "waiting"].includes(this.player.state))
      this.options.audio.unlock();
    this.options.changed(this);
  }
  finish(reason: Exclude<CompletionReason, "natural">) {
    if (!this.disposed && !this.staticState) this.player.finish(reason);
  }
  /** Host-only transition. For direct static init, pass notifyFrame=false and
   * include staticReason in the init envelope. Never accept this from the frame. */
  presentStatic(reason: StaticReason, notifyFrame = true) {
    if (this.disposed || this.staticState) return;
    if (reason === "preview" && this.player.state !== "ready") return;
    if (reason === "natural" && this.player.reason !== "natural") return;
    if (this.player.reason && this.player.reason !== reason) return;
    this.staticState = "pending";
    this.staticReason = reason;
    this.staticStartedAt = this.clock();
    this.requestedStart = false;
    this.muted = true;
    this.options.audio.stop();
    if (reason !== "preview" && this.player.state !== "ended") this.player.finish(reason);
    if (this.disposed) return;
    if (this.gate.isClosed) { this.failStatic(); return; }
    if (notifyFrame) this.options.post({ protocol: 3, channel: this.options.channel, type: "static", reason });
    this.options.changed(this);
  }
  private failStatic() {
    if (!this.staticState || this.staticState === "error" || this.disposed) return;
    this.staticState = "error";
    this.gate.close();
    this.options.audio.stop();
    this.options.post({ protocol: 3, channel: this.options.channel, type: "dispose" });
    this.options.changed(this);
  }
  tick() {
    if (this.disposed) return;
    if (this.staticState) {
      if (this.staticState === "pending" && this.clock() - this.staticStartedAt >= STATIC_COMMIT_MS) this.failStatic();
      return;
    }
    if (this.player.state === "ended") return;
    if (!this.ready && this.clock() - this.loadedAt >= 15_000)
      this.finish("error");
    else this.player.tick();
  }
  receive(data: unknown, source: object | null, origin: string) {
    if (this.disposed || source !== this.options.source || origin !== "null")
      return;
    const message = this.gate.accept(data);
    if (this.staticState) {
      this.tick();
      if (this.staticState === "error") return;
      if (this.gate.isClosed || message?.type === "error") { this.failStatic(); return; }
      if (this.staticState === "pending" && message?.type === "static-ready") {
        this.staticState = "ready";
        this.options.changed(this);
      }
      // Static renderers cannot start playback, issue audio or alter completion.
      return;
    }
    if (this.gate.isClosed && this.player.state !== "ended")
      this.finish("error");
    if (!message || this.player.state === "ended") return;
    if (message.type === "ready") {
      if (this.ready) return;
      this.ready = true;
      if (this.requestedStart && this.visible) this.player.start();
      else this.options.changed(this);
      return;
    }
    if (message.type === "error") {
      this.finish("error");
      return;
    }
    if (message.type === "audio-stop") {
      this.options.audio.silence();
      return;
    }
    if (
      !this.ready ||
      !this.visible ||
      !["running", "waiting"].includes(this.player.state)
    )
      return;
    this.player.tick();
    if (this.player.reason) return;
    switch (message.type) {
      case "mode":
        this.player.report(message.mode);
        break;
      case "complete":
        this.player.complete();
        break;
      case "audio-play":
        if (
          !this.muted &&
          Object.hasOwn(this.options.audioAssets, message.asset)
        )
          void this.options.audio.play(this.options.audioAssets[message.asset]);
        break;
      case "audio-tone":
        if (!this.muted)
          this.options.audio.tone(message.frequency, message.durationMs);
        break;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gate.close();
    this.options.audio.stop();
    this.options.post({
      protocol: 3,
      channel: this.options.channel,
      type: "dispose",
    });
  }
}
