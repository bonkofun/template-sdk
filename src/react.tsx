"use client";
import {
  Component,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type ComponentType,
} from "react";
import { AudioScope } from "./audio.js";
import { MotionConfig } from "motion/react";
import { Playback } from "./playback.js";
import type {
  CompletionReason,
  Content,
  Controls,
  RendererPlugin,
  RendererProps,
} from "./protocol.js";

class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export interface ExperiencePlayerProps {
  plugin?: RendererPlugin;
  content: Content;
  config?: RendererProps["config"];
  resolveAsset: (id: string) => string;
  staticOnly?: boolean;
  reducedMotion?: boolean;
  simulateError?: boolean;
  autoStart?: boolean;
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** Optional instance unlocked synchronously by a host's user-initiated Open action. */
  audioScope?: AudioScope;
  onComplete?: (reason: CompletionReason) => void;
}
const buttonStyle = {
  minHeight: 44,
  padding: "8px 14px",
  border: "1px solid #a1a1aa",
  borderRadius: 8,
  background: "#fff",
  color: "#18181b",
  cursor: "pointer",
};
export function ContentFallback({ content }: { content: Content }) {
  return (
    <article
      style={{
        padding: 24,
        background: "#fafafa",
        color: "#18181b",
        overflowWrap: "anywhere",
      }}
    >
      <h2>{content.recipientName}</h2>
      <p>{content.message}</p>
      {content.senderName ? <p>From {content.senderName}</p> : null}
    </article>
  );
}
export function ExperiencePlayer(props: ExperiencePlayerProps) {
  const {
    plugin,
    content,
    config = {},
    resolveAsset,
    staticOnly,
    simulateError,
  } = props;
  const [run, setRun] = useState(0);
  const [replayAudio, setReplayAudio] = useState<AudioScope>();
  return (
    <MotionConfig reducedMotion="user">
      <PlayerRun
        key={run}
        {...props}
        plugin={plugin}
        content={content}
        config={config}
        resolveAsset={resolveAsset}
        staticOnly={staticOnly}
        simulateError={simulateError}
        audioScope={replayAudio ?? props.audioScope}
        onReplay={() => {
          const audio = new AudioScope();
          if (!props.muted) audio.unlock();
          setReplayAudio(audio);
          setRun((value) => value + 1);
        }}
      />
    </MotionConfig>
  );
}
function PlayerRun({
  plugin,
  content,
  config = {},
  resolveAsset,
  staticOnly,
  reducedMotion,
  simulateError,
  autoStart,
  muted = false,
  onMutedChange,
  onComplete,
  onReplay,
  audioScope,
}: ExperiencePlayerProps & { onReplay: () => void }) {
  const [, update] = useReducer((n) => n + 1, 0);
  const player = useMemo(() => new Playback(update), []);
  const audio = useMemo(() => audioScope ?? new AudioScope(), [audioScope]);
  const [Renderer, setRenderer] = useState<ComponentType<RendererProps> | null>(
    null,
  );
  const [prefersReduced, setPrefersReduced] = useState<boolean | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const notified = useRef(false);
  const minimal = reducedMotion ?? prefersReduced ?? true;
  useEffect(() => {
    if (staticOnly || prefersReduced === null) return;
    if (minimal && player.state !== "ready") player.finish("reduced-motion");
    if (
      autoStart &&
      player.state === "ready" &&
      (Renderer || !plugin || minimal)
    ) {
      if (!plugin || simulateError) player.finish("error");
      else if (minimal) player.finish("reduced-motion");
      else player.start();
    }
  }, [
    autoStart,
    staticOnly,
    minimal,
    prefersReduced,
    player,
    Renderer,
    plugin,
    simulateError,
  ]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (staticOnly || !plugin) return;
    let alive = true;
    void plugin
      .load()
      .then((module) => {
        if (alive) setRenderer(() => module.default);
      })
      .catch(() => {
        if (alive) player.finish("error");
      });
    return () => {
      alive = false;
    };
  }, [plugin, staticOnly, player]);
  useEffect(() => {
    const timer = setInterval(() => player.tick(), 100);
    const visibility = () => {
      if (document.hidden) {
        player.pause();
        audio.stop();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      audio.stop();
    };
  }, [player, audio]);
  useEffect(() => {
    if (muted) audio.stop();
  }, [muted, audio]);
  useEffect(() => {
    if (player.state === "ended") {
      audio.stop();
      if (!notified.current && player.reason) {
        notified.current = true;
        completeRef.current?.(player.reason);
      }
    }
  }, [player.state, player.reason, audio]);
  const begin = () => {
    if (simulateError || !plugin) {
      player.finish("error");
      return;
    }
    if (minimal) {
      player.finish("reduced-motion");
      return;
    }
    if (!muted) audio.unlock();
    player.start();
  };
  const controls: Controls = {
    state: player.state,
    mode: player.mode,
    report: (mode) => player.report(mode),
    complete: () => player.complete(),
    asset: resolveAsset,
    audio: {
      play: async (id) => {
        if (
          !muted &&
          (player.state === "running" || player.state === "waiting")
        ) {
          if (navigator.userActivation?.isActive) audio.unlock();
          await audio.play(resolveAsset(id));
        }
      },
      tone: (frequency, ms) => {
        if (
          !muted &&
          (player.state === "running" || player.state === "waiting")
        ) {
          if (navigator.userActivation?.isActive) audio.unlock();
          audio.tone(frequency, ms);
        }
      },
      stop: () => audio.silence(),
    },
  };
  const fallback = <ContentFallback content={content} />;
  const still = plugin ? (
    <Boundary fallback={fallback} onError={() => player.finish("error")}>
      <plugin.Static {...content} config={config} />
    </Boundary>
  ) : (
    fallback
  );
  const active =
    !staticOnly &&
    player.state !== "ready" &&
    player.state !== "ended" &&
    Renderer &&
    !minimal &&
    !simulateError;
  return (
    <section
      aria-label="Interactive template"
      data-playback={player.state}
      onPointerDown={() => player.interact()}
      onKeyDown={() => player.interact()}
      style={{ width: "100%", minWidth: 0 }}
    >
      <div
        style={{
          aspectRatio: "9 / 16",
          position: "relative",
          overflow: "hidden",
          isolation: "isolate",
          containerType: "inline-size",
        }}
      >
        {active ? (
          <Boundary fallback={still} onError={() => player.finish("error")}>
            <Renderer {...content} config={config} runtime={controls} />
          </Boundary>
        ) : (
          still
        )}
      </div>
      {!staticOnly ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            padding: "12px 0",
          }}
        >
          {player.state === "ready" || player.state === "paused" ? (
            <button
              style={buttonStyle}
              type="button"
              onClick={begin}
              disabled={!Renderer && !!plugin && !minimal && !simulateError}
            >
              {player.state === "paused" ? "Continue" : "Play"}
            </button>
          ) : null}
          {player.state === "running" || player.state === "waiting" ? (
            <button
              style={buttonStyle}
              type="button"
              onClick={() => {
                player.pause();
                audio.stop();
              }}
            >
              Pause
            </button>
          ) : null}
          {player.state !== "ended" ? (
            <button
              style={buttonStyle}
              type="button"
              onClick={() => player.finish("skip")}
            >
              View message
            </button>
          ) : (
            <button style={buttonStyle} type="button" onClick={onReplay}>
              Replay
            </button>
          )}
          {onMutedChange ? (
            <button
              style={buttonStyle}
              type="button"
              aria-pressed={muted}
              onClick={() => {
                if (!muted) audio.stop();
                else if (
                  player.state === "running" ||
                  player.state === "waiting"
                )
                  audio.unlock();
                onMutedChange(!muted);
              }}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
          ) : null}
          <span role="status" style={{ alignSelf: "center", fontSize: 12 }}>
            {player.reason ?? player.state}
          </span>
        </div>
      ) : null}
    </section>
  );
}
