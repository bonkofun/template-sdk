import type { ComponentType } from "react";
export const SDK_VERSION = "0.1.0";
export const FONT_STACKS = Object.freeze({
  body: "system-ui, -apple-system, sans-serif",
  editorial: "Georgia, 'Times New Roman', serif",
});
export const LIMITS = Object.freeze({
  compressed: 10 * 1024 * 1024,
  expanded: 25 * 1024 * 1024,
  files: 128,
  animationMs: 30_000,
  idleMs: 60_000,
  ratio: 100,
  imageDimension: 4096,
  imagePixels: 16_777_216,
  audioSeconds: 10,
});
export type CompletionReason =
  | "natural"
  | "skip"
  | "idle"
  | "budget"
  | "reduced-motion"
  | "error";
export type PlaybackState =
  | "ready"
  | "running"
  | "waiting"
  | "paused"
  | "ended";
export type Experience = {
  protocol: 2;
  sdkVersion: string;
  rendererDigest: string;
  assets: Record<string, string>;
};
export interface Content {
  recipientName: string;
  message: string;
  senderName?: string | null;
  photoUrl: string;
  photoTransform: string;
}
export interface Controls {
  state: PlaybackState;
  mode: "running" | "waiting";
  report: (mode: "running" | "waiting") => void;
  complete: () => void;
  asset: (id: string) => string;
  audio: {
    play: (id: string) => Promise<void>;
    tone: (frequency: number, durationMs: number) => void;
    stop: () => void;
  };
}
export interface RendererProps extends Content {
  config: Record<string, string | number | boolean>;
  runtime: Controls;
}
export interface RendererPlugin {
  key: string;
  version: number;
  protocol: 2;
  parseConfig: (input: unknown) => Record<string, string | number | boolean>;
  Static: ComponentType<
    Content & { config: Record<string, string | number | boolean> }
  >;
  load: () => Promise<{ default: ComponentType<RendererProps> }>;
}
export function defineRenderer<T extends RendererPlugin>(plugin: T): T {
  return Object.freeze(plugin);
}
export function parseEmptyConfig(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length
  )
    throw new Error("Expected empty config");
  return {};
}
export function parseExperience(value: unknown): Experience {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid experience");
  const e = value as Record<string, unknown>;
  if (
    Object.keys(e).some(
      (k) =>
        !["protocol", "sdkVersion", "rendererDigest", "assets"].includes(k),
    ) ||
    e.protocol !== 2 ||
    e.sdkVersion !== SDK_VERSION ||
    typeof e.rendererDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(e.rendererDigest)
  )
    throw new Error("Unsupported experience protocol/SDK/digest");
  if (
    !e.assets ||
    typeof e.assets !== "object" ||
    Array.isArray(e.assets) ||
    Object.keys(e.assets).length > LIMITS.files
  )
    throw new Error("Invalid asset bindings");
  for (const [id, path] of Object.entries(e.assets)) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(id) ||
      typeof path !== "string" ||
      !/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|avif|mp3|ogg)$/.test(path)
    )
      throw new Error("Invalid asset binding");
  }
  return structuredClone(value) as Experience;
}
