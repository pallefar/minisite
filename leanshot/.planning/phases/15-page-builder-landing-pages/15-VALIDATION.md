---
phase: 15
slug: page-builder-landing-pages
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/integration) + Playwright (e2e) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test && npm run test:e2e` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test`
- **After every plan wave:** Run `npm run test && npm run test:e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

*Populated by the planner during /gsd-plan-phase. See 15-RESEARCH.md "## Validation Architecture" for the validation surfaces this phase must cover (RLS on landing_pages / landing_page_revisions / leads / page-assets bucket, append-only revision invariant, ISR/cache-freshness on publish, Lighthouse perf ≥90 + a11y ≥95 gates, CSP snapshot widening for embeds).*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | PAGE-01..09 | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Per-RLS-surface cross-tenant impersonation proof tests — `landing_pages`, `landing_page_revisions`, `leads`, `page-assets` bucket (project rule: every RLS surface gets a live impersonation proof test)
- [ ] Append-only revision invariant test for `landing_page_revisions`
- [ ] CSP snapshot fixture update — `tests/csp/csp-snapshot.txt` widened `frame-src` for Calendly / youtube-nocookie.com / Tally
- [ ] Bundle-budget assertion — `page-builder-runtime` chunk ≤ 25 kB gz; `admin-bundle` stays lazy / out of index

*Planner fills exact file paths and stub list.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Lighthouse Performance ≥ 90 + Accessibility ≥ 95 on a published page | PAGE-05 / SC #3 | Lighthouse run requires a deployed page + headless Chrome audit | Publish a sample page, run Lighthouse against the live `/{slug}` URL, confirm scores |
| Visitor does NOT download the editor React bundle | PAGE-05 / SC #3 | Network-tab inspection of a real page load | Load published `/{slug}`, inspect Network tab — confirm no `admin-bundle` / dnd-kit chunk fetched |
| OG / canonical / JSON-LD tags present in served HTML | PAGE-08 / SC #4 | Crawler-perspective check on rendered HTML | `curl` the published page, grep for `og:`, `canonical`, `application/ld+json`; run Lighthouse SEO |
| `/pricing` Checkout button reaches live Stripe Checkout | PAGE-09 / SC #5 | Hitting live Stripe Checkout is a manual/staged verification | Click the Checkout block on `/pricing`, confirm redirect to Stripe Checkout with the correct live price ID |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
