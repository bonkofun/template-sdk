import type { CompletionReason, Content, PlaybackState } from "./protocol.js";
import { RUNTIME_PROTOCOL } from "./submission.js";

export type RuntimePhoto = {
  bytes: ArrayBuffer;
  mime: "image/jpeg" | "image/png" | "image/webp";
};
export type RuntimeContent = Omit<Content, "photoUrl"> & {
  photo: RuntimePhoto;
};
export type StaticReason = CompletionReason | "preview";
export const STATIC_REASONS: readonly StaticReason[] = ["preview", "natural", "skip", "idle", "budget", "reduced-motion", "error"];
export type FrameRequest =
  | { type: "ready" }
  | { type: "static-ready" }
  | { type: "mode"; mode: "running" | "waiting" }
  | { type: "complete" }
  | { type: "error" }
  | { type: "audio-play"; asset: string }
  | { type: "audio-tone"; frequency: number; durationMs: number }
  | { type: "audio-stop" };
export type FrameEnvelope = FrameRequest & {
  protocol: 3;
  channel: string;
  sequence: number;
};
export type HostEnvelope = { protocol: 3; channel: string } & (
  | {
      type: "init";
      content: RuntimeContent;
      config: Record<string, string | number | boolean>;
      assets: Record<string, { bytes: ArrayBuffer; mime: string }>;
      state: PlaybackState;
      reducedMotion: boolean;
      /** Render only the authored static presentation, without starting playback. */
      staticReason?: StaticReason;
    }
  | { type: "state"; state: PlaybackState; mode: "running" | "waiting" }
  | { type: "static"; reason: StaticReason }
  | { type: "dispose" }
);
export const RUNTIME_CHANNEL_PATTERN = /^[a-f0-9]{32}$/;

/** Unknown frame data never becomes a URL, HTML, permission, or analytics event. */
export function parseFrameEnvelope(input: unknown): FrameEnvelope | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const m = input as Record<string, unknown>;
  if (
    m.protocol !== RUNTIME_PROTOCOL ||
    typeof m.channel !== "string" ||
    !RUNTIME_CHANNEL_PATTERN.test(m.channel) ||
    !Number.isSafeInteger(m.sequence) ||
    Number(m.sequence) < 0 ||
    Number(m.sequence) > 2_147_483_647
  )
    return;
  const extra: string[] = [];
  switch (m.type) {
    case "ready":
    case "static-ready":
    case "complete":
    case "error":
    case "audio-stop":
      break;
    case "mode":
      if (m.mode !== "running" && m.mode !== "waiting") return;
      extra.push("mode");
      break;
    case "audio-play":
      if (
        typeof m.asset !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(m.asset)
      )
        return;
      extra.push("asset");
      break;
    case "audio-tone":
      if (
        typeof m.frequency !== "number" ||
        !Number.isFinite(m.frequency) ||
        m.frequency < 40 ||
        m.frequency > 4000 ||
        typeof m.durationMs !== "number" ||
        !Number.isFinite(m.durationMs) ||
        m.durationMs < 1 ||
        m.durationMs > 2000
      )
        return;
      extra.push("frequency", "durationMs");
      break;
    default:
      return;
  }
  if (
    Object.keys(m).some(
      (key) =>
        !["protocol", "channel", "sequence", "type", ...extra].includes(key),
    )
  )
    return;
  return m as FrameEnvelope;
}

/** The host must additionally require event.source === its exact iframe window. */
export class RuntimeMessageGate {
  private sequence = -1;
  private windowStart = 0;
  private count = 0;
  private closed = false;
  constructor(
    readonly channel: string,
    private readonly clock = () => performance.now(),
  ) {
    if (!RUNTIME_CHANNEL_PATTERN.test(channel))
      throw new Error("Invalid runtime channel");
  }
  accept(input: unknown): FrameEnvelope | undefined {
    if (this.closed) return;
    const now = this.clock();
    if (now - this.windowStart >= 1000) {
      this.count = 0;
      this.windowStart = now;
    }
    // Count invalid messages as well, and fail closed on flooding.
    if (++this.count > 60) {
      this.closed = true;
      return;
    }
    const m = parseFrameEnvelope(input);
    if (!m || m.channel !== this.channel || m.sequence <= this.sequence) return;
    this.sequence = m.sequence;
    return m;
  }
  get isClosed() {
    return this.closed;
  }
  close() {
    this.closed = true;
  }
}

/** Host validates before transferring content; never forward a private photo URL. */
export function validateRuntimeContent(content: RuntimeContent) {
  if (
    typeof content.recipientName !== "string" ||
    !content.recipientName.trim() ||
    [...content.recipientName].length > 30 ||
    typeof content.message !== "string" ||
    !content.message.trim() ||
    [...content.message].length > 160 ||
    (content.senderName != null &&
      (typeof content.senderName !== "string" ||
        [...content.senderName].length > 30)) ||
    typeof content.photoTransform !== "string" ||
    content.photoTransform.length > 200 ||
    !/^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\)(?: rotate\(-?[\d.]+deg\))?$/.test(
      content.photoTransform,
    ) ||
    !content.photo ||
    !(content.photo.bytes instanceof ArrayBuffer) ||
    content.photo.bytes.byteLength < 1 ||
    content.photo.bytes.byteLength > 10 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(content.photo.mime)
  )
    throw new Error("Invalid runtime content");
  return content;
}
