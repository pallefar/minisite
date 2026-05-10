# Architecture Research

**Domain:** Local-first health-tracking SaaS layered with cloud sync, multi-tenant orgs, and read-share
**Researched:** 2026-05-10
**Confidence:** MEDIUM-HIGH (sync engine choice has real tradeoffs; topology and tenant model are well-trodden)

## Executive Recommendation

Keep the existing Zustand-as-source-of-truth model. Layer a **REST + reactive cache** sync architecture (not Replicache, not ElectricSQL, not Triplit) that treats the Zustand store as the local authority and the backend as a write-through replica. Pair with **Clerk** for auth (organizations come built-in), **Postgres on Neon** with **Row-Level Security** for tenant scoping, **Hono on Cloudflare Workers** for the API + AI proxy, and a **stateless signed-token** model for doctor share-links. Ship in three slices: Patient B2C with cloud sync → Doctor share → Clinic B2B.

The key insight: LeanShot is **not a collaborative app**. Patients write their own data; doctors and clinics read it. There is no concurrent multi-writer edit problem. That eliminates the strongest reason to adopt a heavy sync engine (CRDTs, server reconciliation), and makes a much smaller "REST + optimistic local writes + last-write-wins per record" architecture sufficient and cheaper to operate.

## Standard Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (SPA)                                 │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ React 19 SPA — leanshot.app (existing v2 codebase preserved)   │  │
│  │                                                                 │  │
│  │  ┌──────────────┐    ┌──────────────────┐   ┌─────────────┐    │  │
│  │  │  Patient UI  │    │  Doctor View     │   │  Clinic UI  │    │  │
│  │  │  (existing)  │    │  (read-only)     │   │  (roster)   │    │  │
│  │  └──────┬───────┘    └────────┬─────────┘   └──────┬──────┘    │  │
│  │         │                     │                     │           │  │
│  │  ┌──────┴─────────────────────┴─────────────────────┴───────┐   │  │
│  │  │           Zustand store (single source of truth)         │   │  │
│  │  │  PersistedState + UIState + Actions  (UNCHANGED SHAPE)   │   │  │
│  │  └──────┬───────────────────────────────────────────┬───────┘   │  │
│  │         │ persist middleware                        │ sync      │  │
│  │         ▼                                           ▼ adapter   │  │
│  │  ┌────────────────┐                       ┌──────────────────┐  │  │
│  │  │ localStorage / │                       │ syncQueue +      │  │  │
│  │  │ IndexedDB      │                       │ session + auth   │  │  │
│  │  │ (`leanshot_v5`)│                       │ token            │  │  │
│  │  └────────────────┘                       └────────┬─────────┘  │  │
│  └────────────────────────────────────────────────────┼────────────┘  │
└───────────────────────────────────────────────────────┼───────────────┘
                                                        │ HTTPS
                                              ┌─────────┴───────────┐
                                              ▼                     ▼
                          ┌─────────────────────────┐    ┌──────────────────────┐
                          │   Clerk                 │    │  Hono API +          │
                          │   (auth + orgs)         │    │  AI Proxy            │
                          │                         │    │  Cloudflare Workers  │
                          │  • Sign-up / sign-in    │    │                      │
                          │  • Organizations        │    │  • /sync/pull        │
                          │  • JWT issuance         │    │  • /sync/push        │
                          │  • Magic-link doctor    │    │  • /share/:token     │
                          │    invite (optional)    │    │  • /clinic/roster    │
                          └─────────────────────────┘    │  • /ai/chat (proxy)  │
                                       ▲                 └──────┬───────────────┘
                                       │ JWT verify             │
                                       └────────────────────────┤
                                                                ▼
                                                      ┌────────────────────┐
                                                      │ Neon Postgres      │
                                                      │                    │
                                                      │  • RLS-scoped      │
                                                      │  • Per-row tenant  │
                                                      │  • Append-only     │
                                                      │    revision log    │
                                                      └─────────┬──────────┘
                                                                │
                                                                ▼
                                                      ┌────────────────────┐
                                                      │ Anthropic API      │
                                                      │ (called from       │
                                                      │  /ai/chat proxy,   │
                                                      │  not from browser) │
                                                      └────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **SPA (existing)** | Render patient/doctor/clinic UIs against the local Zustand store | React 19 + Vite + Tailwind v4 (unchanged) |
| **Zustand store** | Single source of truth for the **active session's** view of data; mutations land here first | Zustand 5 with persist middleware (existing) |
| **Local persistence** | Survive browser restart and offline use | localStorage + IndexedDB for photos (`leanshot_v5`) |
| **Sync adapter** | Bridge between Zustand store and HTTP backend; queue mutations offline, replay on reconnect | New `src/lib/sync/` module (~300 LOC) |
| **Auth provider (Clerk)** | Sign-up/sign-in, session, organization membership, JWT issuance | Clerk's pre-built React components |
| **API (Hono on Workers)** | Authn enforcement, sync endpoints, share-token issuance, AI proxy | Hono + `@cloudflare/workers-types` |
| **Database (Neon Postgres)** | Authoritative store of all user data; RLS-scoped per tenant | Neon serverless Postgres + Drizzle ORM |
| **AI proxy** | Hold the Anthropic key server-side; rate-limit; redact PII before logging | Same Hono Worker, dedicated route |
| **Doctor share view** | Render existing dashboard cards/charts in read-only mode against a snapshot fetched via signed token | Same SPA, alternate view-mode flag |
| **Clinic roster** | List patients in the clinic with at-a-glance status; drill-down to patient view | New tab/page in same SPA, gated on `org.role === 'clinic'` |

## Recommended Project Structure

```
leanshot/                              # frontend (existing)
├── src/
│   ├── lib/
│   │   ├── store.ts                   # existing Zustand store (extend with sync slice)
│   │   ├── storage.ts                 # existing — bump v4→v5, add userId scoping
│   │   ├── sync/                      # NEW
│   │   │   ├── client.ts              # fetch wrapper with auth header injection
│   │   │   ├── queue.ts               # offline mutation queue (IndexedDB-backed)
│   │   │   ├── pull.ts                # fetch server delta since last cursor
│   │   │   ├── push.ts                # POST queued mutations
│   │   │   ├── reconcile.ts           # merge server response into store
│   │   │   ├── migrator.ts            # one-time leanshot_v4 → cloud upload
│   │   │   └── types.ts               # SyncCursor, Mutation, ServerSnapshot
│   │   ├── auth.ts                    # NEW — Clerk hook wrapper, current-org helpers
│   │   └── ai.ts                      # existing — point to /api/ai/chat instead of api.anthropic.com
│   ├── components/
│   │   ├── auth/                      # NEW — sign-in card, org switcher, share-link UI
│   │   │   ├── SignInGate.tsx
│   │   │   ├── OrgSwitcher.tsx
│   │   │   └── ShareLinkModal.tsx
│   │   ├── doctor/                    # NEW — doctor read-only view
│   │   │   └── DoctorView.tsx
│   │   ├── clinic/                    # NEW — B2B clinic surface
│   │   │   ├── ClinicRoster.tsx
│   │   │   └── PatientDetail.tsx
│   │   └── dashboard/                 # existing patient surfaces (largely unchanged)
│   └── App.tsx                        # extend view router: add 'doctor' | 'clinic' modes

leanshot-api/                          # NEW backend repo (or monorepo subdir)
├── src/
│   ├── index.ts                       # Hono app entry point
│   ├── routes/
│   │   ├── sync.ts                    # /sync/pull, /sync/push
│   │   ├── share.ts                   # /share/:token (issue, revoke, fetch snapshot)
│   │   ├── clinic.ts                  # /clinic/roster, /clinic/patients/:id
│   │   ├── ai.ts                      # /ai/chat proxy to Anthropic
│   │   └── webhooks.ts                # Clerk webhook for user/org provisioning
│   ├── db/
│   │   ├── schema.ts                  # Drizzle schema mirroring PersistedState
│   │   ├── rls.sql                    # RLS policies (versioned migrations)
│   │   └── migrations/                # drizzle-kit output
│   ├── lib/
│   │   ├── tenant.ts                  # set_config('app.user_id', ...) per request
│   │   ├── share-token.ts             # sign/verify HMAC tokens
│   │   └── rate-limit.ts              # per-user, per-IP token-bucket
│   └── worker.ts                      # CF Workers binding (KV, secrets)
├── wrangler.toml
└── drizzle.config.ts
```

### Structure Rationale

- **`src/lib/sync/`:** Self-contained sync subsystem keeps the existing Zustand store untouched. The store gets one new slice (`syncStatus`) and one new action (`hydrateFromServer`); everything else is a sibling module. This is the **smallest surgical change** that earns cloud sync.
- **`src/components/{auth,doctor,clinic}/`:** Three new persona-scoped surfaces. The existing `dashboard/` directory is the patient surface and gets re-used as-is for both the doctor read-only view (with a `readOnly={true}` prop threaded through) and the clinic patient-detail page.
- **Separate `leanshot-api/`:** The backend is small enough (~10 routes) to live in the same repo as a monorepo workspace, but isolating it as a separate Wrangler-deployed package keeps frontend bundle clean and lets you ship the SPA independently of API changes.
- **`db/rls.sql` versioned alongside Drizzle migrations:** RLS policies are load-bearing for tenant isolation. Keeping them in SQL files reviewed in the same PR as schema changes prevents a schema migration silently breaking access control.

## Architectural Patterns

### Pattern 1: Local-First Mutation with Optimistic Sync

**What:** Every mutation lands in the Zustand store synchronously (immediate UI update), then is enqueued to a durable IndexedDB-backed queue, then sent to the server in the background. On the server response, the store is reconciled with any server-side adjustments (e.g., a generated `id`, a timestamp).

**When to use:** When the user expects sub-100ms feedback for every interaction (logging an injection, toggling water) and the app must continue working offline. Which is exactly LeanShot.

**Trade-offs:**
- **Pro:** Preserves the existing instantaneous UX. No spinner on log-dose. Works offline by default.
- **Pro:** No CRDT overhead, no merge logic. Last-write-wins per record because there is one writer per record (the patient).
- **Con:** Edge case: same patient on two devices logs the same injection at the same instant. Resolution: server assigns canonical `id` on push; client reconciles. Acceptable risk because this is rare and idempotency keys can dedupe.
- **Con:** Doctor and clinic do not see real-time pushes from the patient — they pull on view-load (or every N minutes). Acceptable: the read-share use case is "doctor reviews before/after a visit," not "real-time monitoring."

**Example:**
```typescript
// src/lib/sync/queue.ts
export async function enqueueMutation(m: Mutation): Promise<void> {
  // 1. Apply locally immediately (already done by Zustand action)
  // 2. Persist to IndexedDB queue (survives reload)
  await idb.add('sync_queue', { ...m, attempts: 0, queuedAt: Date.now() });
  // 3. Trigger background flush (non-blocking)
  scheduleFlush();
}

// src/lib/store.ts (extend existing addInjection)
addInjection: (i) => set((s) => {
  const injection = { ...i, id: i.id ?? crypto.randomUUID() };
  enqueueMutation({ op: 'add', entity: 'injection', payload: injection });
  return { injections: [injection, ...s.injections], /* vial decrement */ };
}),
```

### Pattern 2: Tenant Scoping via Postgres RLS, Not Application Logic

**What:** Every table carries a `user_id` (and where relevant `clinic_id`) column. RLS policies on every table use `current_setting('app.user_id')` to constrain `SELECT`/`INSERT`/`UPDATE`/`DELETE` to rows the requester owns or has been granted access to. The Hono middleware sets `app.user_id` from the verified Clerk JWT before every query.

**When to use:** Multi-tenant SaaS where tenant isolation is a security requirement, not just a feature. Especially when there are three tenant-relationships (self, clinic-member, doctor-share) that compose.

**Trade-offs:**
- **Pro:** Defense in depth. Even an SQL-injection bug or a missing API guard cannot leak cross-tenant data — Postgres refuses to return rows the policy excludes.
- **Pro:** Policy logic lives in one place (SQL files reviewed at PR time), not scattered across every endpoint.
- **Con:** RLS policies are easy to write subtly wrong. Need test coverage that asserts cross-tenant queries return empty.
- **Con:** Performance: every policy is essentially an extra `WHERE` clause, so indexes matter. Always index `user_id`, `clinic_id`, and the junction tables (`doctor_patient_assignments`, `clinic_members`).

**Example:**
```sql
-- All patient-owned tables follow this shape
create policy "Patient owns their data"
on injections for all
to authenticated
using ( user_id = current_setting('app.user_id')::uuid )
with check ( user_id = current_setting('app.user_id')::uuid );

-- Doctor share: read-only access via active share token
create policy "Doctor reads via active share"
on injections for select
to authenticated
using (
  exists (
    select 1 from share_tokens st
    where st.patient_id = injections.user_id
      and st.audience_user_id = current_setting('app.user_id')::uuid
      and st.revoked_at is null
      and st.expires_at > now()
  )
);

-- Clinic member: read access to patients in their clinic
create policy "Clinic staff reads clinic patients"
on injections for select
to authenticated
using (
  exists (
    select 1 from clinic_patients cp
    join clinic_members cm on cm.clinic_id = cp.clinic_id
    where cp.patient_user_id = injections.user_id
      and cm.user_id = current_setting('app.user_id')::uuid
  )
);
```

### Pattern 3: Stateless Signed-Token Doctor Share

**What:** Patient generates a share-link → backend signs a JWT with `{ patient_id, scope: 'read', exp: now + 30 days }` using a server-side HMAC secret. The link is `https://leanshot.app/d/<jwt>`. Doctor visits, the SPA detects the token, exchanges it at `/share/redeem` for a short-lived session, and renders the dashboard in read-only mode against snapshot data.

**When to use:** When the audience (doctors) should have **no friction** to view — no account creation, no email verification — and the share is **time-bounded and revocable** by the patient.

**Trade-offs:**
- **Pro:** Doctor sees the data in 5 seconds. The friction-of-onboarding-a-doctor problem is the #1 reason patient-data-sharing apps fail to gain doctor adoption.
- **Pro:** Revocation is fast: the patient hits "Revoke" → the share row in `share_tokens` is updated with `revoked_at = now()` → RLS policies stop returning rows for that token within one query.
- **Con:** The JWT itself, if leaked (forwarded email), grants access until expiry. Mitigation: short default expiry (7-30 days), require a second factor (the patient's name or DOB) on link redeem if you want to harden, and audit-log every token use so the patient can see "Dr. X viewed your data on Tuesday."
- **Con:** A pure JWT is non-revocable mid-life — that's why the **JWT carries an opaque `share_id` and the actual permission lives in the `share_tokens` row** (the token is just a signed pointer to the row). This is the OAuth "stored access policy" pattern: the token references state, the state is mutable.

**Example:**
```typescript
// Server-side issuance
async function issueShareLink(patientId: string, audienceLabel: string) {
  const shareId = crypto.randomUUID();
  await db.insert(shareTokens).values({
    id: shareId,
    patient_id: patientId,
    audience_label: audienceLabel,            // "Dr. Lee at Concord Internal"
    expires_at: addDays(new Date(), 30),
    revoked_at: null,
  });
  const jwt = await sign({ share_id: shareId, scope: 'read' }, env.SHARE_SECRET);
  return `https://leanshot.app/d/${jwt}`;
}

// Server-side verification (in Hono middleware)
async function verifyShareToken(jwt: string) {
  const { share_id } = await verify(jwt, env.SHARE_SECRET);
  const token = await db.select().from(shareTokens).where(eq(shareTokens.id, share_id)).get();
  if (!token || token.revoked_at || token.expires_at < new Date()) {
    throw new HTTPException(401, { message: 'Share link is no longer valid.' });
  }
  // Set RLS context: this request reads as a "doctor share viewer" against patient_id
  await db.execute(sql`select set_config('app.share_id', ${share_id}, true)`);
  return { patientId: token.patient_id };
}
```

### Pattern 4: AI Calls Through a Server Proxy (Not BYO Browser Key)

**What:** The browser calls `POST /api/ai/chat` with the user's JWT. The Worker validates auth, applies a per-user rate limit (e.g., 30 req/hour for free tier), constructs the Anthropic request **server-side using the platform's API key**, streams the response back, and logs usage to a `ai_calls` table for observability and abuse detection.

**When to use:** Always. The current "BYO key in localStorage" pattern is the single biggest security issue in the v2 codebase (see CONCERNS.md). It cannot survive a public launch.

**Trade-offs:**
- **Pro:** API key never touches the browser. A compromised user device cannot exfiltrate it.
- **Pro:** LeanShot can rate-limit, cache, observe, and bill AI usage. (The "Pro tier with AI" line item in PROJECT.md becomes possible.)
- **Pro:** The Anthropic version header, model ID, system prompt structure are all centralized — fix once, deploy to all users.
- **Con:** LeanShot now pays for AI usage. Mitigation: tiered rate limits, optional BYO-key for power users via Settings (passed through the proxy as an `X-User-Key` header), and Cloudflare AI Gateway in front for caching identical prompts.
- **Con:** Latency adds ~50-100ms vs direct browser→Anthropic. Unobservable to users.

**Example:**
```typescript
// leanshot-api/src/routes/ai.ts
ai.post('/chat', authMiddleware, rateLimit({ key: 'user_id', max: 30, window: '1h' }), async (c) => {
  const { messages, system } = await c.req.json();
  const userId = c.get('userId');
  const userKey = c.req.header('X-User-Key');                  // optional BYO override

  const apiKey = userKey || c.env.ANTHROPIC_API_KEY;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',                              // fix the bogus 'claude-sonnet-4-6'
      max_tokens: 1024,
      system: wrapPromptInjectionTags(system),                 // <user_data>...</user_data>
      messages,
      stream: true,
    }),
  });
  await logAICall(userId, response.status);
  return new Response(response.body, { headers: response.headers });
});
```

### Pattern 5: Append-Only Mutation Log for Sync Cursor

**What:** Every mutation a user makes is recorded in a `mutations` table with a monotonic `revision` per user. Sync pull is `SELECT * FROM mutations WHERE user_id = ? AND revision > ? ORDER BY revision`. The client tracks its highest seen revision per server, asks for the delta, and applies them in order.

**When to use:** When the data model is not enormous (LeanShot's full state is < 1 MB per user even after a year), and the read pattern is "give me everything that changed since X." This is much simpler than table-by-table delta queries and avoids the "did I miss a row" class of bugs.

**Trade-offs:**
- **Pro:** Sync is one endpoint, one query, one cursor. Trivial to debug.
- **Pro:** Audit log is free — every change is in `mutations` with timestamp and source device.
- **Con:** Storage is doubled (entity tables + mutation log). Mitigation: prune mutations > 90 days for free-tier users; keep entity tables canonical.
- **Con:** Cursor must be per-user-per-device-per-organization, because a user can be in multiple orgs and the active org affects what they see. Solution: cursor key = `(user_id, active_org_id)`.

**Example:**
```sql
create table mutations (
  user_id uuid not null,
  revision bigserial primary key,
  occurred_at timestamptz not null default now(),
  client_id uuid not null,                  -- which device originated
  op text not null,                         -- 'add' | 'update' | 'remove'
  entity text not null,                     -- 'injection' | 'weight' | ...
  payload jsonb not null
);
create index on mutations(user_id, revision);
```

## Data Flow

### Persona 1: Patient (B2C)

#### First sign-in (existing local-only user)

```
[User clicks "Sign in" on Settings]
    ↓
[Clerk modal opens]
    ↓
[User signs up → Clerk issues JWT]
    ↓
[SPA detects auth state change]
    ↓
[migrator.ts checks: is leanshot_v4 present AND user has no server data?]
    ↓ YES
[Migrator POSTs entire localStorage payload to /sync/upload]
    ↓
[Server inserts every entity with user_id = jwt.sub, returns canonical revision]
    ↓
[SPA writes new revision cursor; flips storage key to leanshot_v5 (now scoped by user_id)]
    ↓
[User sees a "Synced!" toast — no data lost, no UX disruption]
```

#### Logging an injection (online or offline)

```
[Tap FAB → Log dose form → Submit]
    ↓
[useStore.addInjection(i) — Zustand state updates synchronously]
    ↓
[UI re-renders immediately: hero card, GLP curve, site rotation all reflect new injection]
    ↓
[enqueueMutation({ op: 'add', entity: 'injection', payload: i }) — IndexedDB queue]
    ↓
[scheduleFlush() — debounced 500ms]
    ↓
   (online?)──── NO ────→ [Queue persists; user keeps logging; flush on next online event]
        │
        ▼ YES
[POST /sync/push with [{op, entity, payload, client_revision}]]
    ↓
[Server: validate JWT → set app.user_id → INSERT into injections (RLS enforces) → INSERT into mutations]
    ↓
[Server returns { revision, canonical_payload } for each]
    ↓
[reconcile.ts merges canonical payload into store (e.g., server-assigned ts)]
    ↓
[Queue entry deleted; cursor advanced]
```

#### Cross-device sync (open on phone after editing on laptop)

```
[App boots on phone]
    ↓
[hydrate() loads localStorage as before — user sees their last-known state instantly]
    ↓
[After hydrate: if authenticated, sync.pull(cursor)]
    ↓
[POST /sync/pull with last cursor]
    ↓
[Server returns mutations since cursor]
    ↓
[reconcile.ts applies each in order to the Zustand store]
    ↓
[UI re-renders with the new injection logged on laptop 5 minutes ago]
```

### Persona 2: Doctor (Read-Share)

```
[Patient hits "Share with doctor" → enters doctor's name → "Generate link"]
    ↓
[POST /share/issue { audience_label: "Dr. Lee" } → returns { url, expires_at }]
    ↓
[Patient texts/emails the link]
    ↓
[Doctor opens https://leanshot.app/d/<jwt>]
    ↓
[SPA detects /d/ route → calls /share/redeem with jwt]
    ↓
[Server: verify HMAC → look up share_tokens → check not revoked, not expired]
    ↓
[Server returns { patient_id, expires_at, audience_label, snapshot_url }]
    ↓
[SPA fetches /share/snapshot/<jwt> — returns the full PersistedState shape, server-rendered]
    ↓
[SPA hydrates a temporary read-only Zustand store with the snapshot]
    ↓
[App.tsx switches view = 'doctor'; renders existing DoctorReport.tsx + live charts in read-only mode]
    ↓
[All write actions are disabled (the readOnly flag gates UI affordances)]
    ↓
[Audit log: server inserts share_view row with viewer_ip, viewer_ua, ts]
    ↓
[Patient sees "Dr. Lee viewed your share Tuesday at 2:41pm" in their Settings]
```

**Revocation:**
```
[Patient: Settings → Active Shares → "Revoke"]
    ↓
[POST /share/revoke/<share_id>]
    ↓
[Server: UPDATE share_tokens SET revoked_at = now()]
    ↓
[Doctor's next API call (if still in tab) → 401, SPA shows "This share has been revoked"]
```

### Persona 3: Clinic Operator (B2B)

```
[Clinic operator signs up via Clerk → creates Organization "Concord Internal Medicine"]
    ↓
[Clerk webhook fires → server creates clinics row + clinic_members(role: 'owner') row]
    ↓
[Operator sends invite to patient (email or magic-link)]
    ↓
[Patient receives email → clicks → signs up (or signs in if already)]
    ↓
[Patient sees "Concord Internal Medicine wants to monitor your data — Accept?"]
    ↓
[Patient accepts → server inserts clinic_patients(patient_user_id, clinic_id)]
    ↓
[Operator's roster view (/clinic/roster) issues GET /clinic/patients]
    ↓
[Server: SELECT * FROM clinic_patients WHERE clinic_id = active_org]
   (RLS enforces: operator can only see clinic_patients rows for clinics they're a member of)
    ↓
[Roster card shows: name, last-injection, current-week-streak, recent-symptom-flags]
    ↓
[Operator clicks a patient → navigates to /clinic/patient/<id>]
    ↓
[Server returns the same snapshot endpoint as doctor-share, scoped by RLS to clinic membership]
    ↓
[Same DoctorView component renders patient's data, read-only, with clinic-flavored framing]
```

## Build Order (Phased Rollout)

### Phase A: Patient Cloud Sync (the foundation)

**Slice:** Authenticated patient gets durable cloud-synced storage; existing UX preserved.

**Components shipped:**
1. Backend: Hono Worker + Neon Postgres + RLS for **patient-only** tables (no orgs yet)
2. Auth: Clerk integration (sign-up, sign-in, session)
3. Sync: `/sync/pull`, `/sync/push`, mutation queue
4. Migrator: one-time `leanshot_v4` → cloud upload
5. AI proxy: replace direct-to-Anthropic with `/ai/chat` (also fixes the model ID bug from CONCERNS.md)
6. Settings UI: "Sign in to sync" CTA, "Signed in as X" status, "Sync now" button

**Why first:** Every other slice depends on auth + sync working. Without this, doctor-share has nothing to share, clinic has no patients to monitor. This phase also delivers value to existing local-only users (cross-device, durable cloud backup) which is the #1 user request the v2 baseline cannot serve.

**Risk:** Migrator silently corrupting v4 data. Mitigation: never delete `leanshot_v4` after migration — write a backup key `leanshot_v4_pre_cloud_backup` and keep it for 90 days.

### Phase B: Doctor Read-Share

**Slice:** Patient generates a share-link; doctor views read-only without an account.

**Components shipped:**
1. Backend: `share_tokens` table, `/share/issue`, `/share/redeem`, `/share/snapshot/:jwt`, `/share/revoke/:id`
2. Frontend: `ShareLinkModal.tsx` (already partially exists as `DoctorReport.tsx` — extend it)
3. Frontend: `DoctorView.tsx` — boots on `/d/:jwt` route, hydrates read-only store, renders existing dashboard cards with `readOnly` prop
4. Audit: `share_views` table + Settings UI "who viewed what when"
5. RLS: doctor-via-active-share policies on every patient-owned table

**Why second:** Builds on Phase A's auth and snapshot endpoint. Adds zero infrastructure beyond a couple of tables and one route module.

**Risk:** Token leaked (forwarded email). Mitigation: short default expiry (7 days), per-link audit log, "rotate link" affordance in Settings.

### Phase C: Clinic B2B Surface

**Slice:** Clinic operator manages a roster of patients; drills into per-patient detail.

**Components shipped:**
1. Backend: `clinics`, `clinic_members`, `clinic_patients`, invitations
2. Backend: `/clinic/roster`, `/clinic/patients/:id`, `/clinic/invite`
3. Auth: Clerk Organizations → webhook → `clinics` + `clinic_members` provisioning
4. Frontend: `ClinicRoster.tsx`, `OrgSwitcher.tsx`
5. Frontend: re-use `DoctorView.tsx` for patient drill-down with `viewerMode='clinic'`
6. RLS: clinic-member-reads-clinic-patient policies

**Why third:** Most complex (org provisioning, invitation flows, roster UX) but builds on every primitive from A and B. Clinic patient detail view is the doctor view with a different framing — code re-use is high.

**Risk:** Patient confusion about what the clinic can see. Mitigation: explicit consent dialog at invite-acceptance ("Concord can view your injections, weight, symptoms; cannot make changes"), and a Settings page where the patient can revoke clinic access.

### Phase D (post-v1, deferred): Real-time push, photo IndexedDB migration

**Slice:** Move beyond polling to live updates. Move photos out of localStorage to IndexedDB.

These are **not v1**. They become important when (a) clinic operators want real-time alerts and (b) power-users hit the localStorage 5MB ceiling. Defer until usage data justifies the engineering.

## Multi-Tenant Scoping Strategy

| Data Class | Owner | Patient sees | Doctor (active share) sees | Clinic member sees |
|------------|-------|--------------|----------------------------|---------------------|
| `injections` | patient | own | shared patient's | clinic patient's |
| `weights`, `meals`, `workouts`, `symptoms`, etc. | patient | own | shared patient's | clinic patient's |
| `aiHistory` | patient | own | **never** (privacy) | **never** (privacy) |
| `share_tokens` | patient | own (manage) | **never** | **never** |
| `clinic_patients` | clinic | only the row linking them | **never** | clinic's roster |
| `clinic_members` | clinic | **never** | **never** | own clinic |
| `mutations` | patient | own | derived from snapshot | derived from snapshot |
| `ai_calls` (usage log) | platform | aggregated own | **never** | **never** |

**Tenant scoping decisions:**

1. **Single Postgres database, shared tables, `user_id` column on every patient-owned table.** Schema-per-tenant or DB-per-tenant is overkill until 1000+ clinics; cost and operational burden are high. Single-DB + RLS is the textbook fit.

2. **Three role types in JWT claims:** `role: 'patient'` (always present), `org_role: 'clinic_owner' | 'clinic_member' | null`, `share_share_id: uuid | null` (set during share-redeem). RLS policies branch on which is present.

3. **AI history is sacred.** Even doctors and clinics on legitimate share-relationships do not see the patient's AI conversations. Coach chat is a private therapy-adjacent space; it must not leak into clinical view.

4. **`aiHistory` and `photos` are scoped per-user but not per-org.** Even when a patient is invited to a clinic, the patient owns their data exclusively. The clinic gets a *read-share* of clinical metrics, not a copy of the patient's record.

5. **Clinic switching:** A user can be a patient in their own right AND a clinic operator (e.g., a nurse who is also a GLP-1 user). Clerk Organizations give you `activeOrganization` natively; the SPA's view-mode is `currentOrgRole === 'clinic_member' ? 'clinic' : 'patient'`.

## Doctor-Share Token Shape and Revocation Model

**Token (JWT-shaped, signed with backend HMAC secret):**

```jsonc
{
  "iss": "leanshot.app",
  "sub": "<share_id_uuid>",      // not the patient_id — opaque pointer
  "iat": 1715380000,
  "exp": 1717972000,              // soft expiry; the DB row is the hard one
  "scope": "share:read"
}
```

**Backing row in `share_tokens` (the source of truth):**

```sql
create table share_tokens (
  id uuid primary key,
  patient_id uuid not null references users(id) on delete cascade,
  audience_label text,                   -- "Dr. Lee at Concord Internal"
  audience_email text,                   -- optional; if set, redeem requires emailed code
  scope text[] not null default '{read}',
  created_at timestamptz default now(),
  expires_at timestamptz not null,       -- default: created_at + 30 days
  revoked_at timestamptz,                -- if non-null, all access denied
  last_viewed_at timestamptz,
  view_count int default 0
);
create index on share_tokens(patient_id);
create index on share_tokens(expires_at) where revoked_at is null;
```

**Revocation is fast and certain:**
- Patient hits "Revoke" → `UPDATE share_tokens SET revoked_at = now() WHERE id = ?`
- Next request from any client carrying that JWT → server checks the row → 401
- The JWT itself is *never* trusted alone; it's a pointer, not a permission grant

**Privacy mechanics:**
- Default expiry 30 days; patient can shorten to 24h or extend to 90d
- Audit log (`share_views` table): every successful redeem and snapshot fetch records `viewer_ip`, `viewer_ua` (truncated to OS family), `ts`
- Settings shows "Active shares (3) — viewed 7 times this month"
- Optional second factor: patient can require a 6-digit emailed code on redeem (sent to `audience_email` if provided)

**What about "lightweight doctor sign-up" alternative?**
- Trade-off: doctor account = audit trail + revocation surface but adds friction (signup, password reset emails to non-customers)
- Recommendation: **start with anonymous signed-link** (Phase B), introduce optional doctor accounts in a later phase if user research shows doctors want to manage multiple shares from a single dashboard. Don't gate v1 on it.

## Local-First Preservation Strategy

**Hard rules — these MUST hold across all phases:**

1. **The Zustand store remains the single source of truth for the running session.** Components never `await fetch()` — they always read from the store. The sync layer is a side-effect, not a render dependency.

2. **`hydrate()` must complete from local storage before first render**, exactly as today. Cloud sync is a *post-mount* effect. A user opening the app offline sees their last-known state in <100ms regardless of network.

3. **No mutation ever blocks on the network.** Every action (`addInjection`, `upsertWeight`) writes to the store synchronously and queues to network asynchronously. The UI is identical online and offline.

4. **Queue must be durable across browser restart.** Pending mutations live in IndexedDB (not memory, not localStorage which has size limits). On boot, queue is replayed before opening for new mutations.

5. **Conflict resolution is "last-write-wins by `updated_at`" with one writer per record.** The patient is the only writer for their own data. Doctor and clinic views are read-only. There is no scenario where two people are editing the same `Injection`, so the simple resolution suffices.

6. **The `leanshot_v4` to `leanshot_v5` migration is reversible.** Always keep `leanshot_v4_pre_cloud_backup` for 90 days. If migration is wrong, recovery is one localStorage swap.

7. **Storage key bumps on first cloud sync:** `leanshot_v4` (single-user, no auth) → `leanshot_v5_<userId>` (per-user, server-synced). Different keys mean a sign-out → sign-back-in-as-different-user does not leak data between accounts on shared browsers.

8. **Anonymous mode persists.** A user can keep using the app with no account exactly as today; sync is **opt-in**, not gated. The sign-in CTA is in Settings, not blocking onboarding.

## Migration Story for Existing Local-Only Users

```
[Existing v2 user opens leanshot.app after the v1 release]
    ↓
[App boots; hydrate() loads leanshot_v4 — user sees their data exactly as before]
    ↓
[Settings shows new "Sign in to sync across devices" card with explanation copy]
    ↓
[User clicks → Clerk modal → signs up with email]
    ↓
[Auth state changes → sync/migrator.ts triggers]
    ↓
[Migrator: snapshot leanshot_v4 to leanshot_v4_pre_cloud_backup]
    ↓
[Migrator: POST /sync/upload with full PersistedState payload]
    ↓
[Server: bulk-insert all entities with new user_id; return cursor]
    ↓
[Migrator: write new key leanshot_v5_<userId> with same data + cursor]
    ↓
[On success: leanshot_v4 unchanged (kept as backup), v5 is now active]
    ↓
[Toast: "Welcome — your 4 months of data is now backed up across devices."]
```

**Failure modes and recoveries:**

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Network drops mid-upload | Server returns partial revision; client knows last successful entity | Resume from last successful point on next online tick |
| Server rejects payload (malformed) | 400 response | Surface "We couldn't migrate your data — please contact support" with backup key intact; do not flip to v5 |
| User signs out | App writes nothing | localStorage v4 backup is still there; user can re-sign-in or keep going local-only |
| User signs in as different account | Migrator detects `leanshot_v5_<userId>` already exists | Skip migration; load existing cloud data for that account |
| User's quota exceeded mid-migration | localStorage write fails | Photos go to IndexedDB; flag the issue to user with "Move photos to cloud" CTA |

## Tradeoffs of Local-First Sync Engine Choice

This is the highest-stakes architectural decision. Honest comparison:

| Engine | Status | Best For | LeanShot Fit | Recommendation |
|--------|--------|----------|--------------|----------------|
| **Custom REST + reactive cache** (recommended) | Battle-tested pattern | Apps with one writer per record, simple data model, existing client store | Excellent — fits Zustand-already-source-of-truth, single-writer model | **CHOOSE** |
| **Replicache** | Maintenance mode (Sept 2024); team focus shifted to Zero | Server-authoritative apps with multi-writer collab | Possible but adopts a deprecated framework. Replicache's mutator model is a real lift to retrofit onto Zustand. | Avoid for new project |
| **Zero (Replicache successor)** | Pre-1.0 | Future-proof local-first | Too early for a launch milestone | Revisit post-v1 |
| **ElectricSQL** | Active, but read-path only | Read-heavy apps with PostgreSQL backend | Electric's "read-path only" model means writes still go through your own API. Saves ~zero work. Adds SQLite-in-browser complexity. | Overkill |
| **Triplit** | Active, full-stack | TypeScript-heavy, end-to-end type safety, real-time collab | Couples client and server tightly to Triplit's schema and platform. Loses Zustand. Heavy migration. | Wrong shape |
| **PowerSync** | Active, commercial | Enterprise mobile-first apps | Heavy infrastructure for a use case that doesn't need it | Overkill |
| **Yjs / Automerge (CRDT)** | Active | Collaborative documents, true multi-writer | LeanShot has one writer per record. CRDT overhead buys nothing. | Wrong shape |
| **Convex** | Active, full-stack | Greenfield reactive apps | Forces a reactive query model that displaces Zustand | Wrong shape, displaces existing code |
| **Firestore** | Active | Apps where "magic real-time" is the value prop | Vendor lock to Google; tenant scoping via security rules is harder to audit than RLS | Workable but awkward for healthcare |

**Why custom REST + reactive cache wins for LeanShot:**

1. **The existing Zustand store is already the right abstraction.** Don't replace it; extend it.
2. **One writer per record means no merge conflicts to resolve.** The whole "CRDT vs server-authority" debate is moot.
3. **LeanShot's data is small** (under 1 MB per user even after a year). A full snapshot endpoint is feasible; you don't need a delta protocol just to keep payloads small.
4. **Preserves the offline UX without a third-party runtime.** No new client-side database, no schema migration tool, no debugging through someone else's sync layer.
5. **Postgres + RLS is the right tenant-scoping primitive.** Every sync engine still has to compose with auth + tenant rules. Doing tenant scoping in Postgres directly is industry-standard and audit-friendly. Sync engines that hide Postgres make this harder.
6. **No vendor risk.** Sync engines come and go (Replicache → maintenance mode is the cautionary tale). REST + JWT + Postgres is forever.

**The honest cost:** ~300-500 LOC of sync logic the team writes themselves. That's ~1-2 weeks of work; the alternative engines all cost roughly that much in integration effort plus ongoing dependency surface area.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0-1k users** | Cloudflare Worker + Neon free tier handles everything. Total cost: ~$0-25/mo. Single Worker, single Postgres database, single Clerk org. |
| **1k-10k users** | Add Cloudflare AI Gateway in front of Anthropic for response caching. Bump Neon to a paid scale plan. Add observability (Axiom or BetterStack for Worker logs). Cost: ~$50-200/mo. |
| **10k-100k users** | Move photos out of base64-in-Postgres into R2 (Cloudflare's S3-equivalent), reference by URL. Add a read replica on Neon for clinic roster queries. Introduce per-org rate limits. Worker DO (Durable Objects) for share-link counters. Cost: ~$500-2k/mo. |
| **100k+ users** | Tenant-shard if a single clinic crosses 10k patients (rare). Move AI calls to a dedicated provisioned-throughput Anthropic agreement. Compliance: at this size, BAA negotiations are likely required — consider Auth0 Enterprise (HIPAA BAA) instead of Clerk. |

### Scaling Priorities (in order)

1. **Photo storage moves first.** localStorage 5MB cap + Postgres TEXT bloat = bottleneck #1. Move to R2 + IndexedDB local cache by user-count 1k.
2. **AI rate limits** — abuse risk before scale. Implement per-user, per-org token-bucket from day one even if generous.
3. **Mutation log pruning** — `mutations` table grows unbounded. Add a nightly job to compact mutations > 90 days into a snapshot.
4. **Index audit on RLS-bound queries** — every RLS policy adds a `WHERE`; missing indexes turn into table scans at scale. Run `EXPLAIN` on every endpoint at 1k-user scale.

## Anti-Patterns

### Anti-Pattern 1: Replacing Zustand with the sync engine's reactive query system

**What people do:** "Convex/Triplit gives us reactive queries, let's just use that everywhere and delete the Zustand store."
**Why it's wrong:** Throws away the entire v2 codebase that already works. Every component is wired to `useStore` selectors; rewriting that is a 6-week tax for zero user-visible value. Also: makes offline-first harder (those engines have offline modes but they're awkward when the rest of your code is reactive-fetch-shaped).
**Do this instead:** Keep Zustand. The sync layer reads/writes the store; the store reads/writes localStorage; the store is the single source of truth for the UI.

### Anti-Pattern 2: Calling Anthropic from the browser, even with a server-issued ephemeral key

**What people do:** "Issue a 5-minute Anthropic key from our backend and let the browser call api.anthropic.com directly to save proxy bandwidth."
**Why it's wrong:** Anthropic doesn't issue ephemeral keys. Even if it did, you lose rate-limiting per user, you lose abuse logging, you lose the prompt-construction hardening that protects against prompt injection from user-supplied notes.
**Do this instead:** Always proxy. Latency cost is < 100ms. Bandwidth cost is rounding error.

### Anti-Pattern 3: Doctor share = "create a doctor account"

**What people do:** "Doctors should sign up so we can audit what they see."
**Why it's wrong:** Doctors will not sign up for a tracking app their patient brought them. Friction kills adoption. The whole mechanic of "patient shares with doctor" is value-additive only if the doctor sees data in <30 seconds.
**Do this instead:** Anonymous signed-link first. Audit every view server-side (we know IP, UA, time even without an account). Add optional doctor accounts later if user research justifies.

### Anti-Pattern 4: Cross-tenant data via API filtering only

**What people do:** "WHERE clinic_id = ? in the API query is fine, we don't need RLS."
**Why it's wrong:** One missed `WHERE` clause leaks every patient. Audit cost is now "review every endpoint forever." Defense in depth means RLS at the database is non-negotiable.
**Do this instead:** RLS first, with `WHERE` in the API as belt-and-suspenders. Test that with no API filter, RLS still returns only allowed rows.

### Anti-Pattern 5: Migrating localStorage by deleting the old key on success

**What people do:** "Successfully migrated → `localStorage.removeItem('leanshot_v4')`."
**Why it's wrong:** The existing v3→v4 migration already does this and is flagged in CONCERNS.md as a high-severity issue. If migration was subtly lossy, the original is gone. There is no Ctrl-Z.
**Do this instead:** Rename `leanshot_v4` → `leanshot_v4_pre_cloud_backup` and keep for 90 days. Add an explicit "delete old backup" CTA in Settings that only appears once cloud sync has been verified working for a week.

### Anti-Pattern 6: Putting AI conversation history in the snapshot for share/clinic

**What people do:** "Doctor sees everything the patient sees, so include `aiHistory` in the snapshot."
**Why it's wrong:** Patients chat with the AI coach about deeply personal things — body image, mental health, side effects they're embarrassed about. Doctor seeing it = trust collapse. Clinic seeing it = guaranteed regulatory complaint.
**Do this instead:** Snapshot endpoint explicitly excludes `aiHistory`. Document this guarantee in privacy copy.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Clerk** | React provider + JWT issued for backend; webhooks for org/user provisioning | Free tier covers 10k MAU. No HIPAA BAA — flag if compliance scope changes. Org switcher built-in. |
| **Neon Postgres** | Drizzle ORM via `@neondatabase/serverless` HTTP driver from Workers | Serverless scales to zero; cold-start ~50ms. Free tier: 0.5GB compute storage. RLS works identically to vanilla Postgres. |
| **Cloudflare Workers** | Hono app deployed via Wrangler. AI proxy + sync routes co-located. | Free tier: 100k req/day. Workers don't support TCP, so Postgres must be HTTP-driver (Neon native). |
| **Anthropic API** | Server-side fetch from Worker; user-keys can override (BYO power-user mode) | Pin model to a stable ID (`claude-sonnet-4-5`); `claude-sonnet-4-6` from v2 is bogus. Wrap user content in `<user_data>` tags to mitigate prompt injection. |
| **Cloudflare AI Gateway** (optional, scale-tier) | Insert in front of Anthropic for caching, observability, fallback | Adds ~10ms; saves AI cost via response caching. Defer to Phase 1k+ users. |
| **Sentry / BetterStack** | Worker + browser SDK | Required for PROD-02 (real-user errors). Add early. |
| **Resend / Postmark** | Transactional email (clinic invites, share-link delivery) | Pick one in Phase B when invites need sending. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SPA ↔ Sync Adapter | Function calls (sync adapter exports `enqueueMutation`, `pull`, `push`) | Sync adapter never exposes raw network state to components — only `syncStatus: 'idle' \| 'syncing' \| 'error'` slice in store |
| Sync Adapter ↔ API | HTTPS REST + JSON | One endpoint per concern; never coalesce push+pull into a single endpoint |
| API ↔ Postgres | Drizzle ORM with per-request `set_config('app.user_id', ...)` | RLS is the enforcement boundary — API filters are defense-in-depth, not the primary guard |
| API ↔ Anthropic | HTTPS streaming response, proxied through to client | Server keeps ~100ms timeout buffer for slow Anthropic responses |
| Clerk ↔ API | JWT validation on every request via Clerk's `verifyToken` | Webhook signature verification on user/org events |
| Patient store ↔ Doctor store | Snapshot endpoint serializes a frozen subset | `aiHistory` excluded; only "clinically relevant" entities serialized |

## Sources

- [The Spectrum of Local First Libraries — tolin.ski](https://tolin.ski/posts/local-first-options) — comparison of sync engine landscape
- [Replicache homepage — replicache.dev](https://replicache.dev/) — maintenance mode confirmation
- [Aaron Boodman on local-first taxonomy](https://x.com/aboodman/status/1843045692736204802) — server-authority vs decentralized framing
- [ElectricSQL Alternatives doc](https://electric-sql.com/docs/reference/alternatives) — read-path-only model documentation
- [Supabase Row Level Security guide](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS patterns for multi-tenant patient data
- [Multi-Tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) — junction-table policy patterns
- [Supabase RLS Best Practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) — production patterns for SaaS
- [Clerk vs Supabase Auth vs Auth.js comparison](https://blog.vibecoder.me/clerk-vs-authjs-vs-supabase-auth) — auth provider trade-offs for SaaS
- [Authentication in 2026 comparison — Networkers Home](https://ai.networkershome.com/blog/auth-compared) — Clerk Organizations multi-tenant analysis
- [Hono + Cloudflare Workers + Neon + Drizzle starter](https://github.com/michaelshimeles/hono-starter-kit) — reference implementation
- [Build a serverless API using Cloudflare Workers, Drizzle ORM, and Neon](https://neon.com/blog/api-cf-drizzle-neon) — recommended backend stack
- [Cloudflare AI Gateway — Anthropic provider](https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/) — AI proxy + caching pattern
- [Token expiration and revocation best practices — Auth0](https://auth0.com/docs/secure/tokens/token-best-practices) — short-lifespan + DB-row revocation pattern
- [Azure SAS tokens stored access policy pattern](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview) — opaque-pointer-token revocation precedent
- [Local-First Software — PowerSync resources](https://docs.powersync.com/resources/local-first-software) — Ink & Switch principles applied to sync
- [Captain Codeman: Local First with Cloud Sync using Firestore](https://www.captaincodeman.com/local-first-with-cloud-sync-using-firestore-and-svelte-5-runes) — local/cloud-mode flag pattern

---
*Architecture research for: GLP-1 / peptide-tracking SaaS (LeanShot)*
*Researched: 2026-05-10*
