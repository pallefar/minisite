# LeanShot — HIGH-Severity Blocker Resolution

**Date:** 2026-05-30 · Follow-up to `RELEASE-READINESS-REVIEW-2026-05-30.md`
**Scope:** the 12 HIGH-severity confirmed findings. Every fix below was verified against the **actual** source before applying (the review's auto-proposed fixes were treated as a starting point, not gospel — see #8 and #10 where they were wrong or incomplete).

> **No commits/push/deploy.** All changes are in the working tree, reversible via git.
> Frontend fixes are typecheck + lint + build validated. Edge-Function (Deno) and
> SQL fixes **cannot** be validated by the frontend gates — they need `deno check`
> / `supabase db push` / the RLS+E2E suite in CI before deploy.

## Outcome summary

| # | Finding | Area | Status |
|---|---------|------|--------|
| 1 | `calcMedLevel` mixed mg/units/ml in one sum | pharma (FE) | ✅ Fixed |
| 2 | curve "current level/next shot/peak" keyed off `injections[0]` not most-recent | pharma (FE) | ✅ Fixed (GLPCurveCard + MedicationTab) |
| 3 | `upsertWeight` never synced weights to cloud | store (FE) | ✅ Fixed |
| 4 | admin research `markdown_body` never rendered | research (FE) | ✅ Fixed |
| 5 | clinic Dose-Thresholds role gate used non-existent roles + unscoped query | clinic (FE) | ✅ Fixed |
| 6 | read-share curve used VIEWER's medication | share (FE) | ✅ Fixed (fail-safe) + ⚠️ Edge payload follow-up |
| 7 | stripe-webhook marked event processed before handler → lost grants | billing (Edge) | ✅ Fixed — needs deploy |
| 9 | account-delete missed affiliate photos (wrong bucket) | auth (Edge) | ✅ Fixed — needs deploy |
| 10 | patient-invite bound consent to attacker email | clinic (Edge+SQL) | ✅ Edge fix + migration — needs db push |
| 11 | RAG out-of-corpus gate used boosted score not raw cosine | rag (Edge) | ✅ Fixed — needs deploy |
| 12 | pause-reminder queried non-existent `profiles` columns | ops (Edge) | ✅ Fixed — needs deploy |
| 8 | accept-offer could apply an offer twice | billing (Edge+SQL) | ⏸️ **Deferred — needs a DB migration** (see below) |

## Frontend fixes (typecheck + lint + build validated)

- **#1 `src/lib/pharmacology.ts`** — `calcMedLevel` is now unit-aware: only mg-denominated doses contribute to the mg superposition total; `units`/`ml` doses (compounded, no concentration) are skipped instead of being added as if they were mg. Unitless legacy doses still count as mg.
- **#2 `GLPCurveCard.tsx` + `MedicationTab.tsx`** — "current level", "next shot due", peak/trough, and "last shot" now derive the most-recent injection **by datetime** (`reduce(max datetime)`), not `injections[0]`. The store prepends on add, so `[0]` was only correct in the pure local-append path and broke after a backdated shot or any cloud/Realtime merge.
- **#3 `src/lib/store.ts`** — `upsertWeight` (the only live weight-logging path; `addWeight` is dead) now stamps `weight_id` + `updated_at` and enqueues a `weights` upsert + `deferFlush()`, mirroring `addWeight`/`editWeight`. Weights logged in the UI now reach the cloud. Existing same-date row's `weight_id` is preserved so edits address the same cloud row.
- **#4 `ResearchArticlePage.tsx`** — prefers the admin-authored inline `markdown_body` (DB) when present, falling back to the build-time `/research-content/<slug>.md` static file.
- **#5 `ClinicDrillInPage.tsx`** — the role enum was renamed in migration `p31_00` (`admin→owner`, `staff→clinician`, `viewer→staff`) but this hook still used the old literals, so owners/clinicians never saw the tab; and the query was unscoped (`.eq('org_id')` + `.maybeSingle()` → throws in multi-member orgs). Now gates on `owner`/`clinician` (the post-rename equivalents of the original intent, matching the `reset_patient_dose_thresholds` SECDEF) and scopes the query to the current user's `user_id`.
- **#6 read-share medication** — `MedLevelChart` no longer falls back to the viewer's store medication when rendering a snapshot (it would draw a patient's curve with the wrong drug's half-life). Added optional `medication` to `SnapshotData`, threaded `snapshot.medication → ReadOnlyPatientView → ChartSection → MedLevelChart`, and `ChartSection` renders an explicit *"Drug-level estimate unavailable"* state when the drug is absent. **⚠️ Follow-up:** the `share` / `clinic-snapshot` Edge Functions must populate `SnapshotData.medication` so the curve renders again (until then it shows "unavailable" — correct, vs. a wrong curve).

## Edge-Function fixes (apply via deploy; not frontend-gate-validated)

- **#7 `stripe-webhook/index.ts`** — on handler failure, the unprocessed `subscription_events` idempotency row is now rolled back (`DELETE ... WHERE event_id=? AND processed_at IS NULL`) before the 500, so Stripe's retry re-runs the (idempotent) handler instead of hitting the duplicate-skip path. Happy-path + concurrency guard untouched.
- **#9 `account-delete/index.ts`** — storage delete now targets bucket **`affiliate-photos`** (prefix `<uid>/`), where partner photos actually live (`PartnerCustomizeForm.tsx`), instead of bucket `photos` with a bogus `affiliate-photos/<uid>/` path prefix that deleted nothing.
- **#11 `rag-retrieve/index.ts`** — out-of-corpus refusal gate now keys on **raw cosine** (`raw_score`), not the tier-boosted `final_score` (a tier-A 1.2× boost could lift an irrelevant chunk past the refusal floor). Boosted score still used for ranking.
- **#12 `pause-reminder-fire/index.ts`** — `fetchProfile` now resolves email/first_name via `auth.admin.getUserById` (matching `community-admin-report-digest`) instead of selecting non-existent `profiles.email/first_name/user_id`, which errored → null → every pause reminder + resume email was silently dropped. Errors are now logged.
- **#10 `clinic-patient-invite/index.ts` + new migration `20290108000011_*.sql`** — the `/accept` route now verifies the caller-supplied email matches the invite's bound `patient_email` before resolving/creating an account (defense-in-depth). The **authoritative** fix is the migration: `accept_org_patient_invite` is granted to `authenticated` (directly callable, bypassing the Edge Fn) and never checked the email — it now raises `invite email mismatch` (42501) when the accepting account's `auth.users.email` ≠ the invite's `patient_email`. **Run `supabase db push` to apply.**

## #8 — Deferred (needs a DB migration; the review's proposed fix was wrong)

**`cancellation-accept-offer/index.ts`** — pause/discount/downgrade offers can be applied twice (double discount/pause) because the offered row is never marked terminal; acceptance is recorded as a **separate** `status='accepted'` row (2-row append) so the `.eq('status','offered')` idempotency gate always matches.

The review proposed claiming the row via `UPDATE ... SET status='accepting'`. **That would break the function for every user** — `cancellation_offers_log` is an append-only ledger with a `BEFORE UPDATE` trigger (`_p40_cancellation_offers_log_block_update`) that raises `append_only_table`, and `'accepting'` isn't in the status `CHECK` set. There is also no `offered_log_id` FK linking the accepted row to the offered row, so the Edge layer can't cleanly detect "this specific offer was already accepted."

**Recommended fix (migration + Edge, with the test suite):**
1. Add `offered_log_id uuid` (FK → `cancellation_offers_log.id`) to the accepted-row insert.
2. Add a unique partial index: `create unique index ... on cancellation_offers_log (offered_log_id) where status = 'accepted';`
3. In the Edge Fn, set `offered_log_id = offer_id` on the accepted-row insert; a duplicate accept then fails with `23505` → return `409 offer_already_accepted` (mirrors the existing `extended_trial` PK-idempotency pattern at `promo_trial_extensions_log`). This is concurrency-safe and append-only-compatible.

This belongs in a planned billing change with its existing Deno test suite, not an autonomous patch.
