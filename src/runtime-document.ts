/** Host-owned HTML wrapper. Uploaded packages never supply an HTML document. */
export interface RuntimeDocumentInput {
  script: string;
  stylesheet?: string;
  parentOrigin: string;
}
function parentOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("Invalid parent origin");
  return url.origin;
}
export async function scriptIntegrity(value: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(hash)))}`;
}
export function validateRuntimeSource(script: string, stylesheet = "") {
  // Reject terminators instead of rewriting uploaded JavaScript semantics.
  // The local bundler must emit HTML-safe output and validation checks it too.
  if (
    !script.trim() ||
    script.length > 8 * 1024 * 1024 ||
    /<\/script|<!--|\u0000/i.test(script)
  )
    throw new Error("Unsafe inline runtime bundle");
  if (stylesheet.length > 256 * 1024 || /<\/style|\u0000/i.test(stylesheet))
    throw new Error("Unsafe inline stylesheet");
}
export async function createRuntimeDocument(input: RuntimeDocumentInput) {
  const origin = parentOrigin(input.parentOrigin);
  const css = input.stylesheet ?? "";
  validateRuntimeSource(input.script, css);
  const hash = await scriptIntegrity(input.script);
  const csp = [
    "default-src 'none'",
    `script-src '${hash}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    "img-src blob: data:",
    "media-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origin}`,
    "sandbox allow-scripts",
  ].join("; ");
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Bonko template</title><style>html,body,#root{margin:0;width:100%;min-height:100%;overflow-wrap:anywhere}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script>${input.script}</script></body></html>`,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), midi=(), payment=(), usb=(), screen-wake-lock=()",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "private, no-store",
    },
  };
}
