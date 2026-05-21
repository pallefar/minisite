# Phase 35 Deploy Notes (operator runbook)

> Generated: 2026-05-21 by Plan 35-10 Task 3

---

## 1. Vault Secrets (Supabase Dashboard → Database → SQL Editor)

Run AFTER `supabase db push --linked` completes. The remote has the Phase 35 migrations applied.

```sql
-- a) share_token_secret (Plan 35-07 OG share-card HMAC; 32+ bytes random hex)
-- STATUS: MISSING as of 2026-05-21 — operator MUST insert before OG share cards work
select vault.create_secret(
  '<generate-via-openssl-rand-hex-32>',
  'share_token_secret',
  'Phase 35 share-token signing (HMAC-SHA256)'
);

-- b) service_role_key (Plan 35-09 challenge-evaluate-cron + existing Phase 19 ship)
-- STATUS: PRESENT as of 2026-05-21 verification — no action needed unless rotated
-- Verify it exists:
select name from vault.secrets where name = 'service_role_key';
-- If missing, get the sb_secret_* token from Supabase Dashboard → API → Service Role Key, then:
select vault.create_secret('<sb_secret_*-token>', 'service_role_key');
```

**Generate share_token_secret value:**

```bash
openssl rand -hex 32
```

**CRITICAL:** the share_token_secret value MUST match the Vercel env var SHARE_TOKEN_SECRET (next step).

---

## 2. Vercel Env Var (CLI from leanshot/ directory)

```bash
cd /Users/karstenhaldan/minisite/leanshot
echo '<same-value-as-share_token_secret-vault>' | vercel env add SHARE_TOKEN_SECRET production
```

(Per memory reference_vercel_project — project: leanshot-marketing, prj_vUAbx6chhVpKWnAT9IBFWOLhnYbc.)

After adding, redeploy: `vercel --prod` from leanshot/ (or push to main which triggers auto-deploy).

To verify the env var was added:

```bash
cd /Users/karstenhaldan/minisite/leanshot && vercel env ls production | grep SHARE_TOKEN_SECRET
```

Expected: 1 row. This is Signal 2 for the HUMAN-UAT checkpoint.

---

## 3. Manual Social-Validator Probes (HUMAN gate — Task 4 checkpoint Signal 3-5)

After Vercel deploy lands:

1. Mint a sample share token via the SPA: log in as a test user with level >= 5; click "Share level" in LevelUpBurst; copy the share URL.
2. **Twitter Card Validator:** https://cards-dev.twitter.com/validator — paste URL — expect 1200x630 PNG card preview + title "Reached Level N on LeanShot" + summary_large_image type.
3. **LinkedIn Post Inspector:** https://www.linkedin.com/post-inspector/ — paste URL — expect same 1200x630 preview + title + description.
4. **Instagram DM preview:** iOS or Android device. Open Instagram mobile app → DM → paste share URL → expect preview card render.

Record screenshots in `35-CHECKPOINT-NOTES.md` (operator-created) for milestone close.

---

## 4. Notification Copy Review (HUMAN gate — Task 4 checkpoint Signal 6)

Read the 3 notification templates in `supabase/functions/lifecycle-behavior-triggered/templates.ts`:

1. **streak_warn** — should be friendly, no urgency-escalation, no FOMO.
2. **challenge_kickoff** — neutral framing. Example acceptable: "This week's challenge: <admin-typed framing>."
3. **challenge_nudge** — supportive, not nagging.

Confirm NO: "URGENT", "BREAKING", "LAST CHANCE", "DON'T LOSE", "ONLY N HOURS LEFT", shame-driven language, urgency timers.

Resume signal: `copy-ok` (or `copy-needs-revision: <specific concern>`).

---

## 5. ROADMAP Update

`.planning/ROADMAP.md` Phase 35 entry: change `- [ ]` plan lines to `- [x]` once gsd-verify-work passes the full phase. The high-level Phase 35 checkbox in the index (line 54) should flip when plans 35-01 through 35-10 are all marked shipped.

---

## 6. Post-Ship Audit Cadence

- **Quarterly:** review every enabled cohort against `runbooks/leaderboard-cohort-criteria.md`
- **Monthly:** check `cron.job_run_details` for cron failures (4 new Phase 35 crons)
- **Monthly:** check `email_send_counters` for keys with `value >= 2` (would indicate notification multi-fire — should be 0)
- **On deploy:** run `cd leanshot && bash scripts/assert-bundle-budget.sh` to confirm gamification-burst remains within 8 kB gz ceiling

---

## 7. Rollback Procedure

If a critical bug surfaces post-deploy:

- **Schema rollback:** NOT supported — append-only tables retain history; disable triggers to halt XP grants:
  ```sql
  alter trigger trg_p35_xp_on_injection disable on public.injections;
  alter trigger trg_p35_xp_on_weight disable on public.weight_logs;
  alter trigger trg_p35_xp_on_symptom disable on public.symptom_logs;
  alter trigger trg_p35_xp_on_workout disable on public.workouts;
  ```
- **Notification rollback:** unschedule cron:
  ```sql
  select cron.unschedule('phase35-streak-evaluate-hourly');
  select cron.unschedule('phase35-challenge-evaluate-hourly');
  ```
- **Bundle rollback:** revert leanshot/ commits + redeploy via `vercel --prod`
- **OG share card rollback:** disable rewrites in vercel.json (revert the /api/og and /share/level carve-out lines)

---

## 8. Vault Access & Emergency Share-Token Secret Rotation

### Vault Access (REVIEW-B-3 — required for Task 1 verifications)

`supabase db query --linked` against `vault.decrypted_secrets` or `vault.secrets` requires the
`SUPABASE_ACCESS_TOKEN` env var to be a **personal access token (PAT)** with project-owner
role — NOT a service-role JWT. Under service-role, the query may return zero rows even when
secrets exist (role visibility quirk in the vault schema). Use a PAT for any vault verification
step. The PAT is generated at https://supabase.com/dashboard/account/tokens; revoke after the
deploy window per memory `feedback_bootstrap_token_revoke_pattern`.

### Emergency Share-Token Secret Rotation (REVIEW-F-6)

If `share_token_secret` is ever exposed (e.g., leaked via Vercel env-var logs, source-control
slip, accidental Slack paste), rotate immediately. The 30-day token TTL bounds blast radius
but mid-leak windows still expose unbounded share-URL generation. Procedure:

1. **Generate new key:**
   ```bash
   NEW_SECRET=$(openssl rand -hex 32)
   ```

2. **Update Supabase vault:**
   ```sql
   -- In Supabase Dashboard SQL Editor:
   select vault.update_secret(
     (select id from vault.secrets where name='share_token_secret'),
     '<new-secret-value>'
   );
   ```

3. **Update Vercel env var (must match exactly):**
   ```bash
   cd /Users/karstenhaldan/minisite/leanshot
   vercel env rm SHARE_TOKEN_SECRET production --yes
   echo "$NEW_SECRET" | vercel env add SHARE_TOKEN_SECRET production
   ```

4. **Redeploy Vercel production:**
   ```bash
   vercel --prod
   ```

5. **User communication template** (post in #status or email opted-in users):
   > "We rotated a sharing-secret as a precaution. Any LeanShot level-up share links generated
   > before <ISO-timestamp> will no longer load. Generate a new share link from your dashboard
   > if you need to re-share. No personal data was exposed; this is preventive maintenance."

6. **Audit:** verify mint/verify HMAC round-trip:
   ```bash
   cd /Users/karstenhaldan/minisite/leanshot && npx playwright test e2e/35-og-share-card.spec.ts
   ```

After rotation, revoke the PAT used for step 2 if it was minted just for this operation.

---

## 9. Phase 35 Verification Summary (Task 1 results — 2026-05-21)

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Phase 35 cron jobs | 4 | 4 | PASS |
| phase35-streak-evaluate-hourly schedule | `5 * * * *` | `5 * * * *` | PASS |
| phase35-freeze-monthly-grant schedule | `15 0 1 * *` | `15 0 1 * *` | PASS |
| phase35-leaderboard-refresh schedule | `12,27,42,57 * * * *` | `12,27,42,57 * * * *` | PASS |
| phase35-challenge-evaluate-hourly schedule | `22 * * * *` | `22 * * * *` | PASS |
| leaderboard_matview UNIQUE INDEX | present | present | PASS |
| weekly_challenges.status CHECK | 4 values (draft/active/completed/archived) | 4 values | PASS |
| badge_catalog seed | 17 rows | 17 rows | PASS |
| vault.share_token_secret | PRESENT | MISSING | **OPERATOR ACTION REQUIRED** |
| vault.service_role_key | PRESENT | PRESENT | PASS |
| trg_p35_xp_on_injection | present | present | PASS |
| trg_p35_xp_on_weight | present | present | PASS |
| trg_p35_xp_on_symptom | present | present | PASS |
| trg_p35_xp_on_workout | present | present | PASS |
| trg_p35_combo_badge_check | present | present | PASS |
| trg_p35_challenge_progress_no_uncomplete | present | present | BONUS (not planned) |
| trg_p35_lb_prefs_monotonic | present | present | BONUS (not planned) |

**BLOCKER:** `vault.share_token_secret` is MISSING. OG share card functionality requires this secret. Operator must insert via SQL Editor before Signal 1 can be approved.
