"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioScope } from "../runtime/audio.js";
import { RuntimeHost } from "../runtime/runtime-host.js";
import { parseRuntimeOrigins } from "../gateway/runtime-gateway.js";
import { validateRuntimeContent, type HostEnvelope, type RuntimeContent, type StaticReason } from "../protocol/runtime-messages.js";
import type { CompletionReason, PlaybackState } from "../protocol/protocol.js";

export interface RuntimeFrameData {
  content: RuntimeContent;
  config: Record<string, string | number | boolean>;
  images: Record<string, { bytes: ArrayBuffer; mime: string }>;
  audio: Record<string, string>;
  hasSound: boolean;
  /** Release host-owned blob URLs after the run, including an aborted load. */
  dispose?: () => void;
}
export interface RuntimeFrameControls {
  state: PlaybackState;
  ready: boolean;
  muted: boolean;
  reason?: CompletionReason;
  staticState: RuntimeHost["staticState"];
  play(): void;
  pause(): void;
  skip(): void;
  setMuted(value: boolean): void;
}
export interface RuntimeFrameProps {
  /** Remount with a new React key for replay or content/config changes. */
  src: string;
  runtimeOrigin: string;
  title: string;
  load(signal: AbortSignal): Promise<RuntimeFrameData>;
  fallback: ReactNode;
  /** Optional loading artwork, distinct from the readable terminal error fallback. */
  loading?: ReactNode;
  staticOnly?: boolean;
  /** Enable only for templates checked against the authored-static contract. */
  authoredStatic?: boolean;
  reducedMotion?: boolean;
  /** Auto-start visuals. Unmuted auto-start requires a scope unlocked by a host gesture. */
  autoStart?: boolean;
  audioScope?: AudioScope;
  muted?: boolean;
  onComplete?(reason: CompletionReason): void;
  /** Host supplies its own accessible controls, including an always-visible Skip action. */
  children(view: RuntimeFrameControls, surface: ReactNode): ReactNode;
}
const initial = { state: "ready" as PlaybackState, ready: false, muted: true, reason: undefined as CompletionReason | undefined, staticState: null as RuntimeHost["staticState"] };

/** Shared isolated browser host. No Admin primitives or business/database dependencies. */
export function RuntimeFrame(props: RuntimeFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<RuntimeHost | null>(null);
  const stop = useRef<((reason: Exclude<CompletionReason, "natural">) => void) | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [view, setView] = useState(initial);
  const [fallback, setFallback] = useState(true);
  useEffect(() => {
    const element = frame.current;
    if (!element?.contentWindow) return;
    const abort = new AbortController();
    let data: RuntimeFrameData | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let controller: RuntimeHost | undefined;
    let initialized = false;
    let ended = false;
    let completionDelivered = false;
    let initialStaticReason: StaticReason | undefined;
    setView(initial);
    setFallback(true);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const notifyComplete = (reason: CompletionReason) => {
      if (completionDelivered) return;
      completionDelivered = true;
      latest.current.onComplete?.(reason);
    };
    const cleanup = () => {
      abort.abort();
      clearInterval(timer);
      clearTimeout(deadline);
      controller?.dispose();
      props.audioScope?.stop();
      host.current = null;
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      media.removeEventListener("change", onReduced);
      element.removeEventListener("load", onLoad);
      element.removeAttribute("src");
      data?.dispose?.();
      data = undefined;
    };
    const finish = (reason: CompletionReason) => {
      if (ended || abort.signal.aborted) return;
      ended = true;
      clearTimeout(deadline);
      setView(current => ({ ...current, state: "ended", reason }));
      // Natural completion already has a settled frame. Keep it mounted; switching
      // through the loading placeholder would flash and discard its final state.
      if (props.authoredStatic && controller && (controller.ready || controller.staticState) && reason !== "error" && reason !== "natural") {
        setFallback(true);
        controller.presentStatic(reason);
        return;
      }
      clearInterval(timer);
      if (reason !== "natural") { setFallback(true); cleanup(); }
      notifyComplete(reason);
    };
    stop.current = reason => { if (controller) controller.finish(reason); else finish(reason); };
    const onMessage = (event: MessageEvent) => controller?.receive(event.data, event.source, event.origin);
    const onVisibility = () => controller?.visibility(!document.hidden);
    const onReduced = () => { if (media.matches) stop.current?.("reduced-motion"); };
    const onLoad = () => {
      if (!controller || !data || initialized || abort.signal.aborted) return;
      initialized = true;
      if (initialStaticReason) controller.presentStatic(initialStaticReason, false);
      element.contentWindow?.postMessage({ protocol: 3, channel, type: "init", content: data.content, config: data.config, assets: data.images, state: "ready", reducedMotion: !!initialStaticReason, staticReason: initialStaticReason } satisfies HostEnvelope, "*");
    };
    const channel = crypto.randomUUID().replaceAll("-", "");
    async function start() {
      if (props.staticOnly) {
        if (!props.authoredStatic) return;
        initialStaticReason = "preview";
      } else if (props.reducedMotion || media.matches) {
        if (!props.authoredStatic) { finish("reduced-motion"); return; }
        initialStaticReason = "reduced-motion";
      }
      deadline = setTimeout(() => stop.current?.("error"), 15_000);
      media.addEventListener("change", onReduced);
      try {
        parseRuntimeOrigins(props.runtimeOrigin, [window.location.origin], window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
        const url = new URL(props.src);
        if (url.origin !== props.runtimeOrigin || !/^\/v3\/[a-f0-9]{64}$/.test(url.pathname) || url.searchParams.get("parent") !== window.location.origin) throw new Error("Invalid runtime URL");
        const loaded = await latest.current.load(abort.signal);
        if (abort.signal.aborted) { loaded.dispose?.(); return; }
        data = loaded;
        validateRuntimeContent(data.content);
        const audio = props.audioScope ?? new AudioScope();
        controller = new RuntimeHost({ channel, source: element!.contentWindow!, post: message => element!.contentWindow?.postMessage(message, "*"), audio, audioAssets: data.audio, hasSound: data.hasSound, muted: props.audioScope ? (latest.current.muted ?? true) : true,
          changed: current => {
            if (abort.signal.aborted) return;
            if (current.staticState) {
              clearTimeout(deadline);
              const reason = current.staticReason === "preview" ? undefined : current.staticReason;
              setView({ state: "ended", ready: current.staticState === "ready", muted: true, reason, staticState: current.staticState });
              setFallback(current.staticState !== "ready");
              if (current.staticState === "ready") {
                clearInterval(timer);
                if (reason) notifyComplete(reason);
              } else if (current.staticState === "error") {
                const failureReason = !reason || reason === "natural" ? "error" : reason;
                setView({ state: "ended", ready: false, muted: true, reason: failureReason, staticState: "error" });
                cleanup();
                notifyComplete(failureReason);
              }
              return;
            }
            setView({ state: current.player.state, ready: current.ready, muted: current.muted, reason: current.player.reason ?? undefined, staticState: null });
            if (current.ready) clearTimeout(deadline);
            if (current.ready && current.player.state !== "ended") setFallback(false);
          }, complete: finish });
        host.current = controller;
        onVisibility();
        if (props.autoStart && !initialStaticReason) controller.start();
        window.addEventListener("message", onMessage);
        document.addEventListener("visibilitychange", onVisibility);
        element!.addEventListener("load", onLoad);
        timer = setInterval(() => controller?.tick(), 100);
        url.hash = channel;
        element!.src = url.href;
      } catch {
        if (!abort.signal.aborted) { setView({ ...initial, state: "ended", reason: "error" }); finish("error"); }
      }
    }
    void start();
    return () => {
      cleanup();
      stop.current = null;
    };
  }, [props.src, props.runtimeOrigin, props.staticOnly, props.reducedMotion, props.authoredStatic]);
  useEffect(() => {
    // External mute always stops immediately. Unmute belongs to a trusted button
    // calling controls.setMuted, not an asynchronous prop update.
    if (props.muted) host.current?.setMuted(true);
  }, [props.muted]);
  const controls: RuntimeFrameControls = { ...view, play: () => host.current?.start(), pause: () => host.current?.pause(), skip: () => stop.current?.("skip"), setMuted: value => host.current?.setMuted(value) };
  return props.children(controls, <>
    <iframe ref={frame} title={props.title} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; autoplay 'none'; geolocation 'none'" hidden={fallback} style={{ width: "100%", aspectRatio: "9 / 16", border: 0 }} />
    {fallback ? (view.state !== "ended" || view.staticState === "pending" ? props.loading ?? props.fallback : props.fallback) : null}
  </>);
}
