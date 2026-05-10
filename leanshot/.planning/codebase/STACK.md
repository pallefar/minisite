# Technology Stack

**Analysis Date:** 2026-05-10

## Languages

**Primary:**
- TypeScript ~5.6.3 — All source under `src/` (`.ts`, `.tsx`). Strict mode enabled (`tsconfig.app.json:14`)
- TSX/JSX (`react-jsx` transform) — All UI components (e.g. `src/App.tsx`, `src/components/**/*.tsx`)

**Secondary:**
- CSS — Single global stylesheet `src/index.css` (Tailwind v4 `@theme` + custom properties)
- HTML — Single entry point `index.html` mounting `/src/main.tsx`

## Runtime

**Environment:**
- Browser-only SPA. No backend, no SSR, no Node.js runtime in production.
- Target: `ES2022` with `DOM`, `DOM.Iterable` libs (`tsconfig.app.json:3-5`)
- Module system: `ESNext` with `bundler` resolution (`tsconfig.app.json:6-8`)

**Build/Dev runtime (host machine only):**
- Node.js — installed `v22.18.0` locally; no `.nvmrc` or `engines` pin in `package.json`
- TypeScript types for Node provided by `@types/node ^25.6.2` (devDependency, used by `vite.config.ts`)

**Package Manager:**
- npm (lockfile `package-lock.json`, `lockfileVersion: 3`)
- Lockfile: present at `package-lock.json`

## Frameworks

**Core UI:**
- React `^19.0.0` — `src/main.tsx` uses `createRoot` from `react-dom/client`, `<StrictMode>` enabled
- React DOM `^19.0.0` — `src/main.tsx:2`

**Styling:**
- Tailwind CSS `^4.0.0-beta.7` — Loaded via `@import "tailwindcss"` at top of `src/index.css:1`
- `@tailwindcss/vite` `^4.0.0-beta.7` — Vite plugin registered in `vite.config.ts:7`. v4 uses CSS-first `@theme {}` config (no `tailwind.config.js`)

**Animation:**
- framer-motion `^11.11.17` — Used for sheets, modals, navigation, marketing transitions (e.g. `src/components/ui/Sheet.tsx:2`, `src/components/ui/Modal.tsx:3`, `src/components/layout/Sidebar.tsx:9`)

**Gestures:**
- @use-gesture/react `^10.3.1` — Drag/swipe handling in `src/components/ui/SwipeToDelete.tsx:2`

**State:**
- zustand `^5.0.1` with `persist` + `createJSONStorage` middleware — Single store at `src/lib/store.ts`

**Charts:**
- chart.js `^4.4.6` — Single thin wrapper at `src/components/dashboard/charts/BaseChart.tsx` registers `...registerables`

**Icons:**
- lucide-react `^0.460.0` — Icon set used across all UI components (e.g. `src/components/layout/Topbar.tsx:2`)

**Testing:**
- None configured. No `vitest.config.*`, `jest.config.*`, `playwright.config.*`, or `*.test.*`/`*.spec.*` files exist in the repo.

**Build/Dev:**
- Vite `^6.0.1` — Dev server on port `5173` with `host: true` (`vite.config.ts:13`)
- @vitejs/plugin-react `^4.3.4` — Registered in `vite.config.ts:7`
- TypeScript `~5.6.3` — Project references in `tsconfig.json` split app and node configs

## Key Dependencies

**Critical:**
- react `^19.0.0` / react-dom `^19.0.0` — Core rendering
- zustand `^5.0.1` — Single source of truth for all user data (also drives persistence)
- chart.js `^4.4.6` — Time-series charts (med-level curves, weight, symptoms)
- framer-motion `^11.11.17` — All transitions and gestures-as-animation
- lucide-react `^0.460.0` — Every icon in the app

**Infrastructure:**
- @tailwindcss/vite `^4.0.0-beta.7` + tailwindcss `^4.0.0-beta.7` — Pre-release v4 styling pipeline
- @vitejs/plugin-react `^4.3.4` — JSX/HMR for Vite
- @types/react `^19.0.0`, @types/react-dom `^19.0.0`, @types/node `^25.6.2` — Type-only

## Configuration

**Environment variables:**
- `.gitignore` lists `.env` and `.env.local` (line 5–6 of `.gitignore`). No `.env*` files exist on disk in the repo.
- No `import.meta.env.VITE_*` references found anywhere in `src/` — the app does not read any build-time env vars.
- The single secret used by the app (Anthropic API key) is supplied per-user at runtime through Settings UI and stored under `localStorage` key `leanshot_anthropic_key` (`src/lib/storage.ts:29`, `apiKeyStorage` helper at `src/lib/storage.ts:111`).

**TypeScript configs:**
- `tsconfig.json` — Root project-references file; references `tsconfig.app.json` and `tsconfig.node.json`
- `tsconfig.app.json` — App config: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, `react-jsx`, path alias `@/* → ./src/*`
- `tsconfig.node.json` — Build-tool config covering only `vite.config.ts`, includes `types: ["node"]`

**Vite config:**
- `vite.config.ts` — Plugins: `react()`, `tailwindcss()`. Resolve alias `@` → `./src`. Dev server `port: 5173`, `host: true` (LAN-accessible).

**HTML entry:**
- `index.html` — Default theme attr `data-theme="light"` on `<html>`. Theme-color metas for light (`#EFEBE0`) and dark (`#0B1413`). Apple PWA-style meta tags (`apple-mobile-web-app-capable`). Mounts `/src/main.tsx` into `#root`.

**Linting/Formatting:**
- No ESLint config (`.eslintrc*`, `eslint.config.*`), no Prettier config (`.prettierrc*`), no Biome config. Code style enforced only by `tsc --strict`.

## Platform Requirements

**Development:**
- Node.js capable of running Vite 6 + TS 5.6 (Node ≥18; current dev machine on `v22.18.0`)
- npm (lockfile is npm-format, `lockfileVersion: 3`)
- Run scripts (`package.json:6-11`):
  - `npm run dev` — Vite dev server on `:5173`
  - `npm run build` — `tsc -b && vite build`
  - `npm run preview` — Vite preview of built bundle
  - `npm run typecheck` — `tsc -b --noEmit`

**Production:**
- Static SPA — output of `vite build` (no Vite-emitted server). Any static host (Netlify/Vercel/S3/Cloudflare Pages/etc.) works.
- Browser requirements: ES2022, `localStorage`, `fetch`, optional `navigator.clipboard` + `ClipboardItem` (graceful fallback in `src/components/dashboard/share/ShareCardModal.tsx:67`), `FileReader`, `Blob`, `URL.createObjectURL`, `<canvas>` 2D context, `window.matchMedia`, `window.print()`.
- The Anthropic browser call relies on the `anthropic-dangerous-direct-browser-access: true` header and CORS support from the Anthropic API.

---

*Stack analysis: 2026-05-10*
