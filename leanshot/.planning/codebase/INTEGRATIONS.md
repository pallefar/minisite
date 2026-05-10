# External Integrations

**Analysis Date:** 2026-05-10

## APIs & External Services

**AI / LLM:**
- Anthropic Messages API — In-app AI coach panel (`AIChatPanel`).
  - Endpoint: `https://api.anthropic.com/v1/messages` (`src/lib/ai.ts:20`)
  - Default model: `claude-sonnet-4-6` (`DEFAULT_MODEL` constant in `src/lib/ai.ts:22`)
  - SDK/Client: None — direct browser `fetch` with JSON body in `callAnthropic()` at `src/lib/ai.ts:40`
  - Headers sent (`src/lib/ai.ts:53-58`):
    - `Content-Type: application/json`
    - `x-api-key: <user-provided key>`
    - `anthropic-version: 2023-06-01`
    - `anthropic-dangerous-direct-browser-access: true` (required for browser CORS)
  - Auth model: BYO-key. Each user pastes their own Anthropic key into Settings → AI (`src/components/dashboard/settings/SettingsPage.tsx:141-162`). The key is stored in `localStorage` under `leanshot_anthropic_key` (`src/lib/storage.ts:29`) via the `apiKeyStorage` helper (`src/lib/storage.ts:111-133`).
  - Missing-key handling: throws `MissingAPIKeyError` (`src/lib/ai.ts:13`) which the UI catches in `AIChatPanel.send` and renders an inline "add your key" prompt (`src/components/dashboard/ai/AIChatPanel.tsx:73-77`).
  - Non-200 handling: `Error("Anthropic ${status}: ${text}")` from `src/lib/ai.ts:62-64`.
  - Call-sites: only `AIChatPanel` (`src/components/dashboard/ai/AIChatPanel.tsx:8,65`). System prompt + user context (medication, dose, week #, weight delta, recent symptoms, protein target) is built per-call at `src/components/dashboard/ai/AIChatPanel.tsx:43,67-69`.
  - Where users get a key: link to `https://console.anthropic.com` from the Settings AI section (`src/components/dashboard/settings/SettingsPage.tsx:160`).

**No other external APIs are called.** A repo-wide grep for `fetch(`, `axios`, and `XMLHttpRequest` returns only the single Anthropic call (`src/lib/ai.ts:51`).

## Data Storage

**Databases:**
- None. There is no backend, no database client, no ORM, and no remote data layer.

**Browser-local persistence (the only data store):**
- `localStorage` is the single source of truth for all user data. Keys in use:
  - `leanshot_v4` — Zustand-persisted full app state (`src/lib/storage.ts:26`, `src/lib/store.ts:227`)
  - `leanshot_v3` — Legacy v1 key, read once and deleted by `migrateFromV3()` (`src/lib/storage.ts:27,77-109`)
  - `leanshot_anthropic_key` — User's Anthropic API key (`src/lib/storage.ts:29`)
  - `leanshot_theme_v4` — Persisted theme `'light' | 'dark'` (`src/main.tsx:14`, `src/hooks/useTheme.ts`)
  - Tour-seen flag — written by `src/components/dashboard/tour/GuidedTour.tsx:97,229,237` (key constant `TOUR_KEY` in that file)
- Persistence wrapper: Zustand `persist` middleware with `createJSONStorage(() => localStorage)` and an explicit `migrate()` step that ports v3 → v4 (`src/lib/store.ts:251-259`). Manual rehydration runs in `src/main.tsx:25` before first render to avoid flashing the marketing page.

**File Storage:**
- Local filesystem only — no remote object storage.
- User-imported Apple Health data is read in-browser via `FileReader.readAsText` and parsed (CSV split + XML regex) in `src/components/dashboard/tabs/ActivityTab.tsx:53-104`. Nothing is uploaded.
- Progress-card images are produced in `<canvas>` and exposed via `toDataURL`/`toBlob` for download or clipboard copy (`src/components/dashboard/share/ShareCardModal.tsx:55-75`).
- Photos in the body-progress feature are stored as base-64 dataURLs inside the Zustand store (`Photo.data: string` in `src/types/index.ts:148-152`; image read in `src/components/dashboard/tabs/BodyTab.tsx:90`).
- JSON export of all user data is generated client-side via `Blob` + `URL.createObjectURL` and triggered by an `<a download>` click (`src/components/dashboard/settings/SettingsPage.tsx:47-75`).

**Caching:**
- None. No service worker, no IndexedDB, no HTTP cache layer beyond the browser default. A grep of `src/` shows no `sessionStorage` or `indexedDB` usage.

## Authentication & Identity

**Auth Provider:**
- None. There is no user-account system — no sign-in, sign-up, password, OAuth, magic-link, or session token.
- "User" is purely local: a `User` object (`src/types/index.ts:37-59`) created by the onboarding flow (`src/components/onboarding/OnboardingFlow.tsx`) and stored in `localStorage`.
- The only "credential" anywhere in the app is the user's own Anthropic API key, treated as a personal secret stored locally and forwarded to Anthropic on each AI call (see "AI / LLM" section above).

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, Bugsnag, Rollbar, Datadog RUM, etc. Repo-wide grep for `sentry|posthog|amplitude|segment|mixpanel|plausible|google-analytics|googletagmanager` returns zero matches.

**Analytics:**
- None. The Privacy section of Settings explicitly states "No analytics. No telemetry. No third-party trackers." (`src/components/dashboard/settings/SettingsPage.tsx:181`) and the marketing FAQ reiterates the same claim (`src/components/marketing/Landing.tsx:378`).

**Logs:**
- `console.error` is used in three locations for local diagnostics only — never shipped:
  - `src/lib/storage.ts:106` (v3 migration failure)
  - `src/lib/storage.ts:123` (apiKey set failure)
  - `src/lib/store.ts:279` (hydrate failure)

## CI/CD & Deployment

**Hosting:**
- Not configured in-repo. No `netlify.toml`, `vercel.json`, `wrangler.toml`, or similar. Deployment target is the user's choice — any static host serving the Vite `dist/` output.

**CI Pipeline:**
- None. No `.github/workflows/`, no `.gitlab-ci.yml`, no `circle.yml`, no `bitbucket-pipelines.yml`, no Husky/lint-staged config.

## Environment Configuration

**Required env vars at build time:**
- None. The codebase does not reference `import.meta.env.VITE_*` anywhere.

**Required env vars at runtime:**
- None. All runtime "configuration" is per-user state in `localStorage`.

**User-supplied secrets:**
- `Anthropic API key` — entered by the user at Settings → AI; stored in `localStorage` key `leanshot_anthropic_key` (`src/lib/storage.ts:29`). Without it, only the AI panel is degraded; the rest of the app is fully functional.

**Secrets location in repo:**
- None committed. `.gitignore` excludes `.env` and `.env.local` (`.gitignore:5-6`). No `.env*` files exist in the working tree.

## Webhooks & Callbacks

**Incoming:**
- None. There is no server, so there are no incoming webhooks.

**Outgoing:**
- None. No webhook senders, scheduled jobs, or background callbacks. The only outbound HTTP request from the app is the synchronous user-initiated POST to `https://api.anthropic.com/v1/messages` from `AIChatPanel`.

## Other Third-Party Surfaces

**Web fonts:**
- Google Fonts CDN — `https://fonts.googleapis.com` and `https://fonts.gstatic.com` are `preconnect`-ed and the families `Inter`, `Fraunces`, `JetBrains Mono` are loaded via `<link>` in `index.html:12-17`. No JS interaction with Google.

**Affiliate links:**
- Amazon — Static product-search hyperlinks in the Supplements tab using a placeholder affiliate tag `YOURTAG-20` (`src/components/dashboard/tabs/SupplementsTab.tsx:66`). No SDK or tracking script — plain `<a target="_blank" rel="noopener">`.

**Apple Health (one-way file import):**
- Not an API integration. Users export their Apple Health archive (CSV/XML) and upload the file; it is parsed entirely in-browser at `src/components/dashboard/tabs/ActivityTab.tsx:53-104`. Nothing is sent back to Apple or anywhere else.

---

*Integration audit: 2026-05-10*
