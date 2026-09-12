# Janus — Agent Guide (zhaojian fork)

**Before making any change, read [`MODIFICATIONS.md`](./MODIFICATIONS.md)** — it is the single source of truth for all local modifications on the `zhaojian` branch (build fixes, UI English translation, dual-pane file manager + transfer engine), their current verification status, and the rules you must follow.

## Quick facts

- Branch: `zhaojian` (never switch back to `main`; do not discard uncommitted changes). Base: Janus 1.9.0.
- Stack: Electron 33 + React 18 + TypeScript + electron-vite + ssh2 + Tailwind + zustand.
- Layout: `src/main/` (main process), `src/preload/` (bridge), `src/renderer/src/` (UI), `src/shared/` (shared types/IPC channels).
- Verify after every change: `npm run typecheck` && `npm run build` && `git diff --check`.
- Hard rules: do not touch crypto/auth logic, IPC channel names, or the vault schema; all UI text is hardcoded **English**; never commit credentials; only commit when the user explicitly asks.
- After changing behavior, update `MODIFICATIONS.md` (sections + "last updated" date + verification status).
