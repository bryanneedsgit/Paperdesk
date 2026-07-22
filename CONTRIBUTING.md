# Contributing to Paperdesk

Thank you for helping improve Paperdesk.

## Before you start

- Search existing issues before opening a new one.
- Keep changes focused and explain the user-facing reason for them.
- Never commit private PDFs, credentials, signing certificates, generated builds, or local development logs.

## Development setup

Install Node.js 18 or newer, Rust, Cargo, and the Tauri prerequisites for your operating system. Then run:

```bash
npm install
npm run dev
```

Use `npm run dev:vite` when you only need the frontend.

## Checks

Run these checks before opening a pull request:

```bash
npm run lint
npm run typecheck
npm run test
npm run build:vite
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Platform bundles must be built on their target operating system. See [README.md](README.md) for macOS and Windows build details.

## Pull requests

- Include tests for behavior changes when practical.
- Update the guide or README when user-facing behavior changes.
- Keep generated files and unrelated formatting changes out of the pull request.
- Confirm that any new assets or dependencies can be redistributed under terms compatible with this project.
