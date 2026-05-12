# Phase 6: Patient Cloud Sync Slice 2 — Full Data + Migration + Photos - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 6 (default mode, --all gray areas)

<domain>
## Phase Boundary

Generalize Phase 5's injection-only sync to every remaining patient-owned data type, ship the one-shot `leanshot_v4` → cloud migration with a 90-day backup snapshot, move photos out of the localStorage-persisted Zustand slice into Supabase Storage with signed URLs, and harden the offline mutation queue so photo blobs survive offline capture and replay on reconnect. Closes SYNC-02 / SYNC-03 / SYNC-04 / SYNC-06.

8 of the 9 new patient-owned tables (`weights`, `meals`, `workouts`, `supplements`, `mood`, `sleep`, `symptoms`, `vials`) follow Phase 5's `public.injections` shape mechanically: composite PK `(user_id, <entity>_id)` + moddatetime LWW trigger + `auth.uid() = user_id` default-deny RLS + Realtime publication membership. The 9th — `settings` — is a per-user singleton (PK = user_id alone, single row per user). Schema specifics for `supplements` (currently `Record<dateString, Record<name, boolean>>` in Zustand) and `vials` (discrete entity identity) are Claude's discretion to design, informed by Phase 5 patterns; the researcher should propose final shapes.

In scope: (a) 9 SQL migrations creating the new tables + RLS + publication entries, (b) `sync.ts` generalization using the `subscribeToTable<T>` generic already shipped in Phase 5, (c) `addX/editX/removeX` enqueue wiring across the new entities, (d) leanshot_v4 → cloud one-shot migration with per-entity progress UI + resumable failure recovery + 90-day backup snapshot, (e) Supabase Storage path conventions + client-side compression + signed-URL caching + IndexedDB blob queue for offline photo uploads, (f) LWW conflict toast UX, (g) the CI bundle-size + format fixes carried over from Phase 5 ship.

Out of scope (deferred): doctor read-share (Phase 8), clinic B2B roster (Phases 9-10), GDPR/HIPAA compliance UI (Phase 7), photo soft-delete / trash bin (Phase 7 GDPR will unify), audit logs for cloud writes (Phase 7), Phase 4 Deno test resurrection (separate /gsd-debug session).

</domain>

<decisions>
## Implementation Decisions

### Migration UX & failure recovery (D-01 .. D-03)

- **D-01 (LOCKED, foreground modal + per-entity progress):** First sign-in for an existing `leanshot_v4` user opens a blocking modal — "Migrating your data: 47 injections, 12 photos, 3 vials, …" — with one counter row per entity that ticks up as each row uploads. Dashboard is gated behind modal completion (or explicit "Continue with sync running" escape hatch — Claude's discretion). Cloud-with-prior conflicts (the user already has rows from another device) resolve via Phase 5's LWW (server `updated_at` wins) — no per-row prompt. Counter order: size-descending (biggest table first) so the patient sees the largest counter moving most.

- **D-02 (LOCKED, resume from last completed entity):** Migration is idempotent and resumable. A `migration_state` slice tracks per-entity progress: `{ injections: 'complete', weights: 'in-progress', photos: 'pending', ... }`. On every successful upload, `migration_state` advances and is persisted (Zustand persist allowlist bump in this phase). If sign-in finds `migration_state.complete !== true`, the modal resumes mid-flight: "Resuming migration — 3 of 9 entities done…". No restart-from-backup unless `migration_state` itself is corrupted (Claude's discretion: detection rule).

- **D-03 (LOCKED, backup file format):** Before any cloud write, snapshot `localStorage.getItem('leanshot_v4')` into `localStorage.setItem('leanshot_v4_pre_cloud_backup', { state: ..., version: 7, snapshotAt: ISO })` — verbatim JSON, retained 90 days. After 90 days, a periodic cleanup (Claude's discretion on trigger — could be on next sign-in if `snapshotAt + 90d < now`) removes it. The backup is read-only to the app — there's no in-app "restore from backup" affordance in this phase (Phase 7 GDPR handles user-facing data recovery).

### Photo storage architecture (D-04 .. D-07)

- **D-04 (LOCKED, Storage path convention):** `{userId}/photos/{photoId}.jpg` (note: actual extension from compression output). The bucket is scoped under the user's UUID at the path prefix level so RLS Storage policies can enforce `auth.uid()::text = (storage.foldername(name))[1]` — the same default-deny pattern as database RLS. Bucket name + RLS policy text is Claude's discretion.

- **D-05 (LOCKED, signed-URL strategy):** Client-side cache signed URLs (Map<photoId, {url, expiresAt}>) with refresh-on-401 (intercept fetch errors, request a new signed URL, retry once). Default signed-URL TTL is 5 minutes per CONCERNS.md / PITFALLS.md Pitfall #7. The cache is in-memory (NOT persisted) so cross-device sign-out clears it implicitly.

- **D-06 (LOCKED, client-side compression on upload):** Compress every photo client-side before Storage upload via canvas: max 1600px on longest edge, JPEG quality 85, target <1 MB. Done in a Web Worker if possible to avoid main-thread jank during multi-photo migration (Claude's discretion). Original full-res photo is NOT retained anywhere — patients re-take if needed. Aggressive-foundations preference: this is the right v1 tradeoff (5× smaller Storage cost, 5× faster mobile signed-URL fetches, no quality loss at typical viewing sizes).

- **D-07 (LOCKED, hard-delete on row delete):** When the user deletes a photo row from the dashboard, the Storage object is also deleted (cascade via a `delete` policy + a row-level trigger, OR client-side `supabase.storage.from('photos').remove([path])` after the table delete — Claude's discretion). No soft-delete / trash-bin in v1; Phase 7 GDPR work will introduce user-visible deletion semantics for the broader data export/delete story.

### Offline queue substrate (D-08 .. D-09)

- **D-08 (LOCKED, hybrid substrate):** Phase 5's `pendingOps` slice stays in localStorage (small JSON, proven by 16 passing tests). New IndexedDB store `leanshot_photo_queue` holds Blob payloads keyed by `upload-op-id`. A pendingOps entry for a photo upload looks like `{ table: 'photos', op: 'upload', key: photoId, blob_ref: <indexeddb-key> }`. The sync engine resolves `blob_ref` by reading IndexedDB before invoking `supabase.storage.from('photos').upload(...)`. Smallest delta from Phase 5; substrates are appropriately sized.

- **D-09 (LOCKED, upload concurrency = serial 1-at-a-time):** Photo uploads from the queue drain serially. Avoids hitting Supabase Storage rate limits during migration, gives deterministic progress reporting, and keeps the IndexedDB transaction model simple. Non-photo ops (already covered by Phase 5's `flushSyncQueue`) keep their existing serial draining.

### Existing-base64 photo migration (D-10)

- **D-10 (LOCKED, eager during migration):** Existing v2 users' base64 photos (currently stored in the Zustand `photos` slice as `dataUrl: "data:image/...;base64,..."`) are migrated EAGERLY during the leanshot_v4 → cloud migration. Per-photo flow: decode base64 → canvas-compress per D-06 → upload to Storage at the D-04 path → replace `photo.dataUrl` with `photo.storage_path` in the per-user namespaced Zustand state. The "12 photos" counter in D-01's UX tracks these. Post-migration the Zustand-persisted slice is finally lean (closes SC#3 + SYNC-06 deterministically, not asymptotically).

### Conflict UX (D-11)

- **D-11 (LOCKED, non-blocking toast on the losing device):** Per SC#4, when a server-wins (LWW) decision overwrites a local edit on the loser, surface a non-blocking toast: "We kept your most recent edit." Toast duration ~5s, dismissible, no recovery affordance (Phase 7 audit log + data export handles "I want to see what was overwritten"). Wording is Claude's discretion but should match the existing Toast component's tone.

### CI hardening (D-12)

- **D-12 (LOCKED, Plan 06-01 = explicit CI hardening, blocking prerequisite):** First Phase 6 plan does THREE things and is `depends_on: []` for every other Phase 6 plan:
  1. `npm run format -- --write` across the 18 files Prettier flagged after Phase 5 ship, single commit.
  2. Extract the eager imports of `@/lib/sync`, `@/lib/auth-migration`, and (transitively) `@supabase/supabase-js` out of `src/App.tsx`'s static graph. Introduce a new `src/lib/sync-defer.ts` modeled on Phase 2.1's `src/lib/telemetry-defer.ts` — an `idle`-scheduled deferred-init wrapper that dynamic-imports the heavy modules AFTER first paint, with a small pre-init buffer (queue subscribe/flush/migrate calls until loaded() drains them). Re-prove the bundle-size guard green via `npm run build` + the `dist/index-*.js gzip ≤ 50 kB` assertion in CI.
  3. Fold in the latent `MedLevelChart.tsx:13` fix (1-line null-guard: replace `useStore((s) => s.user!)` with nullable selector + early-return) flagged out-of-scope in 05-06-SUMMARY.

  Every other Phase 6 plan (migration UI, photo storage, new-tables sync, conflict toast) declares `depends_on: ['06-01']`. CI must be green at the close of 06-01 before any other Phase 6 plan runs in execute-phase.

### Per-table schema notes for the researcher (D-13)

- **D-13 (LOCKED, schema delegation rules):** Eight of the nine new tables (`weights`, `meals`, `workouts`, `supplements`, `mood`, `sleep`, `symptoms`, `vials`) are STRUCTURALLY similar to `public.injections` and should follow its shape: composite PK `(user_id, <entity>_id)`, server-authoritative `updated_at` via moddatetime trigger, `auth.uid() = user_id` default-deny RLS with 4 policies, Realtime publication membership. The researcher should propose:
  - For `vials` and `supplements`: the discrete-vs-daily identity model. `vials` is discrete entity (composite PK fits). `supplements` is currently `Record<dateString, Record<name, boolean>>` — needs flattening to either `(user_id, date, supplement_name, taken)` rows OR `(user_id, date, payload jsonb)` with a single row per day. The researcher recommends, the planner picks.
  - For `settings`: per-user singleton, PK = `user_id`, no entity_id column. Realtime SELECT/UPDATE only (no INSERT/DELETE in normal flow — created on first save, never deleted while account is active). Acknowledge in research the asymmetry vs the other 8 tables.

### Realtime channel topology (D-14)

- **D-14 (LOCKED, one channel per table, 9 channels total):** Mirror Phase 5's pattern — one Realtime channel per table named `{table}:{userId}` with one `postgres_changes` binding filtered on `user_id=eq.<uid>`. Total 9 channels per signed-in client. Trade-offs accepted: 9 WebSocket multiplex topics + 9 phx_join handshakes on sign-in. Benefits: per-table teardown on selective sign-out (n/a in v1 but ready), simple debugging, isolated reconnect behavior per table. Researcher should validate Supabase doesn't impose a < 9 channels per connection cap at the Tier 1 / free tier level (Pitfall: it doesn't, but verify).

### Claude's Discretion (not pre-decided)

- Counter order specifics in D-01 (size-descending is the heuristic; researcher/planner can refine if research surfaces UX research saying otherwise).
- Conflict-toast exact wording in D-11 (just match Toast component tone).
- IndexedDB store schema details in D-08 (object store name, index columns, version bump).
- Web Worker vs main-thread for canvas compression in D-06 (latency budget driven).
- `migration_state` corruption detection rule in D-02 (e.g., what counts as "corrupted" — JSON parse fail, missing required keys, etc.).
- `supplements` schema flattening choice in D-13 (researcher recommends, planner picks).
- Photo `storage.foldername` RLS policy SQL in D-04 (planner writes).
- Bucket name (e.g., `photos` vs `patient-photos`) in D-04.
- Periodic `leanshot_v4_pre_cloud_backup` cleanup trigger in D-03.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 outputs that Phase 6 directly builds on (MANDATORY)
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-CONTEXT.md` — D-08 LWW, D-09 Realtime channel topology, D-12 namespaced storage, D-13 isSyncEnabled gate
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-RESEARCH.md` — Pitfalls (esp. #4 migration matrix, #7 signed URL TTL, #10 postgres_changes filter syntax, #11 server-authoritative updated_at)
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-VALIDATION.md` — Nyquist Dimension 8 patterns to replicate
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-01-SUMMARY.md` — schema migration template for the 9 new tables
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-03-SUMMARY.md` — sync.ts patterns (subscribeToTable<T> generic, flushSyncQueue, pendingOps wiring)
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-05-SUMMARY.md` — createNamespacedStorage + setActiveStorageUserId + the M4 ordering contract test (Phase 6 must NOT regress this)

### Phase 2.1 reference for D-12 CI hardening (MANDATORY for Plan 06-01)
- `.planning/phases/02.1-spa-lighthouse-perf/02.1-RESEARCH.md` — the modulepreload-+-static-import bloat pattern and the deferred-init fix shape
- `leanshot/src/lib/telemetry-defer.ts` — the proven `idle`-scheduled deferred-init wrapper template that `sync-defer.ts` mirrors

### Project-level
- `leanshot/CLAUDE.md` — Tech stack, performance/a11y constraints, "AI outage = degraded coach UX, not full-app outage" (analog: "sync outage = degraded sync UX, not full-app outage" — local-first MUST keep working)
- `leanshot/.planning/PROJECT.md` — Core value, requirements, evolution rules
- `leanshot/.planning/REQUIREMENTS.md` — SYNC-02 (no data loss on migration), SYNC-03 (90-day backup), SYNC-04 (IndexedDB queue + LWW), SYNC-06 (photos out of Zustand)
- `leanshot/.planning/codebase/ARCHITECTURE.md` — Zustand store shape, persist middleware contract
- `leanshot/.planning/codebase/CONCERNS.md` — v3→v4 lossy migration anti-pattern (mandated mitigation: SYNC-03 backup)
- `leanshot/.planning/codebase/CONVENTIONS.md` — TypeScript strict mode, import patterns, naming
- `leanshot/.planning/codebase/STRUCTURE.md` — Where new files belong (`src/lib/`, `src/components/auth/`, etc.)
- `leanshot/.planning/codebase/TESTING.md` — Vitest + Playwright split (e2e/*.spec.ts vs */*.test.ts)

### External docs (researcher must verify current at execution time)
- Supabase Storage: https://supabase.com/docs/guides/storage (bucket creation, RLS policies, signed URLs)
- Supabase Storage RLS: https://supabase.com/docs/guides/storage/security/access-control (the `(storage.foldername(name))[1]` pattern)
- IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API (object stores, transactions, versioning)
- `idb` library candidate: https://github.com/jakearchibald/idb — thin promise wrapper, vetted, ~1 kB. Researcher to compare against `dexie` (heavier but richer query API) and recommend.
- Browser canvas compression: `OffscreenCanvas` for Web Worker path (D-06)
- supabase-js `storage.from(bucket).upload()` API contract

### Out-of-scope but worth knowing exists
- `.planning/phases/05-patient-cloud-sync-slice-1-auth-injections/05-06-SUMMARY.md` — out-of-scope note about `MedLevelChart.tsx:13` (folded into Plan 06-01 per D-12).
- `.planning/phases/02.1-spa-lighthouse-perf/02.1-SUMMARY.md` — the chunking strategy already in place that 06-01's deferred-init must compose with.

</canonical_refs>

<specifics>
## Specific Ideas

- Migration UX modal mockup direction: a clean checklist with one row per entity, each row has `[entity-name] — [count] — [progress bar | "Done" | "Pending"]`. Resume case prefixes with "Resuming migration —". Modal can be dismissed (escape hatch) but reminds user of unfinished migration on next sign-in.
- Conflict toast wording starting point (Claude's discretion to refine): "We kept your most recent edit."
- The 90-day backup retention starts at `snapshotAt`, not at the user's first sign-in — so a user who returns after 100 days finds the backup already cleaned up. This is intentional: 90 days is a recovery window, not an archive.
- Bundle-size guard in `.github/workflows/ci.yml` SC#2 — Plan 06-01 must KEEP this assertion green, NOT relax the 50 kB ceiling. Future cloud-touching phases will keep biting if 06-01 only patches and doesn't establish the deferred-init pattern as a project-level rule.

</specifics>

<deferred>
## Deferred Ideas

- **Photo soft-delete / trash bin** — Phase 7 GDPR work will unify deletion semantics across all data types.
- **In-app "restore from backup" UI** — Phase 7 user-facing data recovery story owns this. v1 backup is read-only.
- **Per-row "what was overwritten?" recovery** — Phase 7 audit log + data export covers this. v1 conflict toast is fire-and-forget.
- **Codebase-wide `s.user!` audit** — Only `MedLevelChart.tsx:13` is folded in (06-01 D-12). A broader audit of all non-null assertions is deferred until a second observable crash from this pattern emerges, OR Phase 7 hardening pass picks it up.
- **Phase 4 Deno test resurrection** — "No test modules found" failure predates Phase 5. Investigate via /gsd-debug separately; do NOT scope into Phase 6.
- **HIPAA Storage BAA** — Phase 7 Supabase Team-tier upgrade decision. Phase 6 ships on free-tier Storage; data minimization + disclaimer overlay cover the v1 risk surface.

</deferred>

---

*Phase: 06-patient-cloud-sync-slice-2-full-data-migration-photos*
*Context gathered: 2026-05-12 via /gsd-discuss-phase 6 (default mode, --all gray areas)*
*Decisions: 14 locked + 9 Claude's discretion items*
