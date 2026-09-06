<h1 align="center">Bonko Template SDK</h1>
<p align="center"><strong>Versioned template contracts, package validation, and isolated browser runtime for Bonko.</strong></p>
<p align="center">
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/bonkofun/template-sdk/actions/workflows/release.yml"><img src="https://github.com/bonkofun/template-sdk/actions/workflows/release.yml/badge.svg" alt="Release status" /></a>
  <img src="https://img.shields.io/badge/SDK-0.2.1-E8A0B5?style=flat" alt="SDK 0.2.1" />
  <img src="https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=flat" alt="TypeScript 5.7.3" />
  <img src="https://img.shields.io/badge/Node.js-22.12.0-339933?style=flat" alt="Node.js 22.12.0" />
</p>

This repository is the single source of truth for `@bonko/template-sdk`. The Bonko application and [Template Studio](https://github.com/bonkofun/template-studio) consume the same pinned distribution. Neither consumer needs to clone this repository or compile SDK source during installation.

[Development](#local-development) · [Exports](#package-exports) · [Releasing](#publishing-a-release) · [Upgrades](#upgrading-consumers) · [Troubleshooting](#release-troubleshooting)

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

The current archive is `artifacts/bonko-template-sdk-0.2.1.tgz`. It contains compiled JavaScript, TypeScript declarations, package metadata, and this README. Tests, source directories, credentials, and node_modules are excluded. Build output and archives are ignored by Git.

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
| Package version | `0.2.1` |
| Template protocol | `3` |
| v3 manifest `sdkVersion` / `RUNTIME_SDK_VERSION` | `0.2.0` |
| Legacy protocol SDK identifier | `0.1.0` |

A compatible package patch does not automatically change the manifest identifier. Existing v3 templates can continue to declare `sdkVersion: "0.2.0"`. Evaluate host and Studio compatibility explicitly before changing protocol identifiers.

## GitHub Actions

Two workflows have separate responsibilities:

| Workflow | Trigger | Result |
| --- | --- | --- |
| [CI](.github/workflows/ci.yml) | Push to main, pull request, or manual run | Typecheck, tests, build, export/package checks, and a downloadable `sdk-package` artifact retained for 14 days |
| [GitHub Release](.github/workflows/release.yml) | Push a `v*.*.*` tag, or manually select an existing tag | Verify the tagged SDK, generate detailed notes, and publish a GitHub Release with the TGZ and checksum |

The release workflow follows the Bonko application's `release.yml` conventions: SemVer validation, full Git history, commit-based release notes, prerelease detection, manual dispatch, and serialized publication for the same tag. SDK publication additionally checks the package version and verifies the built archive. Release creation fails if that release already exists; published SDK archives are never overwritten by this workflow.

Actions are pinned to commit SHAs. CI has read-only repository permissions; the release job uses `contents: write` with GitHub's built-in token. No npm token, personal access token, database secret, or storage credential is needed. Repository or organization policy must allow Actions and the declared permissions.

## Publishing a release

### 1. Prepare the version

For the first independent release, the current version is `0.2.1`. For a subsequent compatible patch, update the version explicitly:

```bash
pnpm version 0.2.2 --no-git-tag-version
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

For the current package this pushes `v0.2.1`. A later `0.2.2` package pushes `v0.2.2`. Pushing a branch alone runs CI; pushing the version tag triggers publication. The tagged commit must already contain the release workflow.

### 3. What runs automatically

1. Validate the tag format, such as `v0.2.1` or `v0.3.0-rc.1`.
2. Check out that exact tag with full history, including for manual runs.
3. Require the tag to equal `v` plus `package.json.version`.
4. Install frozen dependencies, typecheck, test, build, and validate package exports and contents.
5. Generate detailed English release notes from the Git history.
6. Package the SDK and generate and verify `SHA256SUMS`.
7. Create the GitHub Release with the archive, checksum, and generated notes. Tags with a prerelease suffix are marked as prereleases.

Any failed step stops publication. This publishes a GitHub Release, not an npm registry package. `private: true` in package.json prevents accidental npm publication; it does not control GitHub repository visibility.

### 4. Inspect the result

Open the repository's **Actions → GitHub Release** run, then **Releases → the version tag**. Expected assets for `v0.2.1` are:

```text
bonko-template-sdk-0.2.1.tgz
SHA256SUMS
```

GitHub also provides source archives. Consumers should download the SDK TGZ, which includes compiled JavaScript and declarations, rather than the automatically generated source ZIP.

### Detailed release notes

[scripts/generate-release-notes.mjs](scripts/generate-release-notes.mjs) is adapted from the main application's generator. It includes a commit count, category totals, highlights, categorized changes, commit links, and a comparison link. Categories include features, fixes, breaking changes, performance, refactoring, documentation, tests, and maintenance. `!` markers and `BREAKING CHANGE:` footers identify breaking changes. Merge commits are excluded.

The comparison starts at the previous reachable version tag found in Git history; the first release includes the available history. Notes are derived from commit messages, not translated automatically and not copied from CHANGELOG.md. Keep commit subjects and bodies in English and maintain CHANGELOG.md as a curated compatibility record.

### Manual publication and retries

Open **Actions → GitHub Release → Run workflow**, provide an existing `release_tag` such as `v0.2.1`, and run it. Manual publication verifies and builds the requested tag, not the current main checkout. It does not create a missing tag or increment the version.

For a transient failure before release creation, rerun the failed workflow after resolving the issue. If a release already exists, the workflow fails instead of replacing its archives. Inspect partially created drafts before retrying. Publish a new version for changed code or package content; do not move published tags or overwrite published assets.

## Upgrading consumers

After a release succeeds, download its archive and checksum into a fresh directory:

```bash
release_directory=$(mktemp -d)
gh release download v0.2.1 --repo bonkofun/template-sdk \
  --pattern 'bonko-template-sdk-0.2.1.tgz' \
  --pattern SHA256SUMS --dir "$release_directory"
(cd "$release_directory" && shasum -a 256 -c SHA256SUMS)
```

On Linux, `sha256sum -c SHA256SUMS` is also supported. Downloading from a private repository requires an authenticated account with access.

Copy the verified archive into the consumer's `vendor/` directory and pin it exactly:

```json
{
  "dependencies": {
    "@bonko/template-sdk": "file:vendor/bonko-template-sdk-0.2.1.tgz"
  }
}
```

Run `pnpm install` in the consumer to update its lockfile, then execute its relevant checks. Studio upgrades also update the workspace distribution inventory, dependency expectations, documentation, and browser/template checks. Main application upgrades verify package import, the runtime Worker, and host integration. Commit the archive and lockfile with the consumer change.

Consumers do not automatically follow main, latest, or a newly published SDK release. Once the archive is committed, normal consumer installation does not require SDK repository access.

## Release troubleshooting

| Symptom | Resolution |
| --- | --- |
| No release workflow starts | Push the tag, verify it matches `v*.*.*`, and ensure its commit contains `release.yml` and Actions is enabled |
| Tag/version mismatch | Prepare a commit with the intended package version and publish its matching tag |
| Tag cannot be checked out | Push the existing local tag before using manual publication |
| Permission error during publication | Check repository/organization Actions policies and the job's `contents: write` permission |
| Bundled Corepack reports `Cannot find matching keyid` | Install the pinned pnpm directly with `npm install --global pnpm@10.30.3`; package checks reuse the active pnpm CLI and do not invoke Corepack |
| Tests or package checks fail | Resolve the failure before publishing; no successful release is claimed by a failed workflow |
| Release already exists | Keep existing assets intact; use a new version for changes |
| Checksum mismatch | Discard the download and investigate the release assets before upgrading a consumer |

See [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create) for platform behavior.

## Maintenance and licensing

The SDK source and tests were extracted from the Bonko application's `packages/template-sdk` directory. Pre-extraction history remains in that repository. SDK tests run here; application integration and Studio browser tests remain in their respective repositories.

The package is `UNLICENSED`. Repository visibility alone does not grant an open-source license.
