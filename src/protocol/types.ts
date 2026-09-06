export type BonkRendererConfig = Record<string, string | number | boolean>;
import type { Experience } from "./protocol.js";
import type { RuntimeReference } from "./submission.js";

/**
 * Published template data for the Bonko launch surface.
 *
 * A template is versioned product data, not executable code (AGENTS.md §8).
 * `rendererKey` references the finite type-safe renderer registry under
 * `src/plugins/bonk-renderers/`.
 */

export type TemplateOccasion =
  | "birthday"
  | "anniversary"
  | "pets"
  | "achievement"
  | "everyday";

export interface TemplatePosterStyle {
  /** Poster background color; the poster must read without any photo. */
  background: string;
  /** Foreground ink used for poster typography. */
  foreground: string;
  /** One supporting accent for the poster frame or seal. */
  accent: string;
}

export interface Template {
  experience?: Experience;
  runtime?: RuntimeReference;
  id: string;
  slug: string;
  version: string;
  status: "draft" | "published" | "archived";
  access: "free" | "premium";
  sortOrder: number;
  cover: {
    src: string;
    objectPosition: string;
    foregroundText: string;
    scrim: { top: number; bottom: number; clearAt: number };
  };
  config: BonkRendererConfig;
  /** Public occasion-facing name. */
  name: string;
  occasion: TemplateOccasion;
  occasionLabel: string;
  /** One-line context shown under the name in discovery. */
  context: string;
  /** Longer description used on /t/[slug]. */
  description: string;
  /** Non-spoiler summary of the reveal. */
  experienceSummary: string;
  /** Who this template is for, shown on /t/[slug]. */
  audience: string;
  rendererKey: string;
  rendererVersion: number;
  posterStyle: TemplatePosterStyle;
  /** Sample values used by previews only, clearly derived from the template. */
  sample: {
    recipientName: string;
    message: string;
    senderName: string;
  };
  messagePresets: string[];
  /** Runtime duration in ms; the reveal is 2.5–6 seconds. */
  durationMs: number;
  aspectRatio: "9:16";
  /** Whether the renderer plays a short original sound cue. */
  hasSound: boolean;
}
