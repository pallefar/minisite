---
phase: 05
status: interim
owner: support@leanshot.app (placeholder — founder for beta)
last_updated: 2026-05-11
superseded_by_phase: 07
---

# Account Deletion — Interim Runbook (Phase 5 Beta)

**Purpose:** Phase 5 ships invite-only beta WITHOUT a self-service account-deletion UI. The full GDPR/CCPA-grade deletion (audit trail, data-export-before-delete, retention windows, legal-counsel sign-off) lands in Phase 7 (Compliance Foundations, COMPL-06). For the interim, beta users can request deletion via support; this document is the runbook.

## Scope (what gets deleted)

Deleting the `auth.users` row cascades to:

- `public.ai_messages` (Phase 4 migration `20260512000000_ai_messages.sql` — `on delete cascade`)
- `public.rate_limit_counters` (Phase 4 migration `20260512000001_rate_limit_counters.sql` — `on delete cascade`)
- `public.injections` (Phase 5 migration `20260513000000_injections.sql` — `on delete cascade`)

Future tables (Phase 6: weights, meals, photos, supplements, mood, sleep, symptoms, settings) MUST adopt the same `on delete cascade` pattern.

NOT deleted (out of scope for Phase 5 manual deletion):

- Supabase Storage objects (none in Phase 5; Phase 6 adds photos).
- Server-side logs (Sentry, PostHog — retained per their own retention policies; user can request via founder for beta).

## Procedure

1. Retrieve service-role key (`.planning/decisions/supabase.md`):

   ```bash
   npx --prefix leanshot supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp
   # Copy the service_role JWT value.
   ```

2. Look up user_id from email:

   ```bash
   SR=<service-role-jwt>
   curl -s -H "Authorization: Bearer $SR" -H "apikey: $SR" \
     "https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/admin/users?email=user@example.com" \
     | jq -r '.users[0].id'
   ```

3. Delete the user via admin API:

   ```bash
   USER_ID=<from step 2>
   curl -s -X DELETE -H "Authorization: Bearer $SR" -H "apikey: $SR" \
     "https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/admin/users/$USER_ID"
   ```

   **Alternative (supabase-js admin client, used in our e2e cleanup):**

   ```ts
   import { createClient } from '@supabase/supabase-js';
   const admin = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
   await admin.auth.admin.deleteUser(userId);
   ```

## Verification

After deletion, confirm CASCADE worked:

```sql
-- Via Supabase SQL editor or psql with the service-role connection string:
select count(*) from auth.users where id = '<USER_ID>';                          -- expect 0
select count(*) from public.ai_messages where user_id = '<USER_ID>';            -- expect 0
select count(*) from public.injections where user_id = '<USER_ID>';             -- expect 0
select count(*) from public.rate_limit_counters where user_id = '<USER_ID>';    -- expect 0
```

Run the same queries via:

```bash
cd /Users/karstenhaldan/minisite/ && \
  npx supabase db query --linked \
  --sql "select count(*) from auth.users where id = '<USER_ID>';"
```

## Notes for Phase 7

Phase 7 (Compliance Foundations) replaces this manual runbook with:

- Self-service Settings → "Delete my account" UI (typed-confirmation pattern).
- Pre-deletion data export (JSON + readable PDF).
- 30-day soft-delete retention period.
- Audit log entry with deletion timestamp + actor.
- Crypto-shredding for photos (Phase 6 introduces them; Phase 7 adds the shred step).
- WMHMDA + FTC HBNR compliance — privacy-counsel-reviewed copy + retention notice.

Until Phase 7 ships, all deletion requests route to the support email above. Aim to respond within 7 days (post-launch SLA).
