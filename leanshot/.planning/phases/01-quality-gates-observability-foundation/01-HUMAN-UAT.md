---
status: partial
phase: 01-quality-gates-observability-foundation
source: [01-VERIFICATION.md]
started: 2026-05-11T07:30:00Z
updated: 2026-05-11T07:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. S-07 — CI green on a trivial PR

expected: All 5 GitHub Actions jobs (lint, format-check, typecheck, test-unit, test-e2e) pass on a PR; branch protection blocks merge on any failure.

how to run:
- `.github/workflows/ci.yml` is committed at the repo root with `defaults.run.working-directory: leanshot` per step
- Push `claude/upgrade-leanshot-design-mjjJl` and open a PR against `main`
- Watch the Actions run; confirm all 5 jobs pass and the production-build security check (no `phase-1-sentry-smoke` string in `dist/`) succeeds
- Configure branch protection to require all 5 status checks

result: [pending]

### 2. S-08 — Sentry receives test error within 60s with redacted fields

expected: Clicking the dev-only `phase-1-sentry-smoke` button produces a Sentry event in your org within 60s, with `symptom`, `mood`, `note`, and `aiHistory` fields demonstrably redacted by the `beforeSend` hook.

how to run:
- Add `VITE_SENTRY_DSN=<your-dsn>` to `leanshot/.env.local`
- `cd leanshot && npm run dev`
- In the app: Settings → Dev Tools → "Throw test error → Sentry"
- Open your Sentry project's Issues view and inspect the event; confirm the four PII fields show `[Redacted]` (or are absent) in any nested objects, arrays, and JSON-string breadcrumb bodies

result: [pending]

### 3. S-09 — PostHog receives onboarding + tab_viewed events with no health content

expected: PostHog Live Events shows `onboarding_started`, `onboarding_step_completed` (with step number), `onboarding_completed`, and `tab_viewed` events from a real device. No event payload contains free-text health content (symptom/mood/note/aiHistory).

how to run:
- Add `VITE_POSTHOG_KEY=<your-key>`, `VITE_POSTHOG_HOST=https://us.i.posthog.com`, `VITE_ANALYTICS_ENABLED=true` to `leanshot/.env.local`
- Restart dev server, complete onboarding (or use existing onboarded state), navigate between tabs
- In PostHog: Live Events → confirm all four event types appear; spot-check payloads for absence of any health-related free text

result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
