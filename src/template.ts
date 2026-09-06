import { parseExperience } from "./protocol.js";
import { parseTemplateSubmission, parseRuntimeIntegrity, type RuntimeReference } from "./submission.js";
import type { Template } from "./types.js";

function object(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error(`Invalid ${path}`);
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  path: string,
  max = 500,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid ${path}`);
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`Unknown ${path} field`);
}

/** Local manifests remain data-only and are validated before catalog use. */
export function parseTemplateManifest(input: unknown): Template {
  const data = { ...object(input, "template") };
  const keys = [
    "runtime",
    "experience",
    "id",
    "slug",
    "version",
    "status",
    "access",
    "sortOrder",
    "cover",
    "config",
    "name",
    "occasion",
    "occasionLabel",
    "context",
    "description",
    "experienceSummary",
    "audience",
    "rendererKey",
    "rendererVersion",
    "posterStyle",
    "sample",
    "messagePresets",
    "durationMs",
    "aspectRatio",
    "hasSound",
  ];
  if (Object.keys(data).some((key) => !keys.includes(key)))
    throw new Error("Unknown template field");
  for (const key of [
    "id",
    "slug",
    "version",
    "name",
    "occasionLabel",
    "context",
    "description",
    "experienceSummary",
    "audience",
    "rendererKey",
  ]) {
    text(data[key], key);
  }
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(String(data.slug)) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(String(data.rendererKey))
  )
    throw new Error("Invalid slug or renderer key");
  if (
    !/^[1-9]\d*\.0$/.test(String(data.version)) ||
    !Number.isSafeInteger(parseInt(String(data.version)))
  )
    throw new Error("Template versions use N.0");
  if (
    typeof data.status !== "string" ||
    !["draft", "published", "archived"].includes(data.status)
  )
    throw new Error("Invalid template status");
  if (
    typeof data.access !== "string" ||
    !["free", "premium"].includes(data.access)
  )
    throw new Error("Invalid template access");
  if (
    typeof data.occasion !== "string" ||
    !["birthday", "anniversary", "pets", "achievement", "everyday"].includes(
      data.occasion,
    )
  )
    throw new Error("Invalid occasion");
  if (
    !Number.isSafeInteger(data.rendererVersion) ||
    Number(data.rendererVersion) < 1
  )
    throw new Error("Invalid renderer version");
  if (!Number.isSafeInteger(data.sortOrder) || Number(data.sortOrder) < 0)
    throw new Error("Invalid sort order");
  if (
    !Number.isSafeInteger(data.durationMs) ||
    Number(data.durationMs) < 2500 ||
    Number(data.durationMs) > (data.experience || data.runtime ? 30000 : 6000)
  )
    throw new Error("Duration must be 2500–6000ms");
  if (data.aspectRatio !== "9:16" || typeof data.hasSound !== "boolean")
    throw new Error("Invalid playback metadata");
  const colors = object(data.posterStyle, "posterStyle");
  onlyKeys(colors, ["background", "foreground", "accent"], "posterStyle");
  for (const key of ["background", "foreground", "accent"]) {
    if (
      typeof colors[key] !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(String(colors[key]))
    )
      throw new Error(`Invalid posterStyle.${key}`);
  }
  const cover = object(data.cover, "cover");
  onlyKeys(
    cover,
    ["src", "objectPosition", "foregroundText", "scrim"],
    "cover",
  );
  text(cover.src, "cover.src", 240);
  if (
    !/^\/(?:ui-reference\/template-covers|templates)\/[a-zA-Z0-9/_-]+\.(png|webp|jpg|jpeg|avif)$/.test(
      cover.src,
    )
  )
    throw new Error("Cover must be a local versioned image");
  text(cover.objectPosition, "cover.objectPosition", 24);
  if (
    !/^\d{1,3}% \d{1,3}%$/.test(cover.objectPosition) ||
    cover.objectPosition.split(" ").some((p) => parseInt(p) > 100)
  )
    throw new Error("Invalid cover position");
  if (
    typeof cover.foregroundText !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(cover.foregroundText)
  )
    throw new Error("Invalid cover foreground");
  const scrim = object(cover.scrim, "cover.scrim");
  onlyKeys(scrim, ["top", "bottom", "clearAt"], "scrim");
  for (const [key, max] of [
    ["top", 1],
    ["bottom", 1],
    ["clearAt", 100],
  ] as const) {
    if (
      typeof scrim[key] !== "number" ||
      !Number.isFinite(scrim[key]) ||
      Number(scrim[key]) < 0 ||
      Number(scrim[key]) > max
    )
      throw new Error("Invalid scrim");
  }
  const sample = object(data.sample, "sample");
  onlyKeys(sample, ["recipientName", "message", "senderName"], "sample");
  text(sample.recipientName, "sample.recipientName", 30);
  text(sample.message, "sample.message", 160);
  if (typeof sample.senderName !== "string" || sample.senderName.length > 30)
    throw new Error("Invalid sample sender");
  if (
    !Array.isArray(data.messagePresets) ||
    data.messagePresets.length < 1 ||
    data.messagePresets.length > 8
  )
    throw new Error("Expected 1–8 presets");
  data.messagePresets.forEach((value) => text(value, "message preset", 160));
  const config = object(data.config, "config");
  if (
    Object.keys(config).length > 32 ||
    Object.entries(config).some(
      ([key, value]) =>
        !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key) ||
        ["constructor", "prototype"].includes(key) ||
        !(
          typeof value === "boolean" ||
          (typeof value === "string" && value.length <= 500) ||
          (typeof value === "number" && Number.isFinite(value))
        ),
    )
  ) {
    throw new Error("Config must contain bounded primitive values");
  }
  if (data.experience !== undefined) parseExperience(data.experience);
  if (data.runtime !== undefined) {
    if (data.experience !== undefined || data.rendererKey !== "isolated-runtime" || data.rendererVersion !== 3) throw new Error("Invalid isolated runtime identity");
    const runtime = object(data.runtime, "runtime");
    onlyKeys(runtime, ["protocol", "sdkVersion", "digest", "author", "templateType", "tags", "assets", "capabilities", "integrity"], "runtime");
    if (typeof runtime.digest !== "string" || !/^[a-f0-9]{64}$/.test(runtime.digest)) throw new Error("Invalid runtime digest");
    const prefix = `/templates/${data.slug}/v${parseInt(String(data.version))}/${runtime.digest}/assets/`;
    if (!String(cover.src).startsWith(prefix)) throw new Error("Runtime cover must be bound to its immutable package");
    const checked = parseTemplateSubmission({ protocol: runtime.protocol, sdkVersion: runtime.sdkVersion, slug: data.slug, version: data.version,
      name: data.name, description: data.description, author: runtime.author, templateType: runtime.templateType, access: data.access,
      tags: runtime.tags, cover: Object.keys(object(runtime.assets, "assets")).find(id => {
        const asset = (runtime.assets as Record<string, {path?: string}>)[id];
        return asset?.path === `assets/${String(cover.src).split("/").pop()}`;
      }), assets: runtime.assets, entry: "runtime/entry.js", capabilities: runtime.capabilities, config: data.config, sample: data.sample,
      messagePresets: data.messagePresets, posterStyle: data.posterStyle });
    if (data.hasSound !== checked.capabilities.includes("audio")) throw new Error("Runtime sound capability mismatch");
    data.runtime = { protocol: 3, sdkVersion: checked.sdkVersion, digest: runtime.digest, author: checked.author, templateType: checked.templateType,
      tags: checked.tags, assets: checked.assets, capabilities: checked.capabilities,
      ...(runtime.integrity !== undefined ? { integrity: parseRuntimeIntegrity(checked.assets, runtime.integrity) } : {}) } satisfies RuntimeReference;
  }
  // All public fields were checked above; plugin-specific config is checked by its registration.
  return structuredClone(data) as unknown as Template;
}

export function createTemplateCatalog(inputs: readonly unknown[]) {
  const versions = new Map<string, Template>();
  const latest = new Map<string, Template>();
  const slugIds = new Map<string, string>();
  const idSlugs = new Map<string, string>();
  for (const input of inputs) {
    const template = parseTemplateManifest(input);
    const key = `${template.slug}@${template.version}`;
    if (versions.has(key)) throw new Error(`Duplicate template: ${key}`);
    if (
      (slugIds.has(template.slug) &&
        slugIds.get(template.slug) !== template.id) ||
      (idSlugs.has(template.id) && idSlugs.get(template.id) !== template.slug)
    )
      throw new Error("Template identity changed");
    versions.set(key, template);
    slugIds.set(template.slug, template.id);
    idSlugs.set(template.id, template.slug);
    if (template.status !== "published") continue;
    const previous = latest.get(template.slug);
    if (!previous || parseInt(template.version) > parseInt(previous.version))
      latest.set(template.slug, template);
  }
  return {
    published: [...latest.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug),
    ),
    getVersion(slug: string, version: string) {
      const template = versions.get(`${slug}@${version}`);
      return template?.status !== "draft" ? template : undefined;
    },
  };
}
