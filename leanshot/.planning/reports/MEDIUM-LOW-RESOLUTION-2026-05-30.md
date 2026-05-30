# LeanShot — Medium/Low Findings Resolution

**Date:** 2026-05-30 · Follow-up to `RELEASE-READINESS-REVIEW` + `HIGH-BLOCKERS-RESOLUTION`.
**Scope:** the 29 medium/low report-only findings (13 frontend + 16 Edge/SQL).

> Frontend fixes are typecheck + lint + build + test validated. Edge-Function/SQL
> findings are **reported only** (deploy-validated, not frontend-gateable).
> No commits/push/deploy — working tree only, reversible.

## ✅ Applied (6 frontend — gate-validated)

| # | Fix | File |
|---|-----|------|
| F7 | Audit-log pagination uses a composite keyset (`created_at`+`id`) so rows sharing a timestamp aren't dropped across pages | `AuditLogModule.tsx` |
| F8 | Gamification dashboard throws on RPC error instead of rendering misleading zeros (caller already `.catch()`es) | `lib/gamification/dashboard-data.ts` |
| F9 | `track-rec-click` resolves the real `access_token` via `getSession()` instead of sending raw session JSON (was always 401) | `kb/RelatedArticlesFooter.tsx` |
| F10 | Consent-records audit logs `error.code`/`err.name`, not `error.message`/raw error (S3 PII pattern) | `lib/consent/consent-records.ts` |
| F12 | Protocol-adherence % denominator restricted to the scorable population (mg dose mapped to a protocol step) | `dashboard/tabs/BodyTab.tsx` |
| F3 | **Brute-force lockout wired in** — `SignInForm` standard sign-in now routes through `signInWithLockout` + renders `SignInLockoutBanner` on lockout. Open-on-fail (login never hard-depends on the rate-limit Fn). Validated: SignInForm test 4/4 | `auth/SignInForm.tsx` |

## 📋 Frontend — reported, NOT auto-applied (7, with rationale)

- **F1 `lib/rag/sanitize.ts` (medium):** DOMPurify runs on raw *markdown*, garbling article text. Both render sites use ReactMarkdown **without** `rehype-raw` (HTML already escaped), so the pre-pass is redundant + harmful. **Why not auto-applied:** it's the labeled XSS mitigation (`T-62-06-01`) and dropping it also loses the link-hardening (`target=_blank`/`rel=noopener`/non-http href strip). Correct fix = drop the markdown pre-pass *and* re-add link hardening via a ReactMarkdown `components`/rehype plugin — a sanitization-strategy decision for the team.
- **F2 `lib/sync-defer.ts` (medium):** `pullAndSubscribeAll` is never called → cross-device down-sync + Realtime for 9/11 tables are dead. **Why not:** enabling dormant sync infrastructure at a launch gate is behaviorally risky (down-sync drop/merge bugs) and the finding itself notes a prerequisite carry-over. Needs a deliberate sync-enable plan + e2e.
- **F4 `healthkit/HealthKitSettingsSection.tsx` (medium):** revoked HealthKit state collapses to 'not-connected' on reload, hiding the purge button. **Why not:** needs a DB column/state distinction (`revoked_at`) — a schema-aware change.
- **F5 `ads/AdRenderer.tsx` (medium):** freq-cap counter incremented as a render side-effect (StrictMode double-counts). **Why not:** correct fix needs splitting `canShowNextImpression` into peek/consume + a ref-guarded `useEffect`, but AdRenderer early-returns before any hook — requires a hook-order restructure. Current behavior over-counts (shows *fewer* ads), so it fails safe.
- **F6 `admin/.../RoutingRulesPage.tsx` (low):** derives role/org from an arbitrary `org_members` row. **Why not:** needs the active-org context plumbed from the admin layout.
- **F11 `lib/onboarding/activation-hooks.ts` (low):** `fireActivation` always returns `{activated:true}`. **Why not:** cosmetic — its only caller (`FirstActionSurface`) ignores the return value.
- **F13 `dashboard/settings/SettingsPage.tsx` (low):** profile draft seeded once, never re-synced. **Why not:** low value (page remounts on user switch) and a naive resync would wipe in-progress edits; correct version keys on `u?.id`.

## 📋 Edge-Function / SQL — reported (16; need `deno check` / `db push` + CI suite)

Medium: E1 `helpdesk-sla-breach-cron` (profiles.email), E2 `_shared/slack-guardrail-alert` (`.from('vault.decrypted_secrets')` invalid → Slack alerts disabled), E5 `admin-impersonate` (TTL client-only), E8 `rag-federated-fda/client` (OpenFDA `+` double-encode), E9 `claude-moderation` (zero real test coverage), E10 `org-metered-billing-cron` (no bearer check), E11 migration `20281201000020` (`list_federated_sources()` SECDEF bypasses staff RLS).
Low: E3 `admin-stripe-action` (charge/sub not verified vs target user), E4 `stripe-dunning-orchestrator` + E7 `rag-summarize-and-chunk` (empty service-role key fails open), E6 `auth-rate-limit-check` (15m vs 30m mismatch), E12 `_shared/digest-schema` (`\bdiagnos\b` regex), E13 `_shared/anthropic-summarize` (BAA-403 retried), E14 `org-metered-billing-cron` (no bearer), E15 `affiliate-lifetime-recurring` (non-atomic insert), E16 `challenge-evaluate-cron` (rpc `{error}` counted as success).

> Note: E4/E7 (auth fails open on empty service-role key) and E2 (Slack guardrail disabled) are the highest-value of the Edge set — worth prioritizing in the Edge-Function pass.
