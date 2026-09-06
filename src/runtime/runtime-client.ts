import type { Content, Controls, PlaybackState } from "../protocol/protocol.js";
import {
  RUNTIME_CHANNEL_PATTERN,
  STATIC_REASONS,
  type StaticReason,
  validateRuntimeContent,
  type FrameRequest,
  type RuntimeContent,
} from "../protocol/runtime-messages.js";

export interface RuntimePresentation {
  content: Content;
  config: Record<string, string | number | boolean>;
  reducedMotion: boolean;
  runtime: Controls;
}
export interface StandaloneTemplate {
  /** Render again on host state changes; preserve local interaction state. */
  render(presentation: RuntimePresentation): void;
  /** A fresh, motionless presentation after interactive cleanup. Resolve after
   * content is committed; return cleanup for its DOM/React/graphics resources.
   * Optional only for older drafts: requesting an absent static entry fails. */
  renderStatic?(presentation: StaticPresentation): void | (() => void) | Promise<void | (() => void)>;
  dispose(): void;
}
export interface StaticPresentation {
  content: Content;
  config: RuntimePresentation["config"];
  reason: StaticReason;
  reducedMotion: true;
  asset(id: string): string;
}
const states: readonly PlaybackState[] = [
  "ready",
  "running",
  "waiting",
  "paused",
  "ended",
];
const record = (input: unknown): input is Record<string, unknown> =>
  !!input && typeof input === "object" && !Array.isArray(input);

/** Bundled into the frame, never loaded into the main application's module graph. */
export function connectStandaloneTemplate(template: StandaloneTemplate) {
  const url = new URL(window.location.href);
  const channel = url.hash.slice(1);
  const parentOrigin = url.searchParams.get("parent");
  if (
    !RUNTIME_CHANNEL_PATTERN.test(channel) ||
    !parentOrigin ||
    new URL(parentOrigin).origin !== parentOrigin ||
    window.parent === window
  )
    throw new Error("A Bonko isolated host is required");
  let sequence = 0;
  let disposed = false;
  let staticStarted = false;
  let interactiveDisposed = false;
  let staticCleanup: (() => void) | undefined;
  let presentation: RuntimePresentation | undefined;
  const urls: string[] = [];
  const assets: Record<string, string> = Object.create(null);
  const send = (request: FrameRequest) => {
    if (!disposed)
      window.parent.postMessage(
        { protocol: 3, channel, sequence: sequence++, ...request },
        parentOrigin,
      );
  };
  const stopInteractive = () => {
    if (interactiveDisposed) return;
    interactiveDisposed = true;
    template.dispose();
  };
  const dispose = () => {
    if (disposed) return;
    send({ type: "audio-stop" });
    disposed = true;
    window.removeEventListener("message", receive);
    window.removeEventListener("pagehide", dispose);
    try {
      stopInteractive();
      staticCleanup?.();
      staticCleanup = undefined;
    } finally {
      for (const url of urls) URL.revokeObjectURL(url);
    }
  };
  const blob = (bytes: ArrayBuffer, mime: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    urls.push(url);
    return url;
  };
  const render = () => {
    if (presentation && !staticStarted) template.render(presentation);
  };
  const renderStatic = async (reason: StaticReason) => {
    if (!presentation || staticStarted || disposed) return;
    staticStarted = true;
    try {
      send({ type: "audio-stop" });
      stopInteractive();
      if (!template.renderStatic) throw new Error("Missing static presentation");
      const cleanup = await template.renderStatic({ content: presentation.content,
        config: presentation.config, reason, reducedMotion: true,
        asset: id => assets[id] ?? "" });
      if (disposed) { if (typeof cleanup === "function") cleanup(); return; }
      staticCleanup = typeof cleanup === "function" ? cleanup : undefined;
      send({ type: "static-ready" });
    } catch {
      if (!disposed) { send({ type: "error" }); dispose(); }
    }
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      disposed ||
      event.source !== window.parent ||
      event.origin !== parentOrigin ||
      !record(event.data)
    )
      return;
    const m = event.data;
    if (m.protocol !== 3 || m.channel !== channel) return;
    try {
      if (m.type === "dispose") {
        dispose();
        return;
      }
      if (m.type === "static" && presentation) {
        if (!STATIC_REASONS.includes(m.reason as StaticReason)) throw new Error("Invalid static reason");
        void renderStatic(m.reason as StaticReason);
        return;
      }
      if (m.type === "state" && presentation) {
        if (staticStarted) return;
        if (
          !states.includes(m.state as PlaybackState) ||
          (m.mode !== "running" && m.mode !== "waiting")
        )
          throw new Error("Invalid state");
        presentation = {
          ...presentation,
          runtime: {
            ...presentation.runtime,
            state: m.state as PlaybackState,
            mode: m.mode,
          },
        };
        render();
        return;
      }
      if (m.type !== "init" || presentation) return;
      if (
        !record(m.content) ||
        !record(m.config) ||
        !record(m.assets) ||
        typeof m.reducedMotion !== "boolean" ||
        !states.includes(m.state as PlaybackState)
      )
        throw new Error("Invalid initialization");
      if (m.staticReason !== undefined && !STATIC_REASONS.includes(m.staticReason as StaticReason))
        throw new Error("Invalid static reason");
      const content = validateRuntimeContent(
        m.content as unknown as RuntimeContent,
      );
      if (
        Object.keys(m.config).length > 32 ||
        Object.entries(m.config).some(
          ([key, value]) =>
            !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key) ||
            ["constructor", "prototype"].includes(key) ||
            !(
              typeof value === "boolean" ||
              (typeof value === "number" && Number.isFinite(value)) ||
              (typeof value === "string" && value.length <= 500)
            ),
        )
      )
        throw new Error("Invalid config");
      if (Object.keys(m.assets).length > 100)
        throw new Error("Too many assets");
      let size = content.photo.bytes.byteLength;
      for (const [id, asset] of Object.entries(m.assets)) {
        if (
          !/^[a-z][a-z0-9-]{0,63}$/.test(id) ||
          !record(asset) ||
          !(asset.bytes instanceof ArrayBuffer) ||
          !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(
            String(asset.mime),
          )
        )
          throw new Error("Invalid frame image");
        size += asset.bytes.byteLength;
        if (size > 35 * 1024 * 1024) throw new Error("Frame assets too large");
        assets[id] = blob(asset.bytes, String(asset.mime));
      }
      presentation = {
        content: {
          recipientName: content.recipientName,
          message: content.message,
          senderName: content.senderName,
          photoTransform: content.photoTransform,
          photoUrl: blob(content.photo.bytes, content.photo.mime),
        },
        config: m.config as RuntimePresentation["config"],
        reducedMotion: m.reducedMotion,
        runtime: {
          state: m.state as PlaybackState,
          mode: "running",
          report: (mode) => { if (!staticStarted) send({ type: "mode", mode }); },
          complete: () => { if (!staticStarted) send({ type: "complete" }); },
          asset: (id) => assets[id] ?? "",
          audio: {
            play: async (asset) => {
              if (!staticStarted) send({ type: "audio-play", asset });
            },
            tone: (frequency, durationMs) => {
              if (!staticStarted) send({ type: "audio-tone", frequency, durationMs });
            },
            stop: () => send({ type: "audio-stop" }),
          },
        },
      };
      if (m.staticReason !== undefined) {
        void renderStatic(m.staticReason as StaticReason);
        return;
      }
      render();
      send({ type: "ready" });
    } catch {
      send({ type: "error" });
      dispose();
    }
  };
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", dispose);
  return dispose;
}
