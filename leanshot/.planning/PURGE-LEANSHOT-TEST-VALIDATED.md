# Purge `@leanshot.test` accounts — VALIDATED plan (2026-06-01)

**Status: HELD.** User chose "don't delete yet" on 2026-06-01. This plan is fully
validated against prod (`ytnsipxxmzgaebkqmokp`) via a scoped transactional dry-run.
Nothing has been deleted. Trigger it when ready.

## ⚠️ The original handoff recipe was WRONG
The handoff said: "delete the users' `freeze_tokens_ledger` rows first (DELETE is
allowed — the trigger only blocks UPDATE)." **False.** `freeze_tokens_ledger` has
**two** append-only triggers: `freeze_tokens_ledger_no_update` AND
`freeze_tokens_ledger_no_delete`. It also missed **2 RESTRICT FKs** and **~15
NO-ACTION FKs** to `auth.users`, plus the **11 RESTRICT children of
`organizations`**. The real purge is a multi-table, dependency-ordered,
trigger-bypassing operation.

## Blast radius (measured)
- `auth.users`: 3,822 test users (incl. **288** with `admin_role`). Total 7,644 → 3,822.
- Operator `karsten.haldan@gmail.com` = superadmin, **NOT** in test set — survives. ✅
- `organizations` created_by test users: **2,998** (RESTRICT). **0 real users** are
  members/patients of them (isolation verified) → safe to delete + cascade.
- `freeze_tokens_ledger.user_id` test rows: **3,728** (append-only, both triggers).
- `clinician_alerts`: ~192 (patient_user_id RESTRICT) + org-side.
- NO-ACTION user refs (nullable → NULLed, rows preserved): `audit_logs.actor_user_id`
  (5,920), `rag_topic_audit.actor_user_id` (573), `rag_topics.created_by` (146) /
  `last_edited_by` (195). Other NO-ACTION FKs had 0 test refs.
- `xp_ledger`, `badge_unlocks`, `landing_page_revisions` (other append-only guards): 0 test rows.
- `organizations` delete is itself blocked by 11 RESTRICT children
  (`org_members`, `org_settings`, `org_branding`, `org_consent_grants`, `org_invites`,
  `org_patient_links`, `org_patient_invites`, `org_patient_thresholds`,
  `org_onboarding_flows`, `clinician_alerts`, `tickets`) + an append-only
  `cancellation_offers_log` SET-NULL edge. All cleared first.

## Capability facts
- MCP runs as role `postgres` (is_super=false, bypass_rls=true). It **owns**
  `freeze_tokens_ledger`, `cancellation_offers_log`, `organizations` → can
  `ALTER TABLE … DISABLE/ENABLE TRIGGER` (validated). Cannot use
  `session_replication_role` (needs superuser).
- The full single-transaction run **TIMES OUT** the MCP statement timeout
  (3,822-user cascade too heavy) → must run **BATCHED**.

## Dry-run proof (scoped, rolled back, nothing persisted)
```
SCOPED_DRYRUN_OK users_before=7644 pu=50 po=50 operator_alive=1
                 ftl_del=50 alerts_del=11 orgs_del=50
```
`users_before=7644` proves the earlier timed-out full run persisted nothing.
`operator_alive=1` (count taken AFTER the user delete) proves operator safety.
All org RESTRICT children + cascade cleared with no FK error.

## Batched real execution (run via MCP execute_sql, in order)
Each step is its own auto-committing call. Trigger disable/enable is wrapped per
step so guards are never left disabled between calls.

1. **NULL nullable NO-ACTION refs** (preserve audit/rag rows):
   ```sql
   WITH t AS (SELECT id FROM auth.users WHERE email ILIKE '%@leanshot.test')
   UPDATE public.audit_logs      SET actor_user_id=NULL WHERE actor_user_id IN (SELECT id FROM t);
   -- repeat for rag_topic_audit.actor_user_id, rag_topics.created_by, rag_topics.last_edited_by
   ```
2. **freeze_tokens_ledger** test rows:
   ```sql
   DO $$ BEGIN
     ALTER TABLE public.freeze_tokens_ledger DISABLE TRIGGER freeze_tokens_ledger_no_delete;
     DELETE FROM public.freeze_tokens_ledger
       WHERE user_id IN (SELECT id FROM auth.users WHERE email ILIKE '%@leanshot.test');
     ALTER TABLE public.freeze_tokens_ledger ENABLE TRIGGER freeze_tokens_ledger_no_delete;
   END $$;
   ```
3. **clinician_alerts** (user-side patient RESTRICT):
   ```sql
   DELETE FROM public.clinician_alerts
     WHERE patient_user_id IN (SELECT id FROM auth.users WHERE email ILIKE '%@leanshot.test');
   ```
4. **Test orgs** in chunks (≤1000), per chunk: disable
   `cancellation_offers_log` block triggers → delete the 11 RESTRICT children +
   `cancellation_offers_log` + org-side `clinician_alerts` for that chunk →
   `DELETE FROM organizations` → re-enable triggers. Repeat until 0 test orgs.
5. **Test users** in chunks (~250–500): `DELETE FROM auth.users WHERE id IN
   (SELECT id FROM auth.users WHERE email ILIKE '%@leanshot.test' LIMIT N)` —
   repeat until 0. (NO-ACTION/RESTRICT/append-only refs already cleared; only
   CASCADE + SET-NULL remain.)
6. **Verify**: `email ILIKE '%@leanshot.test'` count = 0;
   `karsten.haldan@gmail.com` count = 1; all 4 append-only triggers `tgenabled='O'`.

The exact validated single-transaction DO block (swap final `RAISE EXCEPTION`
for `COMMIT` semantics; or run batched as above) is in the session transcript.

## Residual (acceptable for test data)
- `stripe_customers` rows delete locally; Stripe-side customers not touched (test mode).
- Orphaned Storage objects (test photos) are not FK-cascaded — negligible.
