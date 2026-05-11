# Stack Research

**Domain:** Health-adjacent multi-audience SaaS (B2C patient + read-share doctor view + B2B clinic) on top of an existing Vite/React 19 SPA with local-first persistence.
**Researched:** 2026-05-10
**Confidence:** HIGH for backend platform, auth, database, ORM, testing, error tracking, analytics, deployment, AI proxy. MEDIUM for sync engine choice (the local-first ecosystem genuinely shifted under everyone's feet during 2025; recommendation is pragmatic, not consensus).

> **Scope of this document.** The frontend stack (React 19, Vite 6, TS strict, Tailwind v4, Zustand, framer-motion, chart.js, lucide-react) is locked and not re-evaluated here. This is a recommendation for everything *else* the v1 milestone needs: backend platform, auth, database, sync, tests, error tracking, analytics, deployment target, AI key proxy. Versions verified via `npm view` against the live npm registry on 2026-05-10.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Hono** | `4.12.18` | Backend framework — runs the LeanShot API + AI proxy on Cloudflare Workers | Web-Standards-based (Request/Response), 14 KB, zero deps, written in TS from day one. Already the go-to choice for Cloudflare Workers in 2026 (~6M weekly downloads). End-to-end typed via `hono/client` RPC, which lets the React app consume the API with full TS inference — equivalent to tRPC ergonomics without an extra abstraction layer. Compatible with the existing TS-strict frontend with no fight. |
| **Cloudflare Workers** | (platform — `wrangler` `4.90.0`) | Edge runtime hosting Hono backend + serverless AI proxy + scheduled jobs (e.g. share-link expiry sweeps) | Best free-tier shape for this app: 100K requests/day free, 10ms CPU/request free, sub-5ms cold starts. Sits in the same Cloudflare account as Pages (the static SPA host) — single dashboard, single bill, single edge network. Workers + Vite plugin (`@cloudflare/vite-plugin`) means dev mode runs the API in the actual production runtime — no surprises at deploy. |
| **Cloudflare Pages** | (platform) | Static SPA host for the existing Vite build | Unlimited bandwidth on free tier, unlimited collaborators, 500 builds/month, integrates with Workers via Pages Functions or service bindings. Vercel's free Hobby plan prohibits commercial use (LeanShot eventually monetises) and caps bandwidth at 100 GB/mo — a real risk at launch. Cloudflare has neither restriction. |
| **Better Auth** | `1.6.10` | Auth provider — patient sign-in, doctor sign-in, clinic org membership | Self-hosted, owns its tables in your Postgres, framework-agnostic, TS-first. The `organization` plugin is exactly the multi-tenant primitive LeanShot needs (orgs = clinics; members = patients/coaches; roles = `owner`/`admin`/`member`; invitations with custom expiry). No per-MAU pricing — important for a B2B clinic tier where each clinic onboards dozens of patients you can't profitably charge $0.02/MAU on (Clerk's pricing). All session/cookie logic stays inside *your* Worker, so you control the data flow end-to-end — material for a health-adjacent privacy posture. |
| **Neon Serverless Postgres** | (platform — driver `@neondatabase/serverless`) | Primary database for all account-scoped + cloud-synced data | Real Postgres (not SQLite), HTTP/Fetch-compatible driver works on Cloudflare Workers without a TCP shim, scale-to-zero, instant database branches per PR (huge for the migration-fragility problem flagged in CONCERNS.md). Row-level security available natively. Free tier covers a v1 launch comfortably. The alternative — Cloudflare D1 — is SQLite, has a 10 GB cap, no Postgres extensions, and is unsuitable for the kind of long-term sensitive longitudinal health data this app stores. |
| **Drizzle ORM** | `0.45.2` | Type-safe SQL layer + migrations | Driver-level support for `drizzle-orm/neon-http` and `drizzle-orm/d1` (future-proofing) with no preview flags. ~12 KB runtime — Workers-friendly. Schema-in-TS, generated types end-to-end. SQL stays readable (this matters when reviewing RLS policies and the kind of "did the migration actually do what we expected" diff that Prisma hides behind its DSL). Drizzle overtook Prisma in weekly downloads in late 2025 for serverless workloads specifically. |
| **TanStack Query** | `5.93.x` (latest stable) | Server-state cache + offline-first sync orchestration on the React side | Replaces the bespoke fetch+cache layer the cloud-sync feature would otherwise need. Built-in `networkMode: 'offlineFirst'` + `persistQueryClient` against IndexedDB gives "log offline, sync when online" semantics that line up with LeanShot's local-first promise. Pairs naturally with Hono RPC: `useQuery` calls `client.injections.$get()` and gets typed responses. **This, not Replicache or Triplit, is the recommendation** — see "Local-first sync" below for rationale. |
| **idb-keyval** | `6.2.2` | IndexedDB wrapper for photos + AI history (CONCERNS.md flags photo storage hitting localStorage's 5 MB cap) | 600 bytes minified. Replaces the data-URL-in-localStorage photo storage that's already on track to break for power users. TanStack Query's persister can also persist into idb-keyval. |
| **Zod** | `4.4.3` | Runtime input validation, shared between Hono server and React client | Hono ships `@hono/zod-validator` as a first-class middleware. Validating the same schema on both sides of the network closes the kind of "free-text symptom note ate by `Number()` coalesce" hole already visible in the existing codebase. Zod 4 is now stable and ~3-4× faster than v3. |
| **`@anthropic-ai/sdk`** | `0.95.1` | Anthropic SDK used *server-side* in the Worker AI proxy | Replaces the hand-rolled `fetch` in `src/lib/ai.ts`. SDK handles retries, streaming, error classes, and version-header churn for you — directly addresses the `'anthropic-version': '2023-06-01'` brittleness flagged in CONCERNS.md. The proxy pattern (Worker holds the key, browser calls Worker) eliminates the plaintext-localStorage-key threat that's currently the largest open security item. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@cloudflare/vite-plugin` | latest (1.x) | Vite plugin that runs the Worker inside `vite dev` | Always — this is what lets the existing `vite dev` flow keep working for the SPA *and* run the Hono backend in the same process during development, against the production runtime (workerd). |
| `@hono/zod-validator` | latest 0.x | Hono middleware that validates request bodies / queries / params with Zod | On every API route that takes user input. |
| `@neondatabase/serverless` | latest 0.x | HTTP-fetch Postgres driver for Workers | Always — TCP drivers don't work on Workers. |
| `drizzle-kit` | latest (0.x) | Schema migrations CLI | For every schema change. Runs locally + in CI. |
| `@sentry/react` | `10.52.0` | Browser SDK with React 19 error-hook integration (`Sentry.reactErrorHandler`) | Always — addresses PROD-02. |
| `@sentry/vite-plugin` | `5.2.1` | Source-map upload at build time | Always — without it the React 19 SPA's stack traces are minified noise. |
| `posthog-js` | `1.372.10` | Product analytics + session replay (cookieless mode) | Always — addresses PROD-03. Supports HIPAA-ready hosting tier if/when LeanShot needs it. |
| `vitest` | `4.1.5` | Unit + integration test runner | Pharmacology, insights, storage migrations, AI prompt builders, Hono routes. Addresses PROD-04. |
| `@vitest/browser` + `@vitest/browser-playwright` | `4.1.x` | Component tests in a real browser via Vitest's stable Browser Mode | For UI primitives and complex interactive components (`SwipeToDelete`, `GuidedTour`, `BaseChart`) where jsdom is a fiction. |
| `@testing-library/react` | `16.3.2` | Component DOM assertions | Onboarding flow, settings, doctor report, share card modal. |
| `@testing-library/jest-dom` | `6.9.1` | Matchers for `toBeInTheDocument()`, `toHaveAttribute()`, etc. | Always — used in the setupFiles bootstrap. |
| `@testing-library/user-event` | latest 14.x | Realistic user-event simulation | Always for interaction tests. |
| `jsdom` | `29.1.1` | DOM for unit-test mode | When tests don't need a real browser (most pharmacology + insights + storage tests). |
| `playwright` | `1.59.1` | Smoke E2E for the critical user paths (onboard → log injection → see curve, generate doctor share → open share link in fresh browser) | One Playwright file per critical-path scenario. Cross-browser including WebKit/Safari, which matters for an iOS PWA. |
| `eslint` `9` | `9.x` | Linting — addresses the "BaseChart.tsx carries a `// eslint-disable-next-line` comment with no ESLint installed" anomaly in CONCERNS.md | Always. Use `eslint.config.js` flat config. |
| `eslint-plugin-react-hooks` | latest 5.x with React 19 support | exhaustive-deps + rules-of-hooks | Always. |
| `eslint-plugin-jsx-a11y` | latest 6.x | a11y lint rules (already a stated constraint in PROJECT.md) | Always. |
| `@typescript-eslint/parser` + `eslint-plugin` | latest 8.x | TS-aware ESLint | Always. |
| `prettier` | latest 3.x | Formatting | Always. |
| `wrangler` | `4.90.0` | Cloudflare Workers CLI | Local dev + deploy. |
| `resend` (or `react-email` + Cloudflare Email Workers) | latest | Transactional email — invite emails, share-link notifications, magic-link sign-in | Whichever you pick, it must work from a Cloudflare Worker context. Resend is the simplest. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Wrangler | Workers dev/deploy + secrets | Use `wrangler secret put ANTHROPIC_API_KEY` — never commit it. |
| GitHub Actions | CI: typecheck + lint + test + Playwright smoke + deploy | Gate `vite build` behind `tsc -b && eslint . && vitest run --coverage`. |
| Drizzle Studio | Browse the Postgres locally | Saves a lot of "what does the schema actually look like" round trips. |
| Playwright Trace Viewer | Debug failing E2E runs in CI | Vitest 4's stable Playwright Trace integration also helps. |

---

## Installation

```bash
# Backend (Hono on Cloudflare Workers)
npm install hono @hono/zod-validator zod
npm install @neondatabase/serverless drizzle-orm
npm install -D drizzle-kit wrangler @cloudflare/vite-plugin

# Auth (Better Auth, server + React client)
npm install better-auth

# AI proxy (server-side SDK for the Worker)
npm install @anthropic-ai/sdk

# Server-state + offline cache (replaces ad-hoc fetch in components)
npm install @tanstack/react-query @tanstack/query-sync-storage-persister
npm install idb-keyval

# Observability
npm install @sentry/react
npm install -D @sentry/vite-plugin
npm install posthog-js

# Tests
npm install -D vitest @vitest/browser @vitest/browser-playwright
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install -D jsdom
npm install -D playwright @playwright/test

# Lint + format
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-jsx-a11y prettier eslint-config-prettier

# Email
npm install resend
```

---

## Architecture: how it fits with the locked frontend

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Pages — static SPA (existing Vite build)         │
│  React 19 + TS + Tailwind v4 + Zustand + chart.js            │
│   ├── TanStack Query  (server-state cache, offline-first)    │
│   ├── Hono RPC client (typed calls to /api/*)                │
│   ├── Better Auth client (session, org switcher)             │
│   ├── @sentry/react   (error capture, React 19 error hooks)  │
│   ├── posthog-js      (cookieless web analytics)             │
│   └── idb-keyval      (photos + AI history → IndexedDB)      │
└──────────────────────────────┬──────────────────────────────┘
                               │  fetch / RPC over HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker — Hono backend                            │
│   ├── /api/auth/*        → Better Auth handler               │
│   ├── /api/(injections|weights|symptoms|...)/* → CRUD        │
│   ├── /api/share/:token  → read-only doctor view             │
│   ├── /api/orgs/*        → clinic roster + drilldowns        │
│   ├── /api/ai/messages   → Anthropic proxy (key in Worker)   │
│   └── Zod validators on every input (@hono/zod-validator)    │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐       ┌──────────────────────────────┐
│ Neon Postgres        │       │ Anthropic Messages API       │
│  (Drizzle schema +   │       │  (key sourced from Worker    │
│   RLS for org/owner) │       │   secret, not the browser)   │
└──────────────────────┘       └──────────────────────────────┘
```

**Local-first preservation.** The existing Zustand persist + localStorage layer stays. TanStack Query becomes a *second* layer that sits on top: it knows how to talk to the Worker and cache responses to IndexedDB. When the user is offline (or signed out, or the Worker is down), the app continues to use Zustand exactly as it does today. When online and signed in, mutations go to the Worker first; success populates Zustand and the Query cache.

**Migration of v4 localStorage → cloud (SYNC-02).** On first sign-in, the React app reads the `leanshot_v4` blob, posts it to `/api/migrate`, and the Worker writes one batch into Postgres scoped to the new account. Local data isn't deleted until the server confirms. This is the safest version of the existing v3→v4 migration, plus actual tests this time.

---

## Stack patterns by audience

### Patient (B2C)

- Auth: Better Auth email + password, optional magic link.
- Data scope: `user_id` foreign key on every row, enforced at the Worker layer (and optionally at the Postgres RLS layer).
- Sync: TanStack Query with `networkMode: 'offlineFirst'`. Local mutations queue when offline; flushed on reconnect.

### Doctor read-share

- **Recommended path:** signed, expiring share tokens — no doctor account required for v1. Patient hits "share with my doctor", a row in `share_links` is created with a short-lived JWT and a window of dates, and the doctor opens a URL like `/share/:token`. Worker validates the token and serves a read-only payload.
- This path keeps doctors out of the auth funnel entirely (massive activation friction otherwise) and matches PROJECT.md's "no doctor account required, OR a lightweight doctor sign-up — TBD".
- Only escalate to a real doctor account when SHARE-01/02 demonstrate that doctors *want* to come back; bake the schema for it but don't ship the UX yet.

### Clinic / coach (B2B)

- Auth: Better Auth `organization` plugin. Clinic = `Organization`. Coach = `Member` with `admin` role. Patient inside a clinic = `Member` with `member` role *and* their own per-patient row in your domain tables.
- Roster (CLINIC-02): a `/api/orgs/:orgId/roster` route runs an aggregation query and returns per-patient at-a-glance status.
- Drill-down (CLINIC-03): the same endpoints as B2C, but the auth check is "are you a member of an org that contains this patient" rather than "are you this user".

---

## AI key hardening (PROD-05) — the single biggest security item

Drop the BYO-key path. Replace `src/lib/ai.ts` with a thin client that POSTs to `/api/ai/messages` on your Worker. The Worker:

1. Validates the user's session (Better Auth).
2. Optionally rate-limits per user (Cloudflare KV counter or Durable Object).
3. Calls Anthropic via `@anthropic-ai/sdk` with the key sourced from `wrangler secret`.
4. Streams the response back to the browser via SSE.

Benefits over the current model:

- The Anthropic key is never in the browser. The plaintext-localStorage-key risk in CONCERNS.md goes to zero.
- Rate-limiting + audit logging belong to LeanShot, not to whichever user pasted a key in.
- The hardcoded `'claude-sonnet-4-6'` model ID bug (it's `claude-sonnet-4-5` or similar — that's a real CONCERN) gets centralised in one Worker file.
- Streaming via SSE from the Worker is straightforward (Hono has first-class streaming helpers).
- Anthropic's `anthropic-dangerous-direct-browser-access: true` header — and the off-label CORS dance it implies — disappears.

If a future "advanced power-user" tier *needs* BYO keys for cost reasons, ship that as a second path with explicit risk disclosure. Don't make it the default.

---

## Local-first sync engine — why TanStack Query, not Replicache/Triplit

This is the most contested decision in the stack and the place where confidence is lowest, so the rationale matters.

**Replicache** — was the obvious answer through 2024. As of 2025 it's in maintenance mode; Rocicorp moved focus to Zero. Rocicorp open-sourced Replicache and stopped charging — but they're explicit that they're not adding features. **Building on a maintenance-mode sync engine in 2026 is a bad bet.**

**Zero (Rocicorp's successor)** — promising, Apache-2 licensed, but new. The query model is excellent for collaborative apps. LeanShot is *not* a collaborative app: each user's data is single-writer (themselves) with read-only fan-out (their doctor, their coach). Zero's strengths are wasted here, and its production maturity is still climbing.

**Triplit** — was a strong contender for new local-first projects. The team was acqui-hired by Supabase in August 2025 and the project went community-maintained. **Same problem as Replicache:** building on a project that lost its core team is a v1 risk you don't need.

**ElectricSQL** — strong, but it's a Postgres replication-stream system optimised for partial replication of large datasets across many users. LeanShot's data per user is small (KB to low MB) — ElectricSQL is a heavy machine for a small load. It's also Postgres-coupled in a way that complicates the "user has no account yet" path: the local-only experience needs to keep working.

**InstantDB / PowerSync / Yjs / etc.** — each has tradeoffs but none is a clean fit. PowerSync is enterprise-priced. Yjs is for CRDT collaboration on documents, not entity timelines.

**TanStack Query (the recommendation)** — not technically a sync engine. But:
- It's stable, mature, has the most adoption of anything on this list, and integrates with React 19 cleanly.
- `networkMode: 'offlineFirst'` + `persistQueryClient` against IndexedDB gives you a queue-mutations-while-offline + reconcile-on-reconnect flow that is *exactly* what LeanShot needs.
- The single-writer-per-user nature of the data means CRDTs are overkill — last-write-wins with server timestamps is fine.
- It composes naturally with Hono RPC for typed calls.
- If LeanShot ever grows into multi-writer collaboration (e.g. a coach writes notes a patient reads), Zero or Triplit can be slid in *behind* TanStack Query without rewriting components.

**Confidence on this specific decision: MEDIUM.** I'm recommending it because the sync-engine market is in flux and TanStack Query is the lowest-risk path that meets the actual product requirements. If the team is willing to bet on Zero, that's also defensible — but only if someone can absorb the maturity risk.

Cite: [Choosing a Sync Engine for Local-First in 2026](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/), [Replicache maintenance mode](https://replicache.dev/), [Zero open source](https://zero.rocicorp.dev/docs/open-source).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono on Cloudflare Workers | **Next.js on Vercel** | If you wanted SSR/SSG (LeanShot's marketing landing might benefit). But adopting Next would mean rewriting the existing Vite SPA — explicitly out of scope per PROJECT.md "Tech stack is locked". |
| Hono on Cloudflare Workers | **tRPC on Vercel Functions** | If you'd rather stay on Vercel for some reason. tRPC and Hono RPC give equivalent type safety; the rest of the call (Vercel free tier prohibits commercial use, no streaming on Hobby) makes Vercel the wrong free-tier shape for v1. |
| Hono on Cloudflare Workers | **Convex** | If you wanted backend + database + realtime in one bundle and could accept Convex's proprietary database. Plays well with Better Auth (`@get-convex/better-auth`). Real lock-in cost, real DX upside. Pick this if the team values ship speed over portability and is willing to swallow vendor lock-in. |
| Better Auth | **Clerk** | If you want pre-built UI components and the multi-tenant org plugin is worth the $0.02/MAU cost. Picks itself if you want to stop thinking about auth UX entirely. Cost adds up fast at clinic-tier scale. |
| Better Auth | **Supabase Auth + Supabase Postgres** | If you're already going to use Supabase Postgres, the integration is genuinely seamless (RLS reads `auth.uid()`). The reason it's *not* the recommendation: Supabase pulls you into the rest of Supabase (storage, edge functions, realtime), which is fine but is a much bigger lock-in than Better Auth + Neon, and the Workers integration is less clean than Neon's. |
| Better Auth | **WorkOS** | If/when LeanShot needs SAML/SSO for enterprise clinics. WorkOS is the right answer for "I sell to large hospitals" — wildly overkill for v1. |
| Neon Postgres | **Supabase Postgres** | If you want auth + storage + realtime bundled in. Good for fast MVPs. Heavier lock-in. |
| Neon Postgres | **Cloudflare D1** | If your data model fits in SQLite and stays under 10 GB. For LeanShot's longitudinal health records this is a "maybe one day, not v1" call. |
| Drizzle | **Prisma 7** | If the team strongly prefers Prisma's DX (managed migrations, generated client, fancy Studio). Prisma 7 finally has reasonable Workers support. Drizzle wins on bundle size and the "I want to read the SQL" axis. |
| TanStack Query | **Zero** | If you build a feature where two users read/write the same record (e.g. a coach edits a patient's plan and the patient sees it live). Defer until you actually have one. |
| TanStack Query | **Replicache** | Don't. Maintenance mode. |
| Vitest 4 | **Jest 30** | Don't. Vite project means the Vitest tooling fit is dramatically better. |
| Playwright | **Cypress** | If the team has muscle memory and only tests Chrome. Playwright is the better technical pick for a PWA that has to work in Safari/WebKit. |
| Sentry | **Highlight.io** | If session replay tightly coupled with errors is the differentiator and self-hosting is acceptable. Sentry is the boring-but-correct choice; Highlight is the "I want to see what the user did when it broke" choice. |
| PostHog | **Plausible** | If you only need page-view analytics and zero PII is a hard requirement. Plausible cannot do feature flags, session replay, or product funnels. PostHog can be configured to be cookieless + EU-hosted, giving you Plausible-equivalent privacy posture *and* room to grow. |
| Cloudflare Pages | **Vercel** | If you're locked into Next.js or really want the Vercel preview-comments DX. For everything else Cloudflare wins on cost shape. |
| Cloudflare Pages | **Netlify / Fly.io** | Netlify is fine; Fly.io is overkill (you don't need a long-running server). |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `localStorage` for the Anthropic API key (current state) | Plaintext readable by any extension or future XSS. CONCERNS.md flags this as the single biggest security item. | Worker proxy with key in `wrangler secret`. |
| Direct browser → Anthropic with `anthropic-dangerous-direct-browser-access: true` | The header name is Anthropic's literal warning. No rate limit, no audit, no key rotation. | Worker proxy. |
| Replicache for new code in 2026 | Maintenance mode. Rocicorp moved on to Zero. | TanStack Query for v1; Zero for future multi-writer features. |
| Triplit for new code in 2026 | Acqui-hired by Supabase in August 2025; project went community-maintained. | TanStack Query. |
| Cloudflare D1 for the primary store | SQLite + 10 GB cap + no Postgres extensions. Wrong machine for sensitive longitudinal health records that will outlive v1. | Neon Postgres. |
| Vercel Hobby plan for production | Hobby plan prohibits commercial use; bandwidth caps; per-seat pricing. The first lawyer letter or revenue dollar requires migrating off. | Cloudflare Pages free tier. |
| Auth0 | Per-MAU pricing scales worse than Clerk at clinic-tier MAU counts; older DX; SAML enterprise focus is overkill for v1. | Better Auth, or Clerk if you want managed UI. |
| Prisma's Edge runtime in 2026 if you're starting fresh | Still labelled preview for Workers in some configurations; bundle size. | Drizzle. |
| Jest | Slower in a Vite project; no first-class ESM; the entire tooling momentum has moved to Vitest. | Vitest 4. |
| `dangerouslySetInnerHTML` anywhere user-supplied content can flow | A future "render markdown in the AI reply" change would inherit unsanitised user notes via the doctor report flow. | Keep React's text path; if markdown becomes necessary, route through DOMPurify or a markdown lib that escapes by default. |
| Native browser `confirm()` / `alert()` | CONCERNS.md flags this — design-system bypass, breaks iOS PWA UX. | Promote a `useConfirm()` helper around the existing `Modal` primitive. |
| `chart.js` `...registerables` | Pulls every chart type even though you only need 4-5. ~20-30 KB gz waste. | Explicit `Chart.register(LineController, BarController, DoughnutController, ...)` per `BaseChart`. |
| `@types/node@25` while Node runtime is 18+ | Type/runtime drift. | Pin to the LTS version your deploy target uses (Cloudflare Workers don't run Node, so set this to whatever `wrangler` itself wants — typically `@types/node` matching Vite's minimum). |

---

## Cost / complexity implications for a free-tier launch

**Realistic free-tier ceilings (2026-Q2):**

| Component | Free tier shape | When you actually pay |
|-----------|-----------------|----------------------|
| Cloudflare Pages | Unlimited bandwidth, 500 builds/mo | Builds-per-month if you push very frequently, otherwise never. |
| Cloudflare Workers | 100K req/day, 10ms CPU/req | At ~3K daily active users posting normally; Workers Paid is $5/mo. |
| Cloudflare KV (rate-limit counters) | 100K reads/day | Workers Paid covers it. |
| Neon | 0.5 GB storage + 190 compute hours/mo | If LeanShot actually fills 0.5 GB of patient data, that's a great problem to have (~50K active users). Pro is $19/mo. |
| Anthropic API | Pay-as-you-go from token 1 | Always — this is the real variable cost. Mitigate with a per-user rate limit + a daily cap and surface usage to users. |
| Better Auth | Self-hosted = free | Never — you pay only for the database it runs on. |
| Resend | 3K emails/mo, 100/day | Easily covers v1 invites + magic links. |
| Sentry | 5K errors/mo, 50 replays/mo | At launch, free tier is fine. Grows to $26/mo Team plan when usage justifies. |
| PostHog | 1M events/mo, 5K replays/mo | Generous; you'll be paying for Anthropic before you're paying for PostHog. |
| GitHub Actions | 2K min/mo on public repos, free | If repo stays public; `act` locally for everything else. |

**Realistic launch monthly cost: $0 to ~$30/mo until you have meaningful traction.** The unbounded line item is Anthropic — every other piece scales mostly free until success.

**Complexity vector to watch:** the moment you add a backend, the codebase doubles in surface area (a new directory tree, a new build target, a new deploy pipeline, a new set of secrets). The proposed split (Hono on Workers, deployed alongside Pages) keeps everything in one repo and one Cloudflare account. Resist the temptation to add a third service (Railway, Fly.io, Supabase) until something requires it.

---

## Version Compatibility (verified 2026-05-10)

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `react@19.2.6` | `@sentry/react@10.52.0` | Sentry React supports React 19's `onUncaughtError`/`onCaughtError`/`onRecoverableError` hooks via `Sentry.reactErrorHandler`. |
| `react@19` | `@tanstack/react-query@5.x` | Full React 19 support since v5.61. |
| `react@19` | `@testing-library/react@16.3.x` | RTL 16 added React 19 support. **Requires `@testing-library/dom@>=10`.** |
| `vite@6` | `@cloudflare/vite-plugin@1.x` | Stable as of late 2025; plugin runs the Worker in `workerd` during dev. |
| `vitest@4.1.5` | `@vitest/browser@4.1.x` + `@vitest/browser-playwright@4.1.x` | v4 split provider packages out — install the Playwright provider explicitly. Migration guide is short. |
| `tailwindcss@4.3.0` (already installed) | `@tailwindcss/vite@4.3.x` | Stable since Jan 2025. **Bump `package.json` off the `4.0.0-beta.7` range** — CONCERNS.md flags the loose range as a drift risk. |
| `hono@4.12.x` | `@cloudflare/workers-types@4.x` | Hono ships its own types; pull in workers-types only if you use Cloudflare-specific bindings (D1, KV, R2, Queues). |
| `drizzle-orm@0.45.x` | `@neondatabase/serverless@0.10.x` | Use `drizzle-orm/neon-http` import path. |
| `better-auth@1.6.x` | `hono@4.x` | Better Auth ships a Hono integration; mount as `app.on(['POST','GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))`. |
| `@anthropic-ai/sdk@0.95.x` | Cloudflare Workers runtime | The official SDK runs on Workers since 0.30+. Use `import Anthropic from '@anthropic-ai/sdk'` in the Worker. |
| `playwright@1.59.1` | `@vitest/browser-playwright@4.1.x` | Playwright is the recommended provider for Vitest Browser Mode in v4. |

**Known compatibility traps:**

1. **framer-motion 11** still says "supported" with React 19. CONCERNS.md correctly notes upstream bug reports about Suspense interactions. **Pin** to a known-good `11.11.x` for v1; do not bump to Motion 12 in the same milestone as the cloud sync work.
2. **Tailwind v4 + PostCSS** — there's a known conflict pattern where some shadcn-style configs need adjustment. LeanShot doesn't use shadcn, so this likely doesn't apply, but flag it.
3. **`@types/node@25` + Workers** — Workers runtime is not Node, so `@types/node` is only relevant for `vite.config.ts`. Pin to a stable LTS-aligned major instead of letting it drift to 25.
4. **Neon HTTP driver does not support transactions across multiple statements.** For multi-statement transactions, use `@neondatabase/serverless`'s WebSocket pool — but Workers don't allow long-lived sockets, so you have to either use the `transaction()` helper in a single round-trip or put transaction-heavy logic into a stored procedure / Postgres function. Drizzle has helpers for this.

---

## Sources

**Context7 (HIGH confidence):**
- `/better-auth/better-auth` — multi-tenant `organization` plugin API, hooks, invitation lifecycle
- `/getsentry/sentry-javascript` — React 19 error-hook integration via `Sentry.reactErrorHandler`
- `/vitest-dev/vitest` — Vitest 4 setup, jsdom config, Browser Mode docblocks
- `/websites/hono_dev` — Cloudflare Workers integration, RPC client pattern, `hcWithType` precompiled types
- `/anthropics/anthropic-sdk-typescript` — Anthropic SDK fit for Workers proxy

**Live npm registry (HIGH confidence — versions verified 2026-05-10 via `npm view`):**
- hono `4.12.18`, better-auth `1.6.10`, vitest `4.1.5`, posthog-js `1.372.10`, drizzle-orm `0.45.2`, `@anthropic-ai/sdk` `0.95.1`, `@sentry/react` `10.52.0`, `@sentry/vite-plugin` `5.2.1`, playwright `1.59.1`, `@testing-library/react` `16.3.2`, `@testing-library/jest-dom` `6.9.1`, jsdom `29.1.1`, tailwindcss `4.3.0`, vite `8.0.11`, react `19.2.6`, zod `4.4.3`, eslint `10.3.0`, `@hono/zod-validator` `0.8.0`, wrangler `4.90.0`, idb-keyval `6.2.2`

**Official docs (HIGH confidence):**
- [Cloudflare Workers — React + Vite framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Cloudflare Workers — Hono framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/)
- [Hono Cloudflare Workers getting started](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Better Auth — Organization plugin](https://better-auth.com/docs/plugins/organization)
- [Sentry React — React 19 onUncaughtError integration](https://docs.sentry.io/platforms/javascript/guides/react/)
- [Vitest 4 release notes](https://vitest.dev/blog/vitest-4) (Browser Mode stable, October 2025)
- [Tailwind CSS v4.0 release](https://tailwindcss.com/blog/tailwindcss-v4) (stable since January 2025)
- [Replicache — maintenance mode confirmation](https://replicache.dev/)
- [Zero — open source](https://zero.rocicorp.dev/docs/open-source)
- [Cloudflare AI Gateway — Anthropic provider](https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/)

**Web research, verified across multiple sources (MEDIUM confidence):**
- [Choosing a Sync Engine for Local-First in 2026](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/) — synthesised against official docs for each engine
- [Vercel vs Cloudflare Pages 2026 free-tier comparison](https://danubedata.ro/blog/cloudflare-pages-vs-netlify-vs-vercel-static-hosting-2026) — verified against [Vercel pricing](https://vercel.com/pricing) and [Cloudflare Pages pricing](https://www.cloudflare.com/plans/developer-platform/)
- [Drizzle ORM vs Prisma 2026](https://dev.to/pockit_tools/drizzle-orm-vs-prisma-in-2026-the-honest-comparison-nobody-is-making-3n6g) — verified against [Drizzle docs](https://orm.drizzle.team/) and [Prisma 7 release notes](https://www.prisma.io/changelog)
- [Neon vs Supabase vs Cloudflare D1 2026](https://www.devtoolreviews.com/reviews/cloudflare-d1-vs-neon-vs-supabase-postgres-2026) — confirmed D1's 10 GB cap and SQLite-only schema model against [Cloudflare D1 docs](https://developers.cloudflare.com/d1/platform/limits/)
- [Better Auth vs Clerk vs Supabase Auth 2026 guide](https://app.daily.dev/posts/better-auth-vs-clerk-vs-supabase-auth-2026-guide--xya3hrvkv)
- [PostHog vs Plausible vs Vercel Analytics — GDPR posture](https://posthog.com/blog/best-gdpr-compliant-analytics-tools)
- [Playwright vs Cypress 2026](https://getautonoma.com/blog/playwright-vs-cypress)

---

*Stack research for: GLP-1 / peptide-tracking SaaS (LeanShot v1)*
*Researched: 2026-05-10*
