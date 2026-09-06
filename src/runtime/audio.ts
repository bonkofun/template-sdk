/** All audio is scoped to one playback instance. No module-global audio state. */
export class AudioScope {
  private context?: AudioContext;
  private players = new Set<HTMLAudioElement>();
  private nodes = new Map<OscillatorNode, GainNode>();
  private enabled = false;
  private epoch = 0;
  unlock() {
    this.enabled = true;
    if (typeof AudioContext !== "undefined") {
      try {
        this.context ??= new AudioContext();
        void this.context.resume().catch(() => {});
      } catch {
        /* Visual playback remains available. */
      }
    }
  }
  /** Cancel current cues without granting or revoking host playback permission. */
  silence() {
    this.epoch++;
    for (const player of this.players) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    this.players.clear();
    for (const [node, gain] of this.nodes) {
      node.onended = null;
      try {
        node.stop();
      } catch {}
      node.disconnect();
      gain.disconnect();
    }
    this.nodes.clear();
  }
  /** Host lifecycle boundary: silence and require another explicit unlock. */
  stop() {
    this.enabled = false;
    this.silence();
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = undefined;
    }
  }
  async play(url: string) {
    if (!this.enabled) return;
    const epoch = this.epoch;
    if (typeof Audio === "undefined" || this.players.size >= 4) return;
    const player = new Audio(url);
    this.players.add(player);
    player.onended = () => {
      this.players.delete(player);
    };
    player.onerror = () => {
      this.players.delete(player);
    };
    try {
      await player.play();
      if (epoch !== this.epoch) player.pause();
    } catch {
      this.players.delete(player);
    }
  }
  tone(frequency: number, durationMs: number) {
    if (
      !this.enabled ||
      !Number.isFinite(frequency) ||
      frequency < 40 ||
      frequency > 4000 ||
      !Number.isFinite(durationMs) ||
      durationMs < 1 ||
      durationMs > 2000
    )
      return;
    if (typeof AudioContext === "undefined" || this.nodes.size >= 8) return;
    try {
      this.context ??= new AudioContext();
    } catch {
      return;
    }
    const ctx = this.context;
    void ctx.resume().catch(() => {});
    const node = ctx.createOscillator();
    const gain = ctx.createGain();
    node.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + durationMs / 1000,
    );
    node.connect(gain);
    gain.connect(ctx.destination);
    this.nodes.set(node, gain);
    node.onended = () => {
      node.disconnect();
      gain.disconnect();
      this.nodes.delete(node);
    };
    node.start();
    node.stop(ctx.currentTime + durationMs / 1000);
  }
}
