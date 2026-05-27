# Phase 66: Consumer Account Security — Context

**Gathered:** 2026-05-27
**Status:** Ready for planning
**Mode:** Compressed-discuss (autonomous run; prescriptive requirements; reuses Phase 25 admin TOTP pattern)

## Phase Boundary

Ship consumer-facing MFA / TOTP self-serve + per-IP/per-email sign-in lockout with brute-force PostHog alerting. Closes research HD1 + HD2. Reuses Phase 25 admin SetupTotpPage / aal2-step-up patterns for consumer scope.

## Decisions

### D-01 — TOTP component reuse strategy
**Choice:** Extract Phase 25 `SetupTotpPage.tsx` into a shared `<TotpEnrollFlow>` component used by both admin (`/admin/security/totp`) and consumer (`/settings/security`) routes. Backup-codes flow + QR display + verify input are identical; only entry point + post-success redirect differ. Use a `mode: 'admin' | 'consumer'` prop for copy/CTA divergence.

### D-02 — AAL2 gate for consumer sensitive actions
**Choice:** Reuse `src/lib/admin/palette/aal2-step-up.ts` (exported `requireAal2Fresh`) for the 3 consumer actions: delete-account, export-all-data, change-email. Wrap each action's confirm-modal CTA. AAL2 freshness window: 15min (matches admin default). On stale-AAL2, present same `aal2-challenge` modal.

### D-03 — Lockout window + thresholds
**Choice:** 5 failed attempts within 15min from same IP OR same email → 30min lockout. Per-IP and per-email tracked separately (so 3 IPs each hitting 5×email-X doesn't lock the IPs but locks email-X). `auth_attempts_log` table keyed by (id, ts) with covering indexes on (ip, ts) + (email, ts). Successful sign-in clears the email's failure window.

### D-04 — Edge Fn placement vs middleware
**Choice:** Cannot proxy Supabase's `/auth/v1/token` endpoint (managed surface). Solution: client-side wrapper calls a new `auth-rate-limit-check` Edge Fn BEFORE `supabase.auth.signInWithPassword`. Fn checks `auth_attempts_log` + returns `allowed | locked` + lockout-until ts. Best-effort — sophisticated attackers can bypass by hitting Supabase directly, but for the launch-gate threat model this is acceptable; documented in 66-CARRY-OVER as PostHog-side monitoring backstop.

### D-05 — Brute-force alerting threshold
**Choice:** Two thresholds emit `auth_brute_force_detected` PostHog event + Slack webhook:
- 10 failures from same IP in 1h
- 20 failures from any IPs against same email in 1h
Higher than D-03 lockout thresholds (5 / 15min) — these are *escalation* signals, not user-protection signals. Tracked in same `auth_attempts_log`.

### D-06 — Per-role MFA-required config
**Choice:** New `mfa_role_requirements` table: `(role text PK, required boolean, since timestamptz)`. Admin UI at `/admin/users/security` toggles per-role. On sign-in, if user's role is in the required set AND `aal !== 'aal2'`, redirect to `/settings/security` for enrollment. Initial rows seeded: `superadmin=true`, `admin=true`, all others=false.

### D-07 — Backup codes
**Choice:** 10 single-use 8-char alphanumeric codes generated at enrollment, hashed (argon2id) in DB, plaintext shown ONCE in download-this-now banner. Reuse Phase 25 `src/lib/admin/backup-codes.ts` if it exists; consumer path uses same lib.

### D-08 — Deploy gating
**Choice:** Per Phase 65 precedent + autonomous-run policy — close-out partial. Code + tests ship to main; remote schema push + Edge Fn deploy deferred to Phase 70 UAT. Same `feedback_autonomous_false_close_out_partial_execution` pattern applies.

## Code Context

- **Reusable assets** (Phase 25, audited 2026-05-27):
  - `leanshot/src/components/admin/SetupTotpPage.tsx` — full TOTP enrollment flow (QR + verify + backup codes)
  - `leanshot/src/lib/admin/totp.ts` — Supabase Auth `mfa.enroll/challenge/verify` wrappers
  - `leanshot/src/lib/admin/palette/aal2-step-up.ts` — `requireAal2Fresh()` + `isAal2Fresh()` (NB: pre-existing test failures here — not Phase 66 regressions)
  - `supabase/migrations/20260601000001_audit_logs.sql` — `audit_logs` schema precedent
- **Existing types:** `leanshot/src/types/index.ts` has `UserRole` union — extend if new roles
- **PostHog client:** `leanshot/src/lib/posthog.ts` (or wherever `capture()` is) — use for `auth_brute_force_detected`
- **Slack webhook:** existing `_shared/slack-alert.ts` Edge helper (Phase 60.5)
- **CSP / cookie banner:** AUTH-16 already shipped in Phase 64

## Specific Ideas

- "Lockout" status surfaces in sign-in form as: *"Too many failed attempts. Try again in N minutes, or use a magic link."* Reuse Phase 64's magic-link path as the backup auth.
- Backup codes downloadable as TXT (no PDF — keep small).
- Admin user-detail badge: green "MFA on" / amber "MFA required, not enrolled" / grey "MFA off".

## Deferred Ideas

- Hardware key (WebAuthn) — TOTP-only for now. Note in CARRY-OVER for future enhancement.
- SMS fallback — known SIM-swap risk; reject.
- Captcha on sign-in — wait until post-launch traffic patterns to decide.
