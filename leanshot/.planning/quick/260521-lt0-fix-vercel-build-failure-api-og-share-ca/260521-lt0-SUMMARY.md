---
quick_id: 260521-lt0
status: complete
date: 2026-05-21
---

# Quick Task 260521-lt0 — Vercel build failure (api/ OG share-card functions)

## Diagnosis

User reported "vercel is failing; check supabase is fine."

- **Vercel:** last 3 production deploys (`oi5ixv7yf`, `a3ryt7zxm`, `m9yt8k0kl`) all `● Error`; everything ≥53m prior was `● Ready`. Failure started when Phase 35-07 (commit `51f99f0`) hit `main`. Build log (`vercel inspect <url> --logs`) showed the marketing vite build SUCCEEDS, then Vercel's function compile fails:
  - `api/og/level-up.tsx` + `api/share/level/[token].tsx`: `TS2835` (relative imports need `.js` extension under node16/nodenext moduleResolution).
  - `api/og/level-up.tsx`: `TS17004` ×6 (Cannot use JSX unless `--jsx` is set) — `@vercel/og` `ImageResponse` uses JSX.
  - Downstream: "Edge Function api/og/level-up referencing unsupported modules" (symptom of the failed compile).
- **Root cause:** no tsconfig governs `api/`. Root `tsconfig.json` is references-only (no `jsx`, no compilerOptions); `tsc -b` project refs exclude `api/`, so local `npm run build` never compiles these files → **Vercel-only failure** that passed every local check.
- **Supabase:** HEALTHY. `supabase migration list --linked` → local = remote (no drift). `supabase db query --linked "select 1"` → responded. No action needed.

## Fix

1. **NEW `api/tsconfig.json`** — scopes the Vercel function compile: `jsx: react-jsx`, `moduleResolution: bundler`, `module: esnext`, `types: ["node"]` (for `process.env`), strict. Mirrors `tsconfig.app.json`.
2. **`api/og/level-up.tsx`** + **`api/share/level/[token].tsx`** — added explicit `.js` extension to the `_token` relative imports (insurance if Vercel forces node16 resolution).

Covers both scenarios: if Vercel honors `bundler` resolution → clean; if it forces node16 → explicit `.js` + `jsx`/`node` types from the tsconfig still satisfy it.

## Verification

- `npx tsc -p api/tsconfig.json --noEmit` → clean (was 8 errors: 2×TS2835 + 6×TS17004 + 3×TS2591 process after an interim `types:[]` misstep, now 0).
- `npx tsc -p tsconfig.app.json --noEmit` → clean (no app regression).
- Deploy-time confirmation pending the next push to `main` (was awaiting user go-ahead — push triggers prod deploy).

## Notes / follow-up

- This is the inverse of the local-build blind spot: `api/` functions are compiled ONLY by Vercel, never by `tsc -b`/vite locally. Consider adding `api/` to a local typecheck step (e.g. `tsc -p api/tsconfig.json --noEmit` in CI / a pre-push hook) so future api/ regressions are caught before deploy.
