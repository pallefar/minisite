# Phase 5 Discussion Log

**Discussed:** 2026-05-11
**Mode:** discuss (default)
**Output:** `05-CONTEXT.md`

> Human reference only — not consumed by downstream agents (researcher, planner, executor).

---

## Pre-discussion: Locked decisions carried from memory + Phase 4

These were surfaced explicitly so they were NOT re-discussed:

- **Anon UID promotion uses `supabase.auth.updateUser({email})` then `updateUser({password})`** — `linkIdentity` is OAuth-only. Proven live in Phase 4 04-03 Task 5 (`anonId === permanentId` after attachment; RLS-scoped `ai_messages` row remains readable). Source: `project_phase4_linkidentity_correction.md` + Phase 4 RESEARCH §Pitfall 5 + `.planning/decisions/supabase.md`.
- **Auth providers already enabled** — magic-link, anonymous, manual-linking (Phase 4 04-01 Task 4 via `supabase config push`).
- **Production-safe email config** — `mailer_autoconfirm=false`, `max_frequency=1m0s`, `otp_length=8` (Phase 4 04-01 commit `a9850a0`).
- **RLS pattern** — `auth.uid() = user_id`, default-deny on all CRUD (Phase 4 `ai_messages` pattern → Phase 5 `injections` mirrors).
- **AI provider model-agnostic for Phase 5** — Moonshot Kimi K2.6 backing AI Coach unchanged; Phase 5 doesn't touch the Edge Function.
- **SYNC-01 scope clarification** — REQUIREMENTS.md lists all data types but ROADMAP scopes Phase 5 to `injections` ONLY. Phase 5 delivers PARTIAL on SYNC-01; weights/photos/meals/etc are Phase 6 Slice 2.

---

## Areas selected for discussion (4 of 4 offered)

User picked all 4 — aligns with the `feedback_aggressive_foundations.md` max-coverage preference:

1. Auth surface design + magic-link vs password mix
2. Anonymous → permanent migration UX + pre-Phase-4 data
3. Sync conflict resolution + Realtime subscription lifecycle
4. Signout cache policy + multi-account-on-one-browser + email-verify gate

---

## Area 1 — Auth surface design + magic-link vs password mix (4 sub-questions)

### Q1: Where does the auth UI live in App.tsx's state machine?
**Options:** new top-level view / modal-over-current-view / drawer-from-topbar + page-takeover hybrid.
**Selected:** **New top-level view (Recommended).** Captured as D-01.
**Rationale:** Aligns with App.tsx's existing pattern (no router). Cleanest separation; auth views can lazy-load like onboarding. Modal-over-current-view loses deep-link support without a router.

### Q2: Magic-link vs password — which is the primary signup/signin path?
**Options:** password-primary + magic-link as forgot-password / magic-link primary + password optional / both equal.
**Selected:** **Password primary, magic-link as 'forgot password' alternative.** Captured as D-02.
**Rationale:** Familiar SaaS UX. Magic-link still surfaces (server-side enabled in Phase 4) as a power-user option but doesn't compete for cognitive space.

### Q3: Entry point from marketing — where does the 'Sign in / Sign up' CTA live?
**Options:** header link + hero CTA + post-onboarding prompt / header link only / hero CTA only.
**Selected:** **Top-right header link + hero CTA + post-onboarding 'save your data' prompt.** Captured as D-03.
**Rationale:** Maximum visibility on a user-acquisition-focused phase. Post-onboarding prompt captures high-intent moment (user has just put effort into setup).

### Q4: How does a signed-in user sign out / manage account?
**Options:** topbar avatar menu / Settings drawer adds Account section / both.
**Selected:** **Topbar avatar menu — Account / Sign out / Settings.** Captured as D-04.
**Rationale:** Standard SaaS pattern; quick signout discoverability. Account screen reuses Settings drawer pattern internally for consistency.

---

## Area 2 — Anonymous → permanent migration UX + pre-Phase-4 data (3 sub-questions)

### Q1: Anon UID promotion — silent vs explicit confirm?
**Options:** silent attach / explicit 'claim your chat history' modal / silent + post-signup toast.
**Selected:** **Silent attach + post-signup toast.** Captured as D-05.
**Rationale:** Zero friction during signup (the alternative — losing history — isn't actually offered, so a confirm would be a fake choice). Toast post-signup reinforces value without delaying the signin.

### Q2: Pre-Phase-4 localStorage injections — upload vs prompt vs abandon?
**Options:** silent upload / 'upload your N injections?' confirm modal / abandon silently.
**Selected:** **Upload silently to the new account (Recommended for a health app).** Captured as D-06.
**Rationale:** Health-app trust priority. Risk of accidental "No" click on a confirm modal is worse than the dedupe complexity (handled by `(user_id, log_id)` unique constraint).

### Q3: Combined edge case — pre-Phase-4 localStorage + Phase-4 anon UID + signup. Order?
**Options:** promote anon first then upload locals / anon migration only then explicit-confirm for locals / abandon anon and create fresh UID.
**Selected:** **Promote anon UID first → then upload local injections to that same UID.** Captured as D-07.
**Rationale:** Single account, no orphans. Aligns with the two prior silent-default decisions.

---

## Area 3 — Sync conflict resolution + Realtime lifecycle (3 sub-questions)

### Q1: Conflict resolution for same-row offline-mutation case?
**Options:** LWW by server `updated_at` / per-field merge / reject + manual-resolve UI.
**Selected:** **Last-write-wins by server `updated_at` (Recommended).** Captured as D-08.
**Rationale:** Server-authoritative timestamps avoid clock-skew. Injections are log-style data with rare same-row edits — per-field merge is overkill. Reject-UI premature.

### Q2: Realtime subscription scope and cleanup?
**Options:** single global on signin / BroadcastChannel per-tab + single subscription / per-component.
**Selected:** **Single global subscription on sign-in (Recommended).** Captured as D-09.
**Rationale:** Survives tab switches; one channel per user; cleanup on signout + unload. BroadcastChannel defer to v2 if multi-tab load justifies. Per-component subscription is local-first anti-pattern.

### Q3: Offline write queue location?
**Options:** Zustand + persist middleware / IndexedDB / Service Worker.
**Selected:** **Zustand state + persist middleware (already in place).** Captured as D-10.
**Rationale:** No new dependencies. STORAGE_VERSION bump 6 → 7 to include `pendingSyncIds`. IndexedDB defer until photos (Phase 6) push localStorage past 5MB; Service Worker defer to v2.

---

## Area 4 — Signout cache + multi-account + email-verify gate + account deletion (4 sub-questions)

### Q1: On signout, which Zustand slices to clear?
**Options:** clear user-data preserve theme+onboarded+tour / clear everything / clear sync-only.
**Selected:** **Clear all user-data slices; preserve theme + onboarded + tour_seen flags.** Captured as D-11.
**Rationale:** AUTH-05 says "clears local sensitive caches" — UI preferences aren't sensitive. Don't force re-onboarding/re-tour on re-signin (would feel broken).

### Q2: Multi-account safety — additional guards beyond signout clear?
**Options:** re-key localStorage by user_id hash / signout clear is enough / force reset on different-uid signin.
**Selected:** **Re-key localStorage by user_id after signin.** Captured as D-12.
**Rationale:** Defense-in-depth. Each user_id gets a namespaced localStorage key; even if signout-clear bugged out, no leak path. Anonymous users also get namespaces (hash of anon UID). STORAGE_VERSION 6 → 7 covers the migration.

### Q3: Email-verify gate — AUTH-02 vs AUTH-06 tension?
**Options:** block sync only / hard-block UI / block sync + nag banner.
**Selected:** **Block sync only; local logging works (Recommended — honors AUTH-06).** Captured as D-13.
**Rationale:** Aligns with the project's local-first invariant ("AI outage = degraded coach, not full-app outage" — same principle for verification). Banner with resend-verification CTA gives the right UX nudge without being punitive.

### Q4: Account deletion path — minimum for Phase 5?
**Options:** defer entirely to Phase 7 / self-service with 7-day grace / self-service instant hard delete.
**Selected:** **Defer entirely to Phase 7 (Compliance Foundations).** Captured as D-14.
**Rationale:** Phase 7 owns GDPR/CCPA-grade deletion with legal-counsel sign-off. Phase 5 invite-only beta users can email support; document the manual SQL runbook in `.planning/decisions/account-deletion-interim.md`.

---

## Deferred ideas captured

See CONTEXT.md `<deferred>` section. Highlights:
- Other-data-type sync (Phase 6 Slice 2)
- Account deletion UI (Phase 7)
- Custom email templates (Phase 7 brand pass)
- Magic-link as primary auth (post-launch user research dependent)
- OAuth providers (v2+)
- Multi-device trusted-devices management (future phase)
- Pricing-tier-aware sync (v2 monetization)

---

## Claude's Discretion items

See CONTEXT.md `<decisions> § Claude's Discretion` subsection. Researcher and planner have flexibility on:

- `injections` table schema details (columns, indexes, soft-delete decision)
- Email-confirm redirect URL strategy for Vercel previews (wildcard vs explicit)
- Password policy (default 6 chars too weak; researcher proposes)
- Custom email template authoring vs Supabase defaults
- Initial-sync direction on a new device (pull-all vs paginated)
- Account screen specific fields
- Topbar avatar UX (defer to UI-SPEC)
- Marketing/banner/toast copy (defer to UI-SPEC)
- Realtime reconnect-storm protection (debounce/backoff)

---

## Next steps surfaced

1. `/gsd-ui-phase 5` — generate UI-SPEC.md for the 5 auth sub-screens + avatar menu + banner + post-onboarding prompt + CTA copy.
2. `/gsd-plan-phase 5` — research (Supabase Realtime + auth specifics) + 3-plan break (likely: 5-01 schema+migrations+RLS, 5-02 auth UI + flows, 5-03 sync engine + Realtime subscription + cross-tenant RLS test) + verify.
