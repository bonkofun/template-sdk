<h1 align="center">Bonko Template SDK</h1>
<p align="center"><strong>Versioned template contracts, package validation, and isolated browser runtime for Bonko.</strong></p>
<p align="center">
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/release.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/release.yml/badge.svg" alt="Release status" /></a>
  <img src="https://img.shields.io/badge/SDK-0.2.2-E8A0B5?style=flat" alt="SDK 0.2.2" />
  <img src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=flat" alt="TypeScript 5.7.3" />
  <img src="https://img.shields.io/badge/Node.js-22.12.0-339933?style=flat" alt="Node.js 22.12.0" />
</p>

This repository is the single source of truth for `@bonko/template-sdk`. The Bonko application and [Template Studio](https://github.com/bonkofun/template-studio) can consume the same pinned npm version. Neither consumer needs to clone this repository or compile SDK source during installation.

[Development](#local-development) · [Exports](#package-exports) · [Releasing](#publishing-a-release) · [Upgrades](#upgrading-consumers) · [Troubleshooting](#release-troubleshooting)

## Installation

After version 0.2.2 has been published to npm:

```bash
npm install @bonko/template-sdk
# Or pin the SDK version explicitly:
pnpm add --save-exact @bonko/template-sdk@0.2.2
```

The registry package contains compiled JavaScript and TypeScript declarations. No local SDK checkout, vendor archive, or build step is required to install it. React and Motion are peer dependencies; use the versions listed below for host integration.

```typescript
import { connectStandaloneTemplate } from '@bonko/template-sdk/runtime-client';
```

## Responsibilities

- Shared TypeScript contracts, template manifests, archive validation, integrity checks, and ZIP utilities.
- Template registration, host messages, playback, pause/resume, interaction waiting, static presentation, and managed audio.
- Isolated HTML and CSP generation, runtime gateway, asset loading, and React host integration.

The SDK contains no application pages, database access, account management, storage credentials, authoring CLI, or template artwork. The Worker gateway serves an isolated document; uploaded template JavaScript executes inside the recipient's browser iframe. Uploading a template does not run npm installation on the server.

## Technology stack

| Component | Version | Purpose |
| --- | --- | --- |
| Node.js | 22.12.0 minimum | Build and validation tools |
| pnpm | 10.30.3 | Locked dependency installation and packaging |
| TypeScript | 5.7.3 | Source compilation and declarations |
| Vitest | 4.1.11 | SDK and release-note tests |
| React | 19.2.8 | Peer dependency for React integration |
| Motion | 13.1.1 | Peer dependency for runtime animation |

## Local development

```bash
git clone https://github.com/bonkofun/template-sdk.git template-sdk
cd template-sdk
npm install --global pnpm@10.30.3
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm package:check
pnpm pack --pack-destination artifacts
```

The current archive is `artifacts/bonko-template-sdk-0.2.2.tgz`. It contains compiled JavaScript, TypeScript declarations, package metadata, and this README. Tests, source directories, credentials, and node_modules are excluded. Build output and archives are ignored by Git.

## Package exports

| Import path | Responsibility |
| --- | --- |
| `@bonko/template-sdk` | Shared types, template definitions, playback, and audio utilities |
| `@bonko/template-sdk/runtime-client` | Standalone template registration and static presentation |
| `@bonko/template-sdk/runtime-react` | React host integration |
| `@bonko/template-sdk/runtime-host` | Host lifecycle, budgets, and message processing |
| `@bonko/template-sdk/runtime-messages` | Message validation and protocol types |
| `@bonko/template-sdk/runtime-assets` | Asset loading and cleanup |
| `@bonko/template-sdk/runtime-document` | Sandbox documents and script integrity |
| `@bonko/template-sdk/runtime-gateway` | Runtime gateway, preview tokens, and origin validation |
| `@bonko/template-sdk/runtime-bundle` | Protocol v3 package creation and inspection |
| `@bonko/template-sdk/submission` | Submission manifests, capabilities, and resource limits |
| `@bonko/template-sdk/node` | Node.js archive and digest utilities |
| `@bonko/template-sdk/react` | Retained React compatibility interface |

New templates use the Studio v3 authoring workflow. Compatibility exports remain available for existing integrations.

## Version compatibility

The npm package version and the template protocol identifier are separate:

| Identifier | Current value |
| --- | --- |
| Package version | `0.2.2` |
| Template protocol | `3` |
| v3 manifest `sdkVersion` / `RUNTIME_SDK_VERSION` | `0.2.0` |
| Legacy protocol SDK identifier | `0.1.0` |

A compatible package patch does not automatically change the manifest identifier. Existing v3 templates can continue to declare `sdkVersion: "0.2.0"`. Evaluate host and Studio compatibility explicitly before changing protocol identifiers.

## GitHub Actions

Two workflows have separate responsibilities:

| Workflow | Trigger | Result |
| --- | --- | --- |
| [CI](.github/workflows/ci.yml) | Push to main, pull request, or manual run | Typecheck, tests, build, export/package checks, and a downloadable `sdk-package` artifact retained for 14 days |
| [GitHub Release](.github/workflows/release.yml) | Push a `v*.*.*` tag, or manually select an existing tag | Verify the tagged SDK, generate detailed notes, and publish to npm, then create a GitHub Release with the same TGZ and checksum |

The release workflow follows the Bonko application's `release.yml` conventions: SemVer validation, full Git history, commit-based release notes, prerelease detection, manual dispatch, and serialized publication for the same tag. SDK publication additionally checks the package version and verifies the built archive. Release creation fails if that release already exists; published SDK archives are never overwritten by this workflow.

Actions are pinned to commit SHAs. CI has read-only repository permissions; the release job uses `contents: write` with GitHub's built-in token. The release job also has `id-token: write` for npm trusted publishing. It uses Node.js 22.14.0 and npm 11.14.0; CI continues testing the minimum supported Node.js version. After npm trusted publishing has been configured, no persistent npm token is required. Repository or organization policy must allow Actions and the declared permissions.

## Publishing a release

### 1. Prepare the version

The current npm release candidate is `0.2.2`; the previous GitHub-only release is `0.2.1`. For a subsequent compatible patch, update the version explicitly:

```bash
pnpm version 0.2.3 --no-git-tag-version
```

Update `CHANGELOG.md`, the README version references, and relevant tests. Change protocol identifiers only when the compatibility contract changes. Use English Conventional Commits so generated release notes remain readable and categorized.

Run the local development checks above, review the changes, and commit only files belonging to the release. Merge the reviewed release commit into main before tagging.

### 2. Push the tag

From a clean main branch, derive the tag from the committed package version:

```bash
git switch main
git pull --ff-only origin main
release_version=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version')
git tag -a "v${release_version}" -m "Release v${release_version}"
git push origin "v${release_version}"
```

For the current package this pushes `v0.2.2`. A later `0.2.3` package pushes `v0.2.3`. Pushing a branch alone runs CI; pushing the version tag triggers publication. The tagged commit must already contain the release workflow.

### 3. What runs automatically

1. Validate the tag format, such as `v0.2.2` or `v0.3.0-rc.1`.
2. Check out that exact tag with full history, including for manual runs.
3. Require the tag to equal `v` plus `package.json.version`.
4. Install frozen dependencies, typecheck, test, build, and validate package exports and contents.
5. Generate detailed English release notes from the Git history.
6. Package the SDK and generate and verify `SHA256SUMS`.
7. Publish the verified archive to npm: stable versions use `latest`, prereleases use `next`.
8. Create the GitHub Release with the archive, checksum, and generated notes. Tags with a prerelease suffix are marked as prereleases.

Any failed step stops subsequent steps. If npm publication succeeds but GitHub Release creation fails, retrying accepts an existing npm version only when its integrity matches the local archive exactly. Registry errors other than a missing version stop publication. Published npm versions are never overwritten.

### 4. Inspect the result

Open the repository's **Actions → GitHub Release** run, then **Releases → the version tag**. Expected assets for `v0.2.2` are:

```text
bonko-template-sdk-0.2.2.tgz
SHA256SUMS
```

GitHub also provides source archives. Consumers should download the SDK TGZ, which includes compiled JavaScript and declarations, rather than the automatically generated source ZIP.

### Detailed release notes

[scripts/generate-release-notes.mjs](scripts/generate-release-notes.mjs) is adapted from the main application's generator. It includes a commit count, category totals, highlights, categorized changes, commit links, and a comparison link. Categories include features, fixes, breaking changes, performance, refactoring, documentation, tests, and maintenance. `!` markers and `BREAKING CHANGE:` footers identify breaking changes. Merge commits are excluded.

The comparison starts at the previous reachable version tag found in Git history; the first release includes the available history. Notes are derived from commit messages, not translated automatically and not copied from CHANGELOG.md. Keep commit subjects and bodies in English and maintain CHANGELOG.md as a curated compatibility record.

### Manual publication and retries

Open **Actions → GitHub Release → Run workflow**, provide an existing `release_tag` such as `v0.2.2`, and run it. Manual publication verifies and builds the requested tag, not the current main checkout. It does not create a missing tag or increment the version.

For a transient failure before release creation, rerun the failed workflow after resolving the issue. If a release already exists, the workflow fails instead of replacing its archives. Inspect partially created drafts before retrying. Publish a new version for changed code or package content; do not move published tags or overwrite published assets.

## npm authentication and initial setup

The npm account must own the `@bonko` scope or have publishing access through its npm organization. A GitHub organization with the same name does not automatically grant npm scope ownership.

For the initial publication, an authorized maintainer signs in locally:

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

Run all checks, pack into a clean `artifacts/` directory, and publish the verified archive with `node scripts/publish-npm.mjs`. Complete any npm browser/2FA prompts locally. Never paste tokens or one-time codes into source files or commit them.

After the package exists, configure its npm **Settings → Trusted Publisher → GitHub Actions**:

| Setting | Value |
| --- | --- |
| Organization or user | `bonkofun` |
| Repository | `template-sdk` |
| Workflow filename | `release.yml` |
| Environment | Leave empty; this workflow does not use a GitHub environment |
| Allowed action | Permit direct `npm publish` |

Subsequent tag pushes authenticate through OIDC. Do not push the npm release tag until the trusted publisher is configured. Trusted publishing requires npm 11.5.1+ and Node.js 22.14.0+; see the [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Upgrading consumers

After confirming the version exists on npm, install it directly in the application or Studio:

```bash
pnpm add --save-exact @bonko/template-sdk@0.2.2
# npm alternative:
npm install --save-exact @bonko/template-sdk@0.2.2
```

Commit package.json and the existing package manager's lockfile. Do not introduce a second lockfile. Once the registry installation has been verified, remove the old SDK vendor archive and any references to it in workspace distribution inventories. Studio upgrades also update dependency expectations and browser/template checks; application upgrades verify runtime Worker and host integration.

Older consumer checkouts retain their existing vendor dependency until explicitly migrated. Consumers do not automatically upgrade when a new SDK version is released. The GitHub Release TGZ and checksum remain available for audited offline distribution.

## Release troubleshooting

| Symptom | Resolution |
| --- | --- |
| No release workflow starts | Push the tag, verify it matches `v*.*.*`, and ensure its commit contains `release.yml` and Actions is enabled |
| Tag/version mismatch | Prepare a commit with the intended package version and publish its matching tag |
| Tag cannot be checked out | Push the existing local tag before using manual publication |
| npm authentication or scope error | Confirm account access for initial publication, or the exact trusted publisher repository/workflow settings for Actions |
| Permission error during publication | Check repository/organization Actions policies and the job's `contents: write` permission |
| Bundled Corepack reports `Cannot find matching keyid` | Install the pinned pnpm directly with `npm install --global pnpm@10.30.3`; package checks reuse the active pnpm CLI and do not invoke Corepack |
| Tests or package checks fail | Resolve the failure before publishing; no successful release is claimed by a failed workflow |
| Release already exists | Keep existing assets intact; use a new version for changes |
| Checksum mismatch | Discard the download and investigate the release assets before upgrading a consumer |

See [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create) for platform behavior.

## Maintenance and licensing

The SDK source and tests were extracted from the Bonko application's `packages/template-sdk` directory. Pre-extraction history remains in that repository. SDK tests run here; application integration and Studio browser tests remain in their respective repositories.

The package is `UNLICENSED`. Repository visibility alone does not grant an open-source license.
