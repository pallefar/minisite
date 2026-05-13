---
phase: 12-bootstrap-bundle-foundations
plan: "05"
subsystem: vendor-accounts
tags: [dns, resend, vendor-accounts, credentials, human-action, checkpoint]
requires: [12-04-SUMMARY.md]
provides: [resend-domain-proof.json, PROJECT.md vendor-accounts table, 12-CONTEXT.md Phase 12 close addendum]
affects: [PROJECT.md, 12-CONTEXT.md, 12-VALIDATION.md, 12-05-PLAN.md]
tech-stack:
  added: []
  patterns: [Resend SPF/DKIM/DMARC verification, vendor credential capture via Vercel env + Supabase Function secrets, D-06 naming convention]
key-files:
  created:
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-05-SUMMARY.md
  modified:
    - leanshot/.planning/PROJECT.md
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md
    - leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-VALIDATION.md
decisions:
  - "Resend domain proof JSON committed as scaffold (pending-verification) to lock the file path and structure; replaced with real API response after DNS propagation + verification"
  - "12-05-01..05 rows marked ⚠️ pending (not ⬜ pending) to distinguish 'needs user action' from 'not yet started'"
  - "12-05-06 (PROJECT.md checklist) flipped to ✅ green — automated portion of Task 3 completed"
  - "Phase 12 stays in closing status; Phase 13 unblocked per D-05"
  - "nyquist_compliant: false retained — plan cannot be compliant until all vendor rows resolve to ✅ green"
metrics:
  duration: "~20 min (automated scaffold work)"
  completed: "2026-05-13"
  tasks_completed: "1 of 3 (Tasks 1 + 2 partial + Task 3 automated; halted at multi-vendor checkpoint)"
  files_modified: 4
  files_created: 2
---

# Phase 12 Plan 05: Vendor Accounts Provisioning + Resend Domain Verification Summary

**One-liner:** Vendor accounts scaffold committed (PROJECT.md 6-vendor table, resend-domain-proof.json structure, 12-CONTEXT.md Phase 12 addendum); all 4 vendor actions consolidated as single checkpoint — user must provision Resend DNS, Apple Dev, Play Console, Stripe Connect Express out-of-band.

---

## Automated Work Completed

### Task 1 (partial): Resend domain proof scaffold

- `resend-domain-proof.json` created as a scaffold at `.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json`.
  - Contains DNS record types, expected values, and the exact curl commands to run after DNS propagates.
  - **NOT yet populated with the real Resend API response** — status is `pending-verification`.
  - Replace with real response AFTER `app.leanshot.app` shows `status: "verified"` from `api.resend.com/domains`.

### Task 3 (complete): PROJECT.md + 12-CONTEXT.md + 12-VALIDATION.md updates

- `PROJECT.md` now has a `## Vendor Accounts` section listing 6 vendors with credential names, storage location, status, and notes.
- `12-CONTEXT.md` now has a `## Phase 12 close addendum (Wave 2 outcomes)` section documenting all pending vendor actions and the Phase 13 parallel-unblocking decision per D-05.
- `12-VALIDATION.md` rows 12-05-01..06 updated:
  - 12-05-01 → `⚠️ pending` (Resend DNS not published yet; submit date 2026-05-13)
  - 12-05-02 → `⚠️ pending` (real email depends on 12-05-01)
  - 12-05-03 → `⚠️ pending` (Apple Dev enrollment not submitted)
  - 12-05-04 → `⚠️ pending` (Play Console registration not completed)
  - 12-05-05 → `⚠️ pending` (Stripe Connect Express not activated)
  - 12-05-06 → `✅ green` (PROJECT.md vendor table committed)

---

## Consolidated Vendor Action Checklist

All four vendor actions below must be completed out-of-band. Each has its own resume signal.

---

### Action 1: Resend domain verification for `app.leanshot.app`

**Resume signal:** `resend-done`

**Why needed:** Phase 12 SC-4 part 2. Phase 9 wired Resend with `RESEND_FROM=LeanShot <noreply@app.leanshot.app>` but the domain was NEVER verified (sandbox `onboarding@resend.dev` was used as fallback). All production lifecycle emails (clinic-invite, password reset, welcome series) will go to spam or be rejected without SPF/DKIM/DMARC.

**Step 1 — Add domain to Resend (if not already added):**
```bash
export RESEND_API_KEY=<your-key>   # from: supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep RESEND_API_KEY

# Check if already added
curl -s -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains | python3 -m json.tool

# If NOT in list, add it:
curl -s -X POST https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "app.leanshot.app", "region": "us-east-1"}'

# Capture the domain ID:
DOMAIN_ID=$(curl -s https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -c "import json,sys; domains=json.load(sys.stdin)['data']; print(next(d['id'] for d in domains if d['name']=='app.leanshot.app'))")
echo "DOMAIN_ID: $DOMAIN_ID"
```

**Step 2 — Get the exact DNS records Resend requires:**
```bash
curl -s "https://api.resend.com/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -m json.tool
```
The response will contain `records[]` — note the exact `name` and `value` for each DKIM CNAME selector (there may be multiple). Use these EXACT values at the registrar.

**Step 3 — Publish DNS records at registrar for `leanshot.app`:**

| Type | Name (host) | Value |
|------|-------------|-------|
| TXT | `app` (or `app.leanshot.app`) | `v=spf1 include:amazonses.com ~all` |
| CNAME | `resend._domainkey.app` | `<Resend-provided target from records[].value>` |
| TXT | `_dmarc.app` | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@leanshot.app; ruf=mailto:dmarc-reports@leanshot.app; fo=1` |

> **Note on DMARC report address:** `dmarc-reports@leanshot.app` must be a deliverable address. If your registrar does not support catch-all forwarding, change `rua` and `ruf` to `karsten.haldan@gmail.com` or another real address you own. Document the choice.
>
> **DMARC policy note (D-17):** `p=quarantine` is the correct Phase 12 value. Do NOT use `p=reject` yet — DMARC aggregate reports need 30 days of monitoring before tightening. `p=reject` is the Phase 22 entry condition.

**Step 4 — Wait for DNS propagation, then trigger verification:**
```bash
# Check propagation (wait until all return expected values)
dig TXT app.leanshot.app +short
dig CNAME resend._domainkey.app.leanshot.app +short  # or whichever selector Resend uses
dig TXT _dmarc.app.leanshot.app +short

# Trigger Resend verification
curl -s -X POST "https://api.resend.com/domains/$DOMAIN_ID/verify" \
  -H "Authorization: Bearer $RESEND_API_KEY"

# Poll status
curl -s "https://api.resend.com/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('status:', d.get('status'), '|', [(r.get('record'), r.get('status')) for r in d.get('records', [])])"
```
Wait until top-level `status == "verified"`.

**Step 5 — Capture proof JSON:**
```bash
curl -s "https://api.resend.com/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -m json.tool > leanshot/.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json

# Verify the file is good before committing
python3 -c "import json,sys; d=json.load(open('leanshot/.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json')); assert d.get('status') == 'verified', f'expected verified, got {d.get(\"status\")}'; print('OK:', d.get('name'), 'is', d.get('status'))"
```

**Step 6 — Send real lifecycle email to inbox:**
```bash
curl -s https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "LeanShot <noreply@app.leanshot.app>",
    "to": ["karsten.haldan@gmail.com"],
    "reply_to": "support@leanshot.app",
    "subject": "Phase 12 SC-4 — domain verification proof (v1.2 milestone)",
    "html": "<p>This email proves <strong>app.leanshot.app</strong> SPF/DKIM/DMARC is verified end-to-end via Resend. Phase 12 SC-4 part 2.</p><p>Subdomain pattern locked per Phase 12 CONTEXT.md D-16. DMARC policy is <code>p=quarantine</code> initially per D-17; tightened to <code>p=reject</code> at Phase 22 close.</p>"
  }'
```
Capture the message `id` from the response. Create `resend-real-email-proof.txt` with:
```
Resend message-ID: <id from API response>
Sent at: 2026-05-13 (or actual date)
From: LeanShot <noreply@app.leanshot.app>
To: karsten.haldan@gmail.com
Inbox confirmation: [yes — arrived in inbox, not spam]
```

**Step 7 — Confirm RESEND_FROM secret is set correctly:**
```bash
supabase secrets set --project-ref ytnsipxxmzgaebkqmokp RESEND_FROM="LeanShot <noreply@app.leanshot.app>"
```

**Verification (must pass before signaling `resend-done`):**
```bash
# 1. Proof JSON has verified status
python3 -c "import json; d=json.load(open('leanshot/.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json')); assert d.get('status')=='verified'; print('OK')"
# 2. SPF in DNS
dig TXT app.leanshot.app +short | grep -c 'v=spf1'
# 3. DMARC in DNS
dig TXT _dmarc.app.leanshot.app +short | grep -c 'p=quarantine'
# 4. Secrets present
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -cE '^RESEND_(API_KEY|FROM)'
```

---

### Action 2: Apple Developer Program enrollment

**Resume signal:** `apple-done` (or `apple-pending <ETA>` if review is still in flight)

**Why needed:** Phase 16 (Capacitor iOS shell + TestFlight) entry condition per D-05. Without `APPLE_TEAM_ID`, Xcode cannot build or sign the app for device testing.

**Steps:**
1. Visit https://developer.apple.com/account — check if enrollment is already active.
2. If not enrolled → https://developer.apple.com/programs/ → Enroll ($99/yr). Identity verification may take 24-48h.
3. After enrollment is active → capture `APPLE_TEAM_ID` from Membership tab (10-character alphanumeric string).
4. Decide on `APPLE_BUNDLE_ID` (suggested: `app.leanshot.ios`) and reserve it at App Store Connect.
5. Capture to Vercel env:
   ```bash
   cd leanshot
   vercel env add APPLE_TEAM_ID production   # enter value when prompted
   vercel env add APPLE_BUNDLE_ID production  # enter value when prompted
   ```
6. Verify: `vercel env ls | grep -E '^(APPLE_TEAM_ID|APPLE_BUNDLE_ID)'` returns 2 lines.

**If Apple review is still pending when you signal `apple-pending <ETA>`:** document the enrollment-submit date and estimated review completion date. Phase 12 VALIDATION row 12-05-03 stays at `⚠️ pending`; Phase 13 is unblocked and continues in parallel per D-05.

---

### Action 3: Google Play Console registration

**Resume signal:** `play-done`

**Why needed:** Phase 16 (Capacitor Android shell, signed AAB, Play Store internal testing) entry condition per D-05.

**Steps:**
1. Visit https://play.google.com/console → Register account ($25 one-time). Identity verification is typically instant after payment.
2. Reserve package name `app.leanshot.android` (or chosen alternative).
3. Create a Google Cloud service account for the Play Developer API:
   - GCP Console → IAM & Admin → Service Accounts → Create Service Account
   - Grant `Service Account User` role for the Play Developer API project
   - Create key → JSON → download to a secure local path
4. Capture to Vercel env + Supabase secrets:
   ```bash
   cd leanshot
   vercel env add PLAY_PACKAGE_NAME production   # enter app.leanshot.android
   # CRITICAL: DO NOT echo the JSON to stdout — use file input
   supabase secrets set --project-ref ytnsipxxmzgaebkqmokp PLAY_SERVICE_ACCOUNT_JSON="$(cat /path/to/service-account.json)"
   ```
5. **SECURITY: After capturing to Supabase secret, securely delete the local JSON file:**
   ```bash
   rm -P /path/to/service-account.json  # macOS secure delete; or shred -u on Linux
   ```
6. Verify: `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -c '^PLAY_SERVICE_ACCOUNT_JSON'` returns 1.
7. Verify no JSON leaked: `find /Users/karstenhaldan/minisite -name '*service-account*.json' -not -path '*/node_modules/*'` returns 0 results.

---

### Action 4: Stripe Connect Express activation

**Resume signal:** `stripe-done` (or `stripe-pending <ETA>` if approval is still in flight)

**Why needed:** Phase 14 (Stripe Checkout + Customer Portal + clinic metered billing) and Phase 19 (affiliate Connect Express + W-9/W-8BEN/1099-NEC) entry condition per D-05.

**Steps:**
1. Visit https://dashboard.stripe.com → Developers → API keys → copy TEST key values (ensure "Test mode" toggle is ON).
   - `STRIPE_SECRET_KEY` starts with `sk_test_`
   - `STRIPE_PUBLISHABLE_KEY` starts with `pk_test_`
2. Visit https://dashboard.stripe.com/connect → Get started → Select **Express** → Complete platform activation. Stripe approval is typically 1-2 business days.
3. Once Connect Express is approved → Dashboard → Connect → Settings → Client ID (starts `ca_`).
4. Capture all three to Vercel env AND secret key also to Supabase:
   ```bash
   cd leanshot
   vercel env add STRIPE_SECRET_KEY production       # sk_test_... (TEST mode — DO NOT use sk_live_ in Phase 12)
   vercel env add STRIPE_PUBLISHABLE_KEY production  # pk_test_...
   vercel env add STRIPE_CONNECT_CLIENT_ID production # ca_...
   supabase secrets set --project-ref ytnsipxxmzgaebkqmokp STRIPE_SECRET_KEY="<sk_test_...>"
   ```
5. Verify Stripe TEST-mode safety (T-PAY-01):
   ```bash
   vercel env pull --environment production /tmp/env-check && grep '^STRIPE_SECRET_KEY=sk_test_' /tmp/env-check && rm /tmp/env-check
   echo "STRIPE_SECRET_KEY is TEST-mode - OK"
   ```
6. Verify all three in Vercel env: `vercel env ls | grep -cE '^(STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|STRIPE_CONNECT_CLIENT_ID)'` returns 3.

> **T-PAY-01 enforcement:** Phase 12 uses TEST keys exclusively. Phase 14 plan-checker contract verifies the live-key swap commit appears in Plan 14-XX, not earlier. NEVER set `sk_live_*` or `pk_live_*` in Phase 12.

---

## DNS Records Quick-Reference

For `app.leanshot.app` — publish at registrar for `leanshot.app`:

| Record type | Host/name | Value |
|-------------|-----------|-------|
| TXT (SPF) | `app` | `v=spf1 include:amazonses.com ~all` |
| CNAME (DKIM) | `resend._domainkey.app` | `<CNAME target from Resend dashboard — unique per account>` |
| TXT (DMARC) | `_dmarc.app` | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@leanshot.app; ruf=mailto:dmarc-reports@leanshot.app; fo=1` |

> DMARC note: `p=quarantine` is correct at Phase 12. Tighten to `p=reject` at Phase 22 close after 30-day aggregate report monitoring (Phase 22 entry condition per D-17).

---

## Resume Signal Mapping

| Signal | Triggers | VALIDATION rows updated |
|--------|----------|------------------------|
| `resend-done` | Resend domain verified + real email confirmed in inbox | 12-05-01 ✅, 12-05-02 ✅ |
| `apple-done` | APPLE_TEAM_ID + APPLE_BUNDLE_ID captured to Vercel env | 12-05-03 ✅ |
| `apple-pending <ETA>` | Enrollment submitted but review in flight | 12-05-03 ⚠️ (note updated with ETA) |
| `play-done` | PLAY_PACKAGE_NAME in Vercel env + PLAY_SERVICE_ACCOUNT_JSON in Supabase secrets | 12-05-04 ✅ |
| `stripe-done` | All 3 Stripe TEST keys captured + STRIPE_SECRET_KEY in Supabase secrets | 12-05-05 ✅ |
| `stripe-pending <ETA>` | Connect Express submitted but approval in flight | 12-05-05 ⚠️ (note updated with ETA) |
| `phase-12-credentials-done` | All 4 vendor actions done (or explicitly pending-with-ETA) | All 12-05-xx rows resolved; Phase 12 → `closed` |

---

## Phase 13 Unblocking Note

Per CONTEXT D-05: Phase 13 (Design System) is **unblocked now** and may start in parallel while vendor reviews are pending. No Phase 13-15 code depends on Apple Dev Program approval, Play Console registration, or Stripe Connect Express approval. Phase 12 stays in `closing` status until `phase-12-credentials-done` fires.

---

## Deviations from Plan

### Structural deviation: consolidated multi-vendor checkpoint (single-shot execution)

- **Type:** Execution strategy deviation (not a code deviation)
- **Rationale:** The `<parallel_execution>` instruction in the executor prompt explicitly says: "STRATEGY for this single-shot execution: Run all automated setup work FIRST, then HALT with `## CHECKPOINT REACHED` and surface ALL FOUR vendor actions as a single consolidated checklist." This was followed.
- **Impact:** User receives all 4 vendor action instructions in one message rather than 4 separate checkpoint pauses. Per-vendor `⚠️ pending` rows in VALIDATION.md allow each vendor to resolve independently.

---

## Known Stubs

1. `resend-domain-proof.json` — scaffold only; `status: "pending-verification"`. Replaced with real Resend API response after domain verification. **Required before 12-05-01 can flip to ✅ green.**
2. `resend-real-email-proof.txt` — does not yet exist. Created after real email lands in inbox. **Required before 12-05-02 can flip to ✅ green.**

---

## Threat Flags

No new threat surface introduced by this plan's automated work (PROJECT.md + VALIDATION.md + CONTEXT.md are planning artifacts only). The credential capture itself (Task 2) is a trust-boundary operation but all credentials land in Vercel env / Supabase Function secrets — never in git. See threat register in 12-05-PLAN.md for T-EMAIL-01, T-EMAIL-02, T-PAY-01, T-CRED-01, T-CRED-02.

---

## Self-Check: PASSED

- [x] `leanshot/.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json` — scaffold exists
- [x] `leanshot/.planning/PROJECT.md` — `## Vendor Accounts` section present with 6 vendor rows
- [x] `leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md` — `## Phase 12 close addendum` present, `resend-domain-proof.json` linked
- [x] `leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-VALIDATION.md` — rows 12-05-01..05 `⚠️ pending`, row 12-05-06 `✅ green`
- [x] `12-05-PLAN.md` `nyquist_compliant: false` retained (cannot flip to true until all vendor rows are ✅ green)
- [x] SUMMARY.md created with consolidated vendor checklist + resume signal mapping + Phase 13 unblocking note + DMARC D-17 tightening note
