import { LIMITS } from "./protocol.js";
/** v3 is a standalone runtime package, not a registry renderer registration. */
export const RUNTIME_PROTOCOL = 3 as const;
export const RUNTIME_SDK_VERSION = "0.2.0";
export const TEMPLATE_CATEGORIES = Object.freeze({
  birthday: "Birthday",
  anniversary: "Anniversary",
  pets: "Pets",
  achievement: "Achievement",
  everyday: "Everyday",
});
export type TemplateCategory = keyof typeof TEMPLATE_CATEGORIES;
export type TemplateAccess = "free" | "premium";
export type RuntimeIntegrity = Record<string, { sha256: string; byteSize: number; contentType: string }>;
export type RuntimeReference = Pick<TemplateSubmission, "protocol" | "sdkVersion" | "author" | "templateType" | "tags" | "assets" | "capabilities"> & { digest: string; integrity?: RuntimeIntegrity };
export type SubmissionAsset = { path: string; kind: "image" | "audio" };
/** Server-derived metadata keyed by logical asset ID, never accepted in author manifests. */
export function parseRuntimeIntegrity(assets: Record<string, SubmissionAsset>, input: unknown): RuntimeIntegrity {
  const data = record(input);
  const ids = Object.keys(assets);
  if (Object.keys(data).length !== ids.length || Object.keys(data).some(id => !Object.hasOwn(assets, id))) throw new Error("Runtime integrity asset mismatch");
  const output: RuntimeIntegrity = {};
  const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", mp3: "audio/mpeg", ogg: "audio/ogg" };
  let total = 0;
  for (const id of ids) {
    const item = record(data[id]);
    keys(item, ["sha256", "byteSize", "contentType"]);
    if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.byteSize) || Number(item.byteSize) < 1 || item.contentType !== mime[assets[id].path.split(".").pop()!]) throw new Error("Invalid runtime integrity");
    total += Number(item.byteSize);
    output[id] = { sha256: item.sha256, byteSize: Number(item.byteSize), contentType: String(item.contentType) };
  }
  if (total > LIMITS.expanded) throw new Error("Runtime integrity exceeds size limit");
  return output;
}
export interface TemplateSubmission {
  protocol: 3;
  sdkVersion: string;
  slug: string;
  version: string;
  name: string;
  description: string;
  author: string;
  templateType: "static" | "interactive";
  access: TemplateAccess;
  tags: string[];
  cover: string;
  assets: Record<string, SubmissionAsset>;
  entry: "runtime/entry.js";
  stylesheet?: "runtime/style.css";
  capabilities: ("audio" | "canvas" | "webgl")[];
  config: Record<string, string | number | boolean>;
  sample: { recipientName: string; message: string; senderName: string };
  messagePresets: string[];
  posterStyle: { background: string; foreground: string; accent: string };
}

function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("Expected a plain object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown manifest field");
}
function text(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== "string" ||
    [...value].length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    throw new Error("Invalid text");
  return value.trim();
}
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5)
    throw new Error("Use at most five tags");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const input of value) {
    if (typeof input !== "string" || input.length > 200)
      throw new Error("Invalid tag");
    const tag = text(input.normalize("NFKC").trim(), 20, true);
    if (!tag) continue;
    if (/[<>\r\n]/u.test(tag))
      throw new Error("Tags must be plain single-line text");
    const identity = tag.toLowerCase();
    if (!seen.has(identity)) {
      result.push(tag);
      seen.add(identity);
    }
  }
  return result;
}
export function parseTemplateCategory(value: unknown): TemplateCategory {
  if (typeof value !== "string" || !Object.hasOwn(TEMPLATE_CATEGORIES, value))
    throw new Error("Choose an existing category");
  return value as TemplateCategory;
}
export function parseTemplateAccess(value: unknown): TemplateAccess {
  if (value !== "free" && value !== "premium")
    throw new Error("Invalid access");
  return value;
}
export function parseTemplateSubmission(value: unknown): TemplateSubmission {
  const m = record(value);
  keys(m, [
    "protocol",
    "sdkVersion",
    "slug",
    "version",
    "name",
    "description",
    "author",
    "templateType",
    "access",
    "tags",
    "cover",
    "assets",
    "entry",
    "stylesheet",
    "capabilities",
    "config",
    "sample",
    "messagePresets",
    "posterStyle",
  ]);
  if (m.protocol !== RUNTIME_PROTOCOL || m.sdkVersion !== RUNTIME_SDK_VERSION)
    throw new Error("Unsupported runtime protocol or SDK");
  const slug = text(m.slug, 80);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("Invalid slug");
  const version = text(m.version, 16);
  if (
    !/^[1-9]\d*\.0$/.test(version) ||
    !Number.isSafeInteger(parseInt(version))
  )
    throw new Error("Version must be N.0");
  if (m.templateType !== "static" && m.templateType !== "interactive")
    throw new Error("Invalid template type");
  if (
    m.entry !== "runtime/entry.js" ||
    (m.stylesheet !== undefined && m.stylesheet !== "runtime/style.css")
  )
    throw new Error("Invalid runtime entry");
  if (
    !Array.isArray(m.capabilities) ||
    m.capabilities.length > 3 ||
    m.capabilities.some((c) => !["audio", "canvas", "webgl"].includes(c)) ||
    new Set(m.capabilities).size !== m.capabilities.length
  )
    throw new Error("Invalid capability declaration");
  const rawAssets = record(m.assets);
  if (Object.keys(rawAssets).length < 1 || Object.keys(rawAssets).length > 100)
    throw new Error("Invalid asset count");
  const assets: Record<string, SubmissionAsset> = Object.create(null);
  for (const [id, input] of Object.entries(rawAssets)) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(id) ||
      ["constructor", "prototype"].includes(id)
    )
      throw new Error("Invalid asset ID");
    const asset = record(input);
    keys(asset, ["path", "kind"]);
    const path = text(asset.path, 160);
    if (
      asset.kind === "image"
        ? !/^assets\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|avif)$/.test(path)
        : asset.kind === "audio"
          ? !/^assets\/[A-Za-z0-9_-]+\.(mp3|ogg)$/.test(path)
          : true
    )
      throw new Error("Invalid asset path or kind");
    if (asset.kind === "audio" && !m.capabilities.includes("audio"))
      throw new Error("Audio capability required");
    assets[id] = { path, kind: asset.kind as SubmissionAsset["kind"] };
  }
  const cover = text(m.cover, 64);
  if (!Object.hasOwn(assets, cover) || assets[cover].kind !== "image")
    throw new Error("Cover must reference a packaged image");
  const sample = record(m.sample);
  keys(sample, ["recipientName", "message", "senderName"]);
  const config = record(m.config);
  if (
    Object.keys(config).length > 32 ||
    Object.entries(config).some(
      ([key, value]) =>
        !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key) ||
        ["constructor", "prototype"].includes(key) ||
        !(
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" &&
            value.length <= 500 &&
            !/[<>]|(?:https?:|data:|javascript:|\/\/)/i.test(value))
        ),
    )
  )
    throw new Error("Invalid bounded config");
  if (
    !Array.isArray(m.messagePresets) ||
    m.messagePresets.length < 1 ||
    m.messagePresets.length > 8
  )
    throw new Error("Use 1–8 presets");
  const poster = record(m.posterStyle);
  keys(poster, ["background", "foreground", "accent"]);
  for (const color of [poster.background, poster.foreground, poster.accent])
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
      throw new Error("Invalid poster color");
  return {
    protocol: 3,
    sdkVersion: RUNTIME_SDK_VERSION,
    slug,
    version,
    name: text(m.name, 80),
    description: text(m.description, 500),
    author: text(m.author, 80),
    templateType: m.templateType,
    access: parseTemplateAccess(m.access),
    tags: normalizeTags(m.tags),
    cover,
    assets,
    entry: m.entry,
    ...(m.stylesheet ? { stylesheet: m.stylesheet } : {}),
    capabilities: m.capabilities as TemplateSubmission["capabilities"],
    config: { ...config } as TemplateSubmission["config"],
    sample: {
      recipientName: text(sample.recipientName, 30),
      message: text(sample.message, 160),
      senderName: text(sample.senderName, 30, true),
    },
    messagePresets: m.messagePresets.map((p) => text(p, 160)),
    posterStyle: poster as TemplateSubmission["posterStyle"],
  };
}
