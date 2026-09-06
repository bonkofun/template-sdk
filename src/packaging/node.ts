import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { LIMITS, SDK_VERSION } from "../protocol/protocol.js";
import { parseTemplateManifest } from "../protocol/template.js";
import type { Template } from "../protocol/types.js";

export const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
export function filesDigest(files: Record<string, Uint8Array>) {
  return sha256(
    JSON.stringify(
      Object.keys(files)
        .sort()
        .map((name) => [name, sha256(files[name])]),
    ),
  );
}
export function safePath(path: string) {
  if (
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) ||
    path
      .split("/")
      .some((part) => part === "." || part === ".." || part.startsWith(".")) ||
    path.length > 240
  )
    throw new Error("Unsafe package path");
  return path;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deterministic ZIP writer: STORE only, fixed timestamps, sorted file names. */
export function writeZip(files: Record<string, Uint8Array>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const path of Object.keys(files).sort()) {
    safePath(path);
    const name = Buffer.from(path);
    const data = Buffer.from(files[path]);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(index, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...local, directory, end]);
  readZip(result);
  return result;
}

/** Bounded central-directory parser. No filesystem extraction and no ZIP64. */
export function readZip(input: Uint8Array): Record<string, Buffer> {
  const b = Buffer.from(input);
  if (b.length > LIMITS.compressed || b.length < 22)
    throw new Error("Invalid package size");
  const end = b.length - 22;
  if (
    b.readUInt32LE(end) !== 0x06054b50 ||
    b.readUInt32LE(end + 4) !== 0 ||
    b.readUInt16LE(end + 20) !== 0
  )
    throw new Error("Unsupported ZIP structure");
  const count = b.readUInt16LE(end + 10);
  const start = b.readUInt32LE(end + 16);
  if (
    !count ||
    count > LIMITS.files ||
    count !== b.readUInt16LE(end + 8) ||
    start + b.readUInt32LE(end + 12) !== end
  )
    throw new Error("Invalid ZIP directory");
  let cursor = start;
  let expanded = 0;
  const result: Record<string, Buffer> = Object.create(null);
  const folded = new Set<string>();
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || b.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Invalid ZIP entry");
    const flags = b.readUInt16LE(cursor + 8);
    const method = b.readUInt16LE(cursor + 10);
    const size = b.readUInt32LE(cursor + 24);
    const compressed = b.readUInt32LE(cursor + 20);
    const length = b.readUInt16LE(cursor + 28);
    const extra = b.readUInt16LE(cursor + 30);
    const comment = b.readUInt16LE(cursor + 32);
    const offset = b.readUInt32LE(cursor + 42);
    const unixType = (b.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
    if (
      flags & ~0x800 ||
      ![0, 8].includes(method) ||
      (unixType && unixType !== 0x8000) ||
      b.readUInt16LE(cursor + 34) ||
      extra ||
      cursor + 46 + length + comment > end
    )
      throw new Error("Unsupported ZIP entry");
    const name = safePath(
      b.subarray(cursor + 46, cursor + 46 + length).toString("utf8"),
    );
    if (folded.has(name.toLowerCase()))
      throw new Error("Duplicate package path");
    folded.add(name.toLowerCase());
    expanded += size;
    if (
      expanded > LIMITS.expanded ||
      size > Math.max(compressed * LIMITS.ratio, 1024)
    )
      throw new Error("Package expansion limit");
    if (
      offset + 30 > start ||
      b.readUInt32LE(offset) !== 0x04034b50 ||
      b.readUInt16LE(offset + 6) !== flags ||
      b.readUInt16LE(offset + 8) !== method ||
      b.readUInt32LE(offset + 18) !== compressed ||
      b.readUInt32LE(offset + 22) !== size ||
      b.readUInt16LE(offset + 26) !== length ||
      b.readUInt16LE(offset + 28)
    )
      throw new Error("Mismatched ZIP header");
    const from = offset + 30 + length;
    const to = from + compressed;
    if (
      to > start ||
      b.subarray(offset + 30, from).toString("utf8") !== name ||
      ranges.some(([a, z]) => offset < z && to > a)
    )
      throw new Error("Overlapping ZIP entry");
    ranges.push([offset, to]);
    const data =
      method === 0
        ? b.subarray(from, to)
        : inflateRawSync(b.subarray(from, to), {
            maxOutputLength: Math.max(1, size),
          });
    if (
      data.length !== size ||
      crc32(data) !== b.readUInt32LE(cursor + 16) ||
      crc32(data) !== b.readUInt32LE(offset + 14)
    )
      throw new Error("Corrupt package entry");
    result[name] = data;
    cursor += 46 + length + extra + comment;
  }
  if (cursor !== end) throw new Error("Invalid ZIP directory end");
  ranges.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [a, z] of ranges) {
    if (a !== covered) throw new Error("Unlisted ZIP content");
    covered = z;
  }
  if (covered !== start) throw new Error("Unlisted ZIP content");
  return result;
}

export interface Bundle {
  format: 1;
  kind: "template" | "source";
  renderer: {
    key: string;
    version: number;
    sdkVersion: string;
    digest: string;
  };
  files: Record<string, string>;
  license: string;
}
export function inspectBundle(bytes: Uint8Array, kind: Bundle["kind"]) {
  const files = readZip(bytes);
  if (!files["bundle.json"] || files["bundle.json"].length > 100_000)
    throw new Error("Missing bundle metadata");
  const metadata = JSON.parse(files["bundle.json"].toString()) as Bundle;
  if (
    !metadata ||
    metadata.format !== 1 ||
    metadata.kind !== kind ||
    !metadata.renderer ||
    metadata.renderer.sdkVersion !== SDK_VERSION ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(metadata.renderer.key) ||
    !Number.isSafeInteger(metadata.renderer.version) ||
    metadata.renderer.version < 1 ||
    !/^[a-f0-9]{64}$/.test(metadata.renderer.digest) ||
    typeof metadata.license !== "string" ||
    !metadata.license.trim() ||
    metadata.license.length > 10000 ||
    !metadata.files ||
    typeof metadata.files !== "object" ||
    Array.isArray(metadata.files)
  )
    throw new Error("Invalid bundle metadata");
  const listed = Object.keys(metadata.files);
  if (
    listed.length !== Object.keys(files).length - 1 ||
    listed.includes("bundle.json")
  )
    throw new Error("Invalid bundle inventory");
  for (const path of listed) {
    if (!files[path] || sha256(files[path]) !== metadata.files[path])
      throw new Error("Bundle hash mismatch");
    const permitted =
      kind === "template"
        ? path === "template.json" ||
          /^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|avif|mp3|ogg)$/.test(
            path,
          )
        : /^renderer\/[a-zA-Z0-9_/-]+(?:\.test)?\.(ts|tsx)$/.test(path);
    if (!permitted) throw new Error("File not allowed in this package");
  }
  let template: Template | undefined;
  if (kind === "template") {
    if (!files["template.json"] || files["template.json"].length > 100_000)
      throw new Error("Missing template manifest");
    template = parseTemplateManifest(
      JSON.parse(files["template.json"].toString()),
    );
    if (
      template.status !== "draft" ||
      !template.experience ||
      template.rendererKey !== metadata.renderer.key ||
      template.rendererVersion !== metadata.renderer.version ||
      template.experience.rendererDigest !== metadata.renderer.digest
    )
      throw new Error("Template dependency mismatch");
    const assets = new Set(Object.values(template.experience.assets));
    if (
      listed.some((path) => path !== "template.json" && !assets.has(path)) ||
      [...assets].some((path) => !files[path])
    )
      throw new Error("Unbound or missing assets");
    if (!assets.has(`assets/${template.cover.src.split("/").pop()}`))
      throw new Error("Cover must be a packaged asset");
    for (const path of assets) validateMedia(path, files[path]);
  } else {
    if (
      !files["renderer/plugin.ts"] ||
      !files["renderer/renderer.tsx"] ||
      !files["renderer/card.tsx"]
    )
      throw new Error("Missing renderer entrypoints");
    const sources = Object.fromEntries(
      listed.map((path) => [path.slice(9), files[path]]),
    );
    if (filesDigest(sources) !== metadata.renderer.digest)
      throw new Error("Renderer digest mismatch");
  }
  return { metadata, files, template, digest: sha256(bytes) };
}
export function validateMedia(path: string, bytes: Buffer) {
  const ext = path.split(".").pop();
  const ok =
    ext === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : ext === "webp"
        ? bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        : ext === "jpg" || ext === "jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : ext === "avif"
            ? bytes.toString("ascii", 4, 8) === "ftyp" &&
              bytes.toString("ascii", 8, 32).includes("avif")
            : ext === "ogg"
              ? bytes.toString("ascii", 0, 4) === "OggS"
              : ext === "mp3"
                ? bytes.toString("ascii", 0, 3) === "ID3" ||
                  (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)
                : false;
  if (!ok) throw new Error("Asset MIME mismatch");
}
export function packBundle(
  metadata: Omit<Bundle, "files" | "format">,
  files: Record<string, Uint8Array>,
) {
  const bundle: Bundle = {
    format: 1,
    ...metadata,
    files: Object.fromEntries(
      Object.keys(files)
        .sort()
        .map((path) => [path, sha256(files[path])]),
    ),
  };
  const bytes = writeZip({
    ...files,
    "bundle.json": Buffer.from(JSON.stringify(bundle)),
  });
  inspectBundle(bytes, metadata.kind);
  return bytes;
}
