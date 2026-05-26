# Phase 64: Legal Refresh — Validation Plan

**Generated:** 2026-05-26 (inline by planner per [[feedback_validation_md_inline_generation_when_missing]])
**Inputs:** Phase 64 plan set 64-01 through 64-08 `<verify><automated>` blocks aggregated.

## Plan-level verification (executor-runnable)

| Plan | Command(s) | Expected |
|------|-----------|----------|
| 64-01 | `cd /Users/karstenhaldan/minisite && ls supabase/migrations/2029010300000{1,2,3,4,5}_*.sql && grep -L 'create table public\.(privacy_optout_requests\|policy_notice_log\|ad_targeting_exclusion\|email_lifecycle_exclusion\|data_rights_requests)' supabase/migrations/2029010300000{1,2,3,4,5}_*.sql` | 5 files exist; no bare `IF NOT EXISTS` on `CREATE POLICY`; tables declared in expected file slots |
| 64-02 | `grep -q "export async function handle" supabase/functions/privacy-optout-process/handler.ts && grep -qE "privacy_optout_requests\|ad_targeting_exclusion\|email_lifecycle_exclusion" supabase/functions/privacy-optout-process/handler.ts` | DI handler exports + writes to all 3 fan-out tables |
| 64-03 | `grep -q "Updated Privacy Policy" supabase/functions/grandfathered-policy-notice/handler.ts && grep -qi "on conflict.*do nothing\|onConflict" supabase/functions/grandfathered-policy-notice/handler.ts && grep -q "PHYSICAL_ADDRESS" supabase/functions/grandfathered-policy-notice/handler.ts` | Subject line + idempotent INSERT + placeholder runtime guard |
| 64-04 | `npx vitest run src/components/legal/__tests__/SubprocessorList.test.tsx src/components/legal/__tests__/PrivacyPolicy.state-addendums.test.tsx --config vite.config.ts && grep -q 'id="california"' src/components/legal/PrivacyPolicy.tsx && grep -q 'id="utah"' src/components/legal/PrivacyPolicy.tsx` | vitest green + 5 state anchors + SubprocessorList + ToS UGC section |
| 64-05 | `npx vitest run src/components/legal/__tests__/{DoNotSellPage,AccessibilityPage,DMCAPage}.test.tsx --config vite.config.ts && grep -q "Submit opt-out request" src/components/legal/DoNotSellPage.tsx && grep -q "Submit DMCA notice" src/components/legal/DMCAPage.tsx` | 3 page tests green + verb+noun CTA copy |
| 64-06 | `npx vitest run src/lib/dsar/__tests__/state-request-types.test.ts src/components/dsar/__tests__/DsarPortalPage.state-residency.test.tsx --config vite.config.ts && grep -q "Keep my data rights pending" src/components/dsar/DsarPortalPage.tsx` | lookup tests + DSAR state-residency tests green + Cancel copy correct |
| 64-07 | `npx vitest run src/components/consent/__tests__/consent-config.cpra.test.ts --config vite.config.ts && grep -q "Do Not Sell or Share" src/components/consent/consent-config.ts && grep -q "DoNotSellPage" src/App.tsx && grep -q "Accessibility" src/components/layout/LegalFooter.tsx && grep -q "/privacy/do-not-sell" public/sitemap.xml` | banner copy + App.tsx routes + LegalFooter labels + sitemap entries |
| 64-08 | `npx supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp` + healthz curl + REQUIREMENTS.md grep | 5 remote migrations + 2 Fns ACTIVE + 10 LEGAL- IDs flipped |

## Phase-level cross-plan invariants (Plan 64-08 owns enforcement)

| Invariant | Check |
|-----------|-------|
| Single-H1 per legal page | `for f in src/components/legal/*.tsx; do test "$(grep -c '<h1' "$f")" -le 1 || echo "MULTIPLE H1 in $f"; done` — expect no output. Plan 64-05 makes LegalLayout render the title H1; Plan 64-04 must remove any pre-existing internal H1 from PrivacyPolicy.tsx + TermsOfService.tsx so total = 1. |
| No undefined Tailwind v4 tokens | `! grep -rE "text-text-primary\|bg-surface-card\|border-border-subtle\|bg-warning-subtle\|text-accent" src/components/legal/ src/components/dsar/` — expect no matches per [[feedback_ui_auditor_catches_undefined_theme_tokens]]. |
| Typography ceiling 11/13/18/heading + 400/600 | `! grep -vE '^\s*//\|^\s*\*' src/components/legal/*.tsx src/components/dsar/DsarPortalPage.tsx | grep -E "text-\[(?!11px\|13px\|18px)" \|\| grep -E "font-(thin\|light\|medium\|bold\|extrabold\|black)" src/components/legal/*.tsx src/components/dsar/DsarPortalPage.tsx` — expect no matches. |
| All 11 requirements covered | Each of LEGAL-01..10 + AUTH-16 appears in at least one plan's `requirements:` frontmatter. Plan 64-08 covers all 11 for tracking. |
| No back-dated migrations | `ls supabase/migrations/*.sql | sort | tail -10` shows all 20290103* files come AFTER 20290102000010. |
| Edge Fn handler/index split honored | `for f in supabase/functions/{privacy-optout-process,grandfathered-policy-notice}; do test -f "$f/handler.ts" && test -f "$f/index.ts" && grep -q "if (import.meta.main)" "$f/index.ts"; done` per [[reference_deno_test_top_level_serve_trap]] |
| CTA copywriting contract | `grep -q "Submit opt-out request" src/components/legal/DoNotSellPage.tsx && grep -q "Submit DMCA notice" src/components/legal/DMCAPage.tsx && grep -q "Report an accessibility issue" src/components/legal/AccessibilityPage.tsx && grep -q "Keep my data rights pending" src/components/dsar/DsarPortalPage.tsx` |
| Draft disclaimer present | `grep -l "draft pending legal counsel review\|draft pending Phase 70" src/components/legal/{DoNotSellPage,AccessibilityPage,DMCAPage,PrivacyPolicy,TermsOfService}.tsx` — expect 5 matches |

## Goal-backward truth matrix

| Truth (from CONTEXT § Surfaces delivered) | Verifiable by |
|------------------------------------------|---------------|
| PrivacyPolicy renders 5 state addendums (CA/VA/CO/CT/UT) — LEGAL-01 | Plan 64-04 vitest + grep of 5 anchor ids |
| `/privacy/do-not-sell` form wires to privacy_optout_requests + propagates to PostHog/ad/email exclusions in 24h — LEGAL-02 | Plan 64-05 vitest + Plan 64-02 Deno tests + Plan 64-08 human-verify signal B step 3 row inspection |
| DSAR portal state-flavor extension lives at /settings/privacy/dsar — LEGAL-03 | Plan 64-06 vitest + Plan 64-08 human-verify signal B step 4 (UT shows 2 / CO shows 6) |
| Privacy policy + ToS reflect every v1.2/v1.3 subprocessor — LEGAL-04 | Plan 64-04 SubprocessorList live-fetches subprocessor_snapshots |
| `/legal/accessibility` page exists with WCAG 2.2 AA copy — LEGAL-05 | Plan 64-05 vitest + Plan 64-07 hash route + Plan 64-08 axe-core re-audit |
| `/legal/dmca` page exists with takedown procedure — LEGAL-06 | Plan 64-05 vitest + Plan 64-07 hash route |
| Cookie banner passes axe WCAG 2.2 AA + surfaces "Do Not Sell" — LEGAL-07 | Plan 64-07 vitest + Plan 64-08 axe-core checkpoint |
| ToS UGC section + cross-reference to DMCA — LEGAL-08 | Plan 64-04 grep for `id="community-ugc"` + `id="community-rules"` + `/legal/dmca` link |
| Grandfathered-notice email Edge Fn deployed — LEGAL-09 | Plan 64-03 implementation + Plan 64-08 deploy + healthz smoke test (actual send deferred to Phase 70 UAT) |
| Legal-page link audit + sitemap inclusion — LEGAL-10 | Plan 64-07 LegalFooter + sitemap.xml grep |
| Cookie banner mentions sign-in rate-limiting — AUTH-16 cross-ref | Plan 64-07 banner copy grep |

## Out of scope (Phase 70 UAT operator-action)

- Actual grandfathered-policy-notice POST invocation (Plan 64-08 deploys only)
- DMCA agent registration with U.S. Copyright Office
- Legal counsel review + edits to draft state-addendum + ToS UGC + Accessibility + DMCA copy
- Resend Inbound routing for abuse@leanshot.app

These are tracked in Phase 64 CARRY-OVER.md (written by Plan 64-08 Task 3).
