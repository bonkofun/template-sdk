# Changelog

## 0.2.4

- Keep the live terminal frame mounted on natural completion, avoiding a loading flash and a second static render.
- Preserve authored static presentation for preview, skip, and reduced motion; errors retain the readable fallback.

## 0.2.3

- Organize source and colocated tests into protocol, runtime, React, gateway, and packaging modules.
- Preserve all public package import paths and v3 protocol compatibility.
- Clean build output before compilation to prevent obsolete files in release packages.
- Ship the concise README and MIT license in the npm distribution.

## 0.2.2

- Enable public npm distribution and direct installation of `@bonko/template-sdk`.
- Publish the verified release archive with GitHub Actions trusted publishing.
- Preserve v3 manifest compatibility (`sdkVersion: "0.2.0"`).

## 0.2.1

- Reuse the active pnpm CLI during package checks to avoid the older Corepack bundled with Node.js 22.12.0.

- Move the SDK source and its 151 tests into an independent repository.
- Include the main-site optional RuntimeFrame loading placeholder that was absent
  from the Studio 0.2.0 distribution. No implementation changes during extraction.
- Add independent CI, package export checks and tag-based GitHub releases.
- Package version is 0.2.1; v3 RUNTIME_SDK_VERSION remains 0.2.0 for compatibility.

## 0.2.0

Previous distribution maintained in the main-site repository. Supports Template
Protocol v3, authored static presentation and the isolated runtime gateway.
