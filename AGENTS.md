# Bonko Template SDK

Read README.md and CHANGELOG.md before changes. This repository is the sole SDK source.
Keep protocol validation, browser sandbox, host lifecycle and package integrity aligned.
Do not import Bonko application or Studio source, databases, secrets or production services.
Use locked dependency versions. Never overwrite a released version.
Run pnpm typecheck, pnpm test, pnpm build and pnpm package:check before delivery.
Commit only requested changes. Publish releases only when authorized.
