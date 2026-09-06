# Bonko Template SDK

Read README.md and CHANGELOG.md before changes. This repository is the sole SDK source.
Keep protocol validation, browser sandbox, host lifecycle and package integrity aligned.
Do not import Bonko application or Studio source, databases, secrets or production services.
Use locked dependency versions. Never overwrite a released version.
Run pnpm typecheck, pnpm test, pnpm build and pnpm package:check before delivery.
Commit only requested changes. Publish releases only when authorized.

## Language and release conventions

- Write README.md and all GitHub repository descriptions entirely in English.
- Write every Git commit subject and body in English, using Conventional Commits.
- Write workflow labels, release documentation and generated release notes in English.
- Maintain `.github/workflows/release.yml` using the Bonko main-site release workflow
  as the reference: tag push/manual dispatch, SemVer validation, full Git history,
  categorized commit-based notes, prerelease detection and serialized publication.
- SDK releases must additionally match package.json, pass tests and package checks,
  and include the built TGZ plus SHA256SUMS. Never overwrite published SDK assets.
- Package versions and protocol compatibility identifiers are separate; do not bump
  protocol identifiers automatically for documentation or compatible package changes.

- Publish the verified archive to public npm before creating the GitHub Release.
  Use trusted publishing (OIDC) in GitHub Actions; never commit registry tokens.
  Keep stable releases on latest and prereleases on next. Existing npm versions
  may only be reused when their integrity exactly matches the verified archive.
