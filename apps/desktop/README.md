# Lost Legacies Live desktop/web workspace

A lightweight React + Vite entry point for the portfolio headquarters.

## Commands

Run from the repository root:

- `pnpm --filter @lost-legacies/desktop dev` — start the Vite development server.
- `pnpm --filter @lost-legacies/desktop build` — create the production bundle.
- `pnpm --filter @lost-legacies/desktop preview` — preview the production bundle.

The initial UI consumes the shared core package directly from the workspace source. React and React DOM are loaded from esm.sh at runtime; the Vite CLI is invoked through pinned `npx` version 6.4.1. For an offline or fully hermetic build, vendor/pin dependencies and commit a generated lockfile before production use.

This is a browser-based desktop foundation, not a packaged native desktop binary. Electron/Tauri packaging is intentionally deferred until target platforms and signing/release requirements are confirmed.
