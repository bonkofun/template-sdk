<h1 align="center">Bonko Template SDK</h1>
<p align="center"><strong>Versioned template contracts, package validation, and isolated browser runtime for Bonko.</strong></p>
<p align="center">
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/release.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/release.yml/badge.svg?event=push" alt="Release status" /></a>
  <img src="https://img.shields.io/badge/SDK-0.2.4-E8A0B5?style=flat" alt="SDK 0.2.4" />
  <img src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=flat" alt="TypeScript 5.7.3" />
  <img src="https://img.shields.io/badge/Node.js-22.12.0-339933?style=flat" alt="Node.js 22.12.0" />
</p>

Shared TypeScript contracts, package validation, and browser runtime for Bonko templates. Used by the Bonko application and [Template Studio](https://github.com/bonkofun/template-studio).

## Install

```bash
npm install @bonko/template-sdk
```

Or with pnpm:

```bash
pnpm add @bonko/template-sdk
```

Requires Node.js **22.12.0+**. React **19.2.8** and Motion **13.1.1** are peer dependencies. The package includes compiled JavaScript and TypeScript declarations.

## Use

Register a template inside a Bonko isolated runtime. This minimal example displays the recipient's name and message:

```typescript
import { connectStandaloneTemplate } from '@bonko/template-sdk/runtime-client';

const root = document.createElement('main');
document.body.append(root);

connectStandaloneTemplate({
  render({ content }) {
    root.textContent = `${content.recipientName}: ${content.message}`;
  },
  renderStatic({ content }) {
    root.textContent = `${content.recipientName}: ${content.message}`;
    return () => root.replaceChildren();
  },
  dispose() {
    root.replaceChildren();
  },
});
```

The client requires a Bonko host iframe; it does not run as a standalone page. Use [Template Studio](https://github.com/bonkofun/template-studio) to create, preview, and package complete templates. Interactive templates must handle playback state and report completion.

| Import | Use |
| --- | --- |
| `@bonko/template-sdk/runtime-client` | Template registration and lifecycle |
| `@bonko/template-sdk/runtime-react` | React host integration |
| `@bonko/template-sdk/runtime-bundle` | Template package creation and validation |
| `@bonko/template-sdk/runtime-gateway` | Isolated runtime gateway |

SDK **0.2.3** supports Template Protocol **v3** with manifest `sdkVersion: "0.2.0"`.

## License

[MIT](LICENSE) © 2026 Bonko contributors.

### Natural completion

The React RuntimeFrame keeps the live final frame mounted when playback completes
naturally. It does not hide the iframe or request a second static rendering.
Templates must settle into a readable result before calling `runtime.complete()`.
Authored static rendering remains required for previews, skip, and reduced motion.

## Cinematic contract (0.3.0 candidate)

Package 0.3.0 accepts both manifest SDK contracts 0.2.0 and 0.3.0 with protocol 3.
Opt into `sdkVersion: "0.3.0"` and capability `video` for flat `assets/*.mp4` files.
Supported movies have exactly one silent H.264 track, at most 30 seconds, a
1920px maximum edge, 2,073,600 pixels and 60fps. The shared parser validates
bounded container/sample metadata; browser playback checks remain necessary.
Audio stays separate (MP3/OGG, up to 30 seconds for this contract). Existing
0.2.0 templates retain the ten-second audio limit and cannot declare videos.

Use `runtime.asset(id)` for the muted, inline video and
`runtime.audio.sync?.(audioId, positionMs)` for its soundtrack. Report the current
clock regularly; the host owns permission, mute, pause, backgrounding and replay.
Stop media and frame callbacks on pause/dispose; provide a complete static entry.
The runtime gateway enables blob media only for a trusted stored document whose
`video` flag was derived from the validated manifest. Remote media stays blocked.

Roll out the SDK, CLI, Admin, main-site host and runtime Worker together before
publishing cinematic inventory. This candidate does not itself deploy consumers.
