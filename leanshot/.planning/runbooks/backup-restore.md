---
artifact: OPS-07 — backup & restore runbook
status: active
owner: founder
created: 2026-05-27
next_review_due: 2027-05-27
phase: 67-operational-runbooks-observability
hipaa_control: §164.308(a)(7)(ii)(D) — Contingency Plan: Testing and Revision Procedures
---

# Backup & Restore Runbook

> **HIPAA Security Rule §164.308(a)(7)** requires a written contingency plan with:
> - **(A)** Data backup plan
> - **(B)** Disaster recovery plan
> - **(C)** Emergency mode operation plan
> - **(D)** Testing and revision procedures (the **restore drill** below)
> - **(E)** Applications and data criticality analysis

**Project ref:** `ytnsipxxmzgaebkqmokp`
**Supabase plan:** Pro (PITR requires Pro or higher — verify before relying on this doc).
**RPO target:** 5 minutes (PITR granularity)
**RTO target:** 30 minutes (P1 incident → restored DB)

---

## TL;DR — Three backup tiers

| Tier | Mechanism | RPO | RTO | When to use |
|------|-----------|-----|-----|-------------|
| **1. Supabase PITR** | Auto, continuous WAL archiving | 5 min | 30 min | Most restore scenarios — bad migration, mass DELETE, corruption |
| **2. `pg_dump` snapshot** | Operator-on-demand `.sql.gz` | Last manual run | 1-2 hours | Pre-migration safety net; cross-region copy; long-term retention |
| **3. Storage bucket snapshot** | Operator-on-demand JSON manifest + bucket clone | Last manual run | Bucket-size-dependent | Photo / video / artifact recovery |

> Supabase auto-backups (daily full + WAL) are tier-1. **Do not rely solely** on auto-backups for compliance — supplement with on-demand `pg_dump` snapshots before risky migrations.

---

## Tier 1: Supabase PITR (Point-In-Time Recovery)

### What it is

Supabase Pro plan archives Postgres WAL continuously, retaining the last **7 days** by default. Restore to **any second** within that window.

### When to use it

- Bad migration left tables in inconsistent state
- Mass-DELETE (operator-error or RLS bypass)
- Schema corruption (e.g. dropped column with live data)
- Targeted single-row recovery (via partial restore — see below)

### Pre-restore checklist (P1 mode)

- [ ] Identify exact restore timestamp (UTC). Source: Sentry trace timestamps, `ops_audit_log`, or "30 seconds before the bad `DROP`".
- [ ] Snapshot CURRENT state first (in case the restore is wrong): `npx supabase db dump -p ytnsipxxmzgaebkqmokp -f /tmp/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).sql.gz --data-only`
- [ ] **Inform users via status page** — PITR restore overwrites the entire DB; writes between target timestamp and now will be lost.
- [ ] **Pause cron jobs** so they don't re-fire during the restore window:
  ```sql
  -- Disable all pg_cron jobs (record originals first)
  SELECT jobid, jobname, schedule FROM cron.job;  -- save this output
  UPDATE cron.job SET active = false;
  ```
- [ ] **Pause inbound Stripe webhooks** if relevant (Stripe Dashboard → Webhooks → endpoint → Disable).

### Restore steps

1. **Open Supabase Studio** → Project → Settings → Database → Point in Time Recovery.
2. **Select target time** (UTC, second-precision).
3. **Choose target project**:
   - **Same project** (in-place) — replaces current DB. P1-mandatory.
   - **New project** (clone) — restores into a fresh project. Use for forensics / partial recovery.
4. **Confirm restore** — Supabase will:
   - Halt the Postgres instance (~30 sec)
   - Replay WAL up to target timestamp
   - Resume instance
   - Total downtime: ~10-30 min depending on data volume
5. **Wait for "Restore complete"** notification in Studio.
6. **Verify** (see Verification Checklist below).
7. **Re-enable** cron jobs + Stripe webhooks.
8. **Reconcile** drift:
   - Replay Stripe events from the gap: Stripe Dashboard → Events → resend each.
   - Re-trigger any deterministic ETL jobs (`ad-revenue-etl`, `cac-alert-cron`, etc.).
9. **Status page**: post resolution + brief incident notice.

### Partial restore (single table / row)

If you only need ONE table back:

1. Restore to a NEW Supabase project (step 3 → "New project" path).
2. From your local machine:
   ```bash
   pg_dump "postgresql://postgres.<RESTORED_REF>:<PW>@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
     --data-only --table=public.<table_name> -f /tmp/restored-<table>.sql
   ```
3. On the production DB, snapshot current then apply:
   ```bash
   psql "postgresql://postgres.ytnsipxxmzgaebkqmokp:<PW>@..." -c "BEGIN; CREATE TABLE public.<table>_predowngrade AS SELECT * FROM public.<table>; -- snapshot
   DELETE FROM public.<table> WHERE id IN (...); -- the rows to replace
   \i /tmp/restored-<table>.sql
   COMMIT;"
   ```
4. Verify foreign keys still resolve: `SELECT count(*) FROM <table> t LEFT JOIN <fk_table> f ON t.<fk>=f.id WHERE f.id IS NULL;`
5. Drop the temporary restored project (saves $).

---

## Tier 2: `pg_dump` Manual Snapshot

### When to take a snapshot

- **Before every risky migration** (column DROP, table rename, RLS policy overhaul, data backfill)
- Weekly cold storage (cron-scheduled in Phase 70+; manual in v1.4)
- Before any P1 incident response that could mutate data
- Pre-launch baseline (operator-run once before v1.4 launch)

### Take snapshot

```bash
# Set up
export PROJECT_REF=ytnsipxxmzgaebkqmokp
export PG_PASSWORD="<from-vendor-secrets.md SUPABASE_DB_PASSWORD>"
export TS=$(date -u +%Y%m%dT%H%M%SZ)

# Full dump (schema + data, gzipped)
PGPASSWORD="$PG_PASSWORD" pg_dump \
  "postgresql://postgres.$PROJECT_REF@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
  --no-owner --no-acl --format=custom \
  -f "/tmp/leanshot-snapshot-${TS}.dump"

# Verify file is non-empty + readable
ls -lh "/tmp/leanshot-snapshot-${TS}.dump"
pg_restore -l "/tmp/leanshot-snapshot-${TS}.dump" | head -20

# Upload to cold storage (encrypted)
gpg --symmetric --cipher-algo AES256 "/tmp/leanshot-snapshot-${TS}.dump"
# Then copy the .gpg file to: S3 / Backblaze / GCS — pick one cold-storage vendor (deferred to Phase 70)
```

### Restore from `pg_dump`

```bash
# On a FRESH Supabase project (do NOT restore into prod with pg_restore — use PITR)
gpg --decrypt "/tmp/leanshot-snapshot-${TS}.dump.gpg" > /tmp/restore.dump

PGPASSWORD="$PG_PASSWORD" pg_restore \
  --dbname "postgresql://postgres.<NEW_REF>@..." \
  --no-owner --no-acl --clean --if-exists \
  /tmp/restore.dump
```

> **`pg_restore` does NOT recreate Supabase-managed extensions** (PostGIS, pgsodium, pg_cron, etc.). After restore, manually re-enable from Supabase Studio → Database → Extensions. The dump preserves your schema/data; the extension wiring lives outside the dump.

### Snapshot retention

- Hot (S3/Backblaze): last 30 days, 1 per day.
- Cold (S3 Glacier / Backblaze archive): 1 per month for 7 years (HIPAA medical record retention).
- Audit log row per snapshot creation + deletion.

---

## Tier 3: Storage Bucket Restore

Supabase Storage buckets (photos, exports, branding assets) are NOT covered by PITR.

### Buckets to back up

| Bucket | Contents | Public? | Priority |
|--------|----------|---------|----------|
| `photos` | User progress photos | No (signed-URL only) | **CRITICAL** (PHI-adjacent) |
| `exports` | User-generated PDF/CSV exports | No | Medium |
| `branding` | Logos, social cards | Yes | Low |
| `videos` (if Mux not used) | Coach videos | No | Medium |
| `attachments` | Misc support uploads | No | Medium |

### Snapshot a bucket

```bash
# Requires: supabase CLI + curl + jq
PROJECT_REF=ytnsipxxmzgaebkqmokp
BUCKET=photos
TS=$(date -u +%Y%m%dT%H%M%SZ)
DEST="/tmp/bucket-${BUCKET}-${TS}/"
mkdir -p "$DEST"

# List all objects
curl -s "https://${PROJECT_REF}.supabase.co/storage/v1/object/list/${BUCKET}" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"limit":1000,"offset":0}' > "${DEST}/manifest.json"

# Download each file
jq -r '.[].name' "${DEST}/manifest.json" | while read -r path; do
  mkdir -p "${DEST}$(dirname "$path")"
  curl -s -o "${DEST}${path}" \
       "https://${PROJECT_REF}.supabase.co/storage/v1/object/${BUCKET}/${path}" \
       -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
done

# Encrypt + upload to cold storage
tar -czf "${DEST}.tar.gz" -C "$(dirname "$DEST")" "$(basename "$DEST")"
gpg --symmetric --cipher-algo AES256 "${DEST}.tar.gz"
# Copy .gpg to cold storage
```

### Restore a bucket

```bash
gpg --decrypt "${DEST}.tar.gz.gpg" | tar -xz -C /tmp
cd "/tmp/bucket-${BUCKET}-${TS}"

find . -type f -not -name manifest.json | while read -r path; do
  REL="${path#./}"
  curl -X POST "https://${PROJECT_REF}.supabase.co/storage/v1/object/${BUCKET}/${REL}" \
       -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
       --data-binary "@${path}"
done
```

> Storage object metadata (created_at, owner) is NOT preserved by this flow. If metadata matters, also dump `storage.objects` rows from Postgres (covered by Tier 1/2).

---

## Verification Checklist (post-restore)

After any restore, verify ALL of:

- [ ] **Row counts** match the expected magnitude:
  ```sql
  SELECT 'users' AS t, count(*) FROM auth.users
  UNION ALL SELECT 'profiles', count(*) FROM public.profiles
  UNION ALL SELECT 'injections', count(*) FROM public.injections
  UNION ALL SELECT 'weights', count(*) FROM public.weight_logs
  UNION ALL SELECT 'subscriptions', count(*) FROM public.subscriptions;
  ```
  Compare against pre-incident PostHog daily-active counts.
- [ ] **RLS policies present**:
  ```sql
  SELECT schemaname, tablename, count(*) FROM pg_policies
   WHERE schemaname='public' GROUP BY 1,2 ORDER BY 1,2;
  ```
  Compare against `git ls-files leanshot/supabase/migrations/ | xargs grep -l 'CREATE POLICY'` to confirm none missing.
- [ ] **Foreign keys valid**:
  ```sql
  SELECT conname, conrelid::regclass FROM pg_constraint WHERE contype='f' AND NOT convalidated;
  ```
  Expect empty.
- [ ] **Sequences caught up** (PITR sometimes leaves sequences behind their max):
  ```sql
  SELECT setval(pg_get_serial_sequence(c.oid::regclass::text, a.attname),
                (SELECT max(<pk>) FROM <table>))
   FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE ...;
  -- Or run scripts/db/reset-sequences.sql
  ```
- [ ] **Recent commits visible**: `SELECT * FROM ops_audit_log ORDER BY ts DESC LIMIT 10;` — confirm latest entry pre-incident is present.
- [ ] **Auth works**: log in as a real user via incognito browser → verify dashboard loads, dose log writes succeed.
- [ ] **Stripe sync**: open Stripe Dashboard → pick one recent subscription → confirm `public.subscriptions` row matches.
- [ ] **Edge Fn smoke**: `curl -X POST .../functions/v1/healthz` returns 200.
- [ ] **PostHog events flowing**: open https://us.posthog.com → Activity → confirm events arriving within last 5 min.

---

## Restore Drill (HIPAA §164.308(a)(7)(ii)(D))

> **Required: ONE drill per calendar year minimum.** Bake into v1.4 launch checklist + annual calendar review.

### Drill procedure

**Phase 1: Plan**
1. Schedule a 2-hour window (low-traffic — Sunday 02:00-04:00 UTC).
2. Inform team via Slack 7 days ahead.
3. Pick a target restore timestamp (24h ago).

**Phase 2: Execute (in a NEW project — never on prod)**
1. Create a fresh Supabase project (`leanshot-restore-drill-<date>`).
2. PITR-restore into the fresh project, targeting the chosen timestamp.
3. Apply Verification Checklist (above).
4. Time-record each step. RTO target: 30 min.

**Phase 3: Validate functional end-to-end**
1. Point a local copy of the SPA at the restored project (`VITE_SUPABASE_URL` override).
2. Sign in as a test user → check dose log, AI coach, photo upload work.
3. Sign up as a new user → verify the auth + onboarding flow on restored state.
4. Run `scripts/db/smoke-rls.ts` against restored project.

**Phase 4: Document**
1. Record drill in `ops_audit_log`:
   ```sql
   INSERT INTO ops_audit_log (event, ts, actor, notes)
   VALUES ('hipaa_restore_drill', now(), '<email>',
           'RTO=<X>min; RPO=<Y>min; verification all-pass; restored project deleted at <ts>');
   ```
2. Update `.planning/runbooks/restore-drill-history.md` (create on first drill).
3. **Delete the restore-drill project** within 24h (data minimization).

**Phase 5: Postmortem (drill-only)**
1. What worked.
2. What didn't.
3. What slowed RTO.
4. Action items to improve next year.

### Failure modes seen in past drills (populate as drills run)

- _(empty — first drill at launch will populate)_

---

## Disaster Scenarios

### Scenario A: Supabase region outage

**Symptom.** us-east-1 down; DB unreachable for >30 min.

**Plan.**
1. Wait — Supabase usually restores within 1h.
2. Status page: "Provider outage; tracking https://status.supabase.com".
3. If >2h: consider hot-spinning a recovery project in us-west-2 from latest `pg_dump` snapshot (RTO 2-4 hours). Requires DNS + env-var swap.
4. Acknowledge: writes during outage are LOST without local-first client-side queue (architecturally, LeanShot is local-first per CLAUDE.md, so client retains state; only sync is blocked).

### Scenario B: Operator deletes prod by mistake

**Symptom.** `DROP TABLE injections;` ran without `BEGIN; ... ROLLBACK;` guard.

**Plan.**
1. **Don't write more data** — back away from the keyboard.
2. PITR restore targeting "30 seconds before the DROP".
3. Tier-1 procedure.

### Scenario C: Ransomware / extortion (encrypted DB)

**Symptom.** Tables visible but rows replaced with garbage; ransom note.

**Plan.**
1. **Do NOT pay.** Treat as P1 + HIPAA breach (PHI access by unauthorized party).
2. Rotate ALL secrets (see `secrets-rotation.md` emergency flow).
3. PITR restore to BEFORE encryption event.
4. Notify HHS within 60 days per §164.404.
5. Forensics: pull auth + RLS-bypass logs from Sentry / Supabase audit logs.

### Scenario D: Supabase account compromise

**Symptom.** Unauthorized login to Studio; DB password rotated by attacker.

**Plan.**
1. Email security@supabase.com IMMEDIATELY — they can lock the project.
2. While locked, prepare new project + recent `pg_dump` snapshot for failover.
3. Once recovered: rotate ALL secrets, audit access logs, audit DB password rotation events.

---

## Tooling References

- **Supabase PITR docs**: https://supabase.com/docs/guides/platform/backups
- **Supabase CLI db dump**: https://supabase.com/docs/reference/cli/supabase-db-dump
- **`pg_dump` / `pg_restore` reference**: https://www.postgresql.org/docs/current/app-pgdump.html
- **HIPAA §164.308(a)(7)** full text: https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/

---

## Lessons learned

- `[[reference_supabase_back_dated_migration_blocks_push]]` — after restore, new migrations dated BEFORE the restored state's latest applied get rejected; rename migrations forward before re-push.
- `[[feedback_phase_close_out_supabase_gotchas]]` — `CREATE POLICY IF NOT EXISTS` is unsupported on remote PG; use bare `CREATE POLICY` after restore.
- `[[feedback_fn_deploy_before_cron_db_push]]` — redeploy Edge Fns BEFORE re-enabling cron after restore; else cron fires to non-existent endpoints.
