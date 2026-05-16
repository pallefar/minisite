---
phase: 16-capacitor-mobile-shells-ios-android
addendum_for: 16-CONTEXT.md § D-17
supersedes: D-17 (single shared Sentry project)
date: 2026-05-16
trigger: Credential-wiring step under 16-09-CREDENTIALS-CHECKLIST.md Section D revealed Phase-1 leanshot Sentry project never existed; user opted to create three per-platform projects rather than retrofit one shared project.
---

# Addendum — Sentry per-platform projects (supersedes D-17)

## What changes

**Old (D-17, 2026-05-15):**
> Sentry coverage = Capacitor SDK + native Sentry Cocoa + native Sentry Android (max coverage). dSYM upload via Sentry CLI in fastlane. **Reuses existing Sentry project from Phase 1 with separate releases tagged `ios@<version>` / `android@<version>`.**

**New (this addendum, 2026-05-16):**
> Sentry coverage = unchanged (max coverage via @sentry/capacitor + native Cocoa + native Android). dSYM upload via Sentry CLI in fastlane — unchanged. **Three separate Sentry projects under org `optimizenet` on `de.sentry.io`: `leanshot-web` (javascript-react), `leanshot-ios` (apple-ios), `leanshot-android` (android).** Per-platform release tags (`ios@<ver>` / `android@<ver>`) remain inside each project for build-version pivoting.

## Why the change

1. **D-17's premise was wrong** — it said "reuses existing Sentry project from Phase 1", but verification on 2026-05-16 (via Sentry MCP `find_projects(query='leanshot')` against `optimizenet`) returned zero matches. Phase 1 either never created a leanshot project or it was later deleted; only sibling-app `butterfly-{prod,staging}-{api,web}` exist in the org.
2. **Bigger blast radius from a shared project** — one DSN with three release tags means iOS crashes pollute the web error stream's issue list, project-level alerting rules can't be tuned per surface, and quota exhaustion on a chatty native crash burst would silently drop web events too.
3. **dSYM upload routing is cleaner per-project** — `sentry-cli upload-dsym` in fastlane needs `--project <slug>`; with three projects the CLI invocation is explicit per build target (no "is this iOS or Android?" ambiguity in CI scripts) and the symbolicator catalog is scoped tighter.
4. **Per-store analytics consistency with D-10** — D-10 already split bundle IDs per platform (`app.leanshot.ios` / `app.leanshot.android`) for independent submission cycles + per-store analytics. Per-platform Sentry projects align with that posture; mixing platforms back together at the telemetry layer is the asymmetric exception.
5. **User preference** — `feedback_aggressive_foundations.md` (LeanShot infra/foundation phases favor max-coverage over minimum-viable). Three projects is more setup but more telemetry hygiene long-term; the user picked Option A when surfaced with the drift at the credential-wiring step.

## What this means downstream

### Plan 16-04 (Sentry Capacitor dual-init) — minor inline change
- `src/main.tsx` reads `VITE_SENTRY_DSN_IOS` / `_ANDROID` per platform with `VITE_SENTRY_DSN` legacy fallback.
- `src/lib/telemetry-defer.ts` reads `VITE_SENTRY_DSN_WEB` with `VITE_SENTRY_DSN` legacy fallback.
- `src/lib/sentry-native.ts` interface unchanged — the per-platform selection lives at the call site so the helper stays platform-agnostic.
- Test files unchanged (they set `VITE_SENTRY_DSN` which still routes via the legacy fallback). New tests not added — call-site logic is two-liner ternary trivially covered by existing tests' env-var stubbing.
- `16-04-SUMMARY.md` is **not retro-edited** — this addendum is the supersession record per [[feedback-addendum-pattern-for-mid-execution-pivots]].

### Plan 16-09 (Fastlane CI) — env-var rename in CI workflow
- The `user_setup.sentry-auth-token-for-dsym` env-var block in `16-09-fastlane-ci-mobile-pipeline-PLAN.md` referenced `SENTRY_PROJECT_IOS` / `SENTRY_PROJECT_ANDROID` already — no change. The org slug correction (`optimizenet`, NOT `leanshot`) and region (`https://de.sentry.io`) IS new and is captured in `16-09-CREDENTIALS-CHECKLIST.md` Section D.
- fastlane Fastfile must:
  - iOS job: `export VITE_SENTRY_DSN_IOS=<iOS DSN>` before `npm run build` for iOS Capacitor sync; `sentry-cli upload-dsym --org optimizenet --project leanshot-ios --url https://de.sentry.io` after `gym`.
  - Android job: `export VITE_SENTRY_DSN_ANDROID=<Android DSN>` before build; `sentry-cli upload-proguard --org optimizenet --project leanshot-android --url https://de.sentry.io` after `gradle`.
- The mobile.yml CI workflow needs `SENTRY_URL=https://de.sentry.io` set globally (not just `SENTRY_ORG=optimizenet`) — `sentry-cli` defaults to the US region otherwise.

### Plan 16-10 (TestFlight + Play soak)
- Sentry release-tracking queries gain explicit `--project leanshot-ios` / `--project leanshot-android` filters (was implicit-via-tag before).
- The Sentry MCP `analyze_issue_with_seer` calls in any `/gsd-debug` follow-ups must pass `regionUrl: "https://de.sentry.io"` — see [[reference-sentry-org]].

### Vercel env (web/marketing deploy)
- Sets `VITE_SENTRY_DSN_WEB` (the leanshot-web project DSN) for all three Vercel envs (production, preview, development). The legacy `VITE_SENTRY_DSN` is intentionally left unset on Vercel — overrides cleanly via the new name.

## Risk + rollback

**Risk:** Bundle weight unchanged (the per-platform selection happens at module-evaluation time via Vite's static replacement; only the matched DSN string ships in the build target's bundle). No new dependencies. The 2 inline ternary changes are reverted in one Edit if a regression surfaces.

**Rollback:** If telemetry routing turns out flaky, set `VITE_SENTRY_DSN=<leanshot-web DSN>` on all 3 surfaces (iOS, Android, Web) and remove the per-platform vars. The fallback code path collapses to the original D-17 single-project model without further changes. The two extra Sentry projects (leanshot-ios, leanshot-android) can be left in place (idle) or deleted in browser — no code references them after rollback.

## Verification at landing

- [ ] `npm test src/lib/sentry-native.test.ts src/lib/telemetry-defer.test.ts` passes (existing tests still green via the legacy-fallback code path).
- [ ] `npm run build` succeeds + index gz delta ≤ +50 bytes (only inline ternary added).
- [ ] `vercel env ls production | grep VITE_SENTRY_DSN_WEB` shows the env var encrypted + present.
- [ ] After next Vercel deploy: open `https://leanshot.app/` → DevTools Network → confirm errors go to `o4510888703033344.ingest.de.sentry.io/4511398815858768` (the leanshot-web project ID).

## Cross-references

- Origin doc: [[reference-sentry-org]] — `optimizenet` on `de.sentry.io`, project creation API-blocked
- Pattern: [[feedback-addendum-pattern-for-mid-execution-pivots]] — supersession file vs replan
- Aligned with: [[feedback-aggressive-foundations]] — max-coverage over minimum-viable
- Related supersession: `16-CONTEXT.md` D-10 (per-platform bundle IDs) — same per-platform-isolation principle now extended to telemetry
