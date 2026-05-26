# Phase 64: Legal Refresh - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Mode:** Smart Discuss (autonomous) — prescriptive requirements, minimal grey area

<domain>
## Phase Boundary

State-privacy disclosures (CCPA/CPRA + CDPA + CPA + CTDPA + UCPA) + Do-Not-Sell opt-out + DSAR portal state-rights extensions + privacy policy/ToS audit + accessibility statement + DMCA agent registration + cookie banner WCAG 2.2 AA re-audit + grandfathered-notice email campaign. v1.4 launch BLOCKER per `research/v1.4-launch-readiness-gaps.md`.

**Surfaces delivered (10):**
1. **State-privacy addendums** in `PrivacyPolicy.tsx` — 5 state sections (CA/VA/CO/CT/UT)
2. **`/privacy/do-not-sell` opt-out form** wired to new `privacy_optout_requests` table
3. **DSAR portal state-flavor variants** — state-select intake form on existing Phase 22 DSAR surface
4. **Privacy policy + ToS update** — driven from `subprocessor-diff` cron output (Phase 25)
5. **`/legal/accessibility` page** — WCAG 2.2 AA conformance statement
6. **`/legal/dmca` page** — DMCA agent + takedown procedure; `abuse@leanshot.app` mailbox
7. **Cookie banner WCAG 2.2 AA re-audit** + CPRA "Do Not Sell" link in banner
8. **ToS update** for community UGC (Phase 44-49 carry-over)
9. **Grandfathered-notice email** lifecycle Edge Fn (one-shot to pre-v1.4 users)
10. **Opt-out propagation** — Edge Fn fan-out: PostHog opt-out + ad-network exclusion within 24h

**Out of scope (defer to v1.5):**
- GDPR / EU representative registration (out of scope per US-only launch)
- HIPAA HITRUST certification (deferred milestone)
- Multi-language legal copy (English-only at launch; Spanish in v1.5)

</domain>

<decisions>
## Implementation Decisions

### Legal Copy Source

- **Internal-authored copy + external legal review at staging** (default). LEGAL-04 ToS audit pulls from `subprocessor-diff` cron output (Phase 25) — vendors listed automatically. Author drafts in `content/legal/*.md` (mirrors Phase 62 `content/research/*.md`); legal counsel reviews at staging before flipping `published_at`.
- All copy ships in repo (git-versioned); changes traceable via commit history.
- NO LLM-generated final legal copy — drafts only, all final text requires human legal review at Phase 70 UAT.

### State-Privacy Addendums

- **5 state sections in single `PrivacyPolicy.tsx`** — NOT per-state pages. Anchor links `/legal/privacy#california`, `#virginia`, `#colorado`, `#connecticut`, `#utah`.
- Each state addendum has: rights enumeration + how-to-exercise instructions + state-specific contact procedure.
- "Last updated" date + "What changed" callout sticky at top of policy.

### Do-Not-Sell Opt-Out

- **`/privacy/do-not-sell` standalone page** with form: name + email + state-residency dropdown + opt-out scope checkboxes (advertising / sale / sharing).
- Form POST → `privacy_optout_requests` table (new in Phase 64) + Edge Fn `privacy-optout-process` (new in Phase 64) fan-outs:
  - PostHog: `posthog.opt_out_capturing()` for the user_id + add to `posthog_optout_user_ids` array (server-side capture skip)
  - Ad network: insert into `ad_targeting_exclusion` table (per Phase 56 ad-targeting pipeline)
  - Email: insert into `email_lifecycle_exclusion` table (per Phase 60 newsletter pattern)
- Confirmation email sent via Resend on form submit.
- Honor SLA: 24h propagation per CCPA (not 30d — tighter than statute, easier to verify).

### DSAR Portal Extensions

- Extend existing Phase 22 DSAR portal at `/account/data-rights` (single-form approach) with **state-residency dropdown** that conditionally shows state-specific request types:
  - CA: deletion, access, portability, opt-out, limit sensitive use
  - VA: deletion, access, portability, correction, opt-out
  - CO/CT: same as VA + opt-in for sensitive data
  - UT: deletion, access (no portability under UCPA)
- Request routed to `data_rights_requests` table (existing). State-specific intake variant tag in `request_type` enum (extend with new values).

### Cookie Banner

- Existing banner from v1.3 Phase 25 audit'd via axe-core CLI: `npx axe-core --tags wcag2aa --rules color-contrast,aria-label,target-size <staging-url>`.
- All non-conformances fixed inline.
- "Do Not Sell" link added to banner footer (NOT separate page redirect — CPRA explicitly allows banner-surfaced).
- Banner copy updated with sign-in-rate-limiting mention per AUTH-16 cross-reference.

### Grandfathered-Notice Email

- One-shot lifecycle send via new Edge Fn `grandfathered-policy-notice`:
  - Query: `auth.users WHERE created_at < phase_64_ship_date AND email_marketing_consent != false`
  - Send via Resend with: policy summary + "what changed" + "what you can do" CTA + unsubscribe footer
  - Track delivery: insert row in `policy_notice_log(user_id, sent_at, opened_at, unsubscribed_at)`
- Hardcoded `phase_64_ship_date` constant in Edge Fn — set at deploy time. NO repeat-send (idempotent: `ON CONFLICT (user_id) DO NOTHING`).
- Honor email-preference + unsubscribe per CAN-SPAM. Subject line: "Updated Privacy Policy & Terms — your data, your control"

### Subprocessor List Source

- `LegalLayout` includes `<SubprocessorList />` component that reads from existing `subprocessor_diff` cron output (Phase 25). Live-fetched at render time (no static markdown duplication).
- Vendors auto-listed: PostHog Session Replay, Anthropic, Mux, Stripe Connect, OpenRouter (Phase 60.5), Cohere (Phase 60.5), Resend, Vercel, Supabase, Sentry.

### Accessibility Statement

- `/legal/accessibility` page using `LegalLayout` primitive (existing).
- States: WCAG 2.2 AA target conformance + ADA Title III posture + contact email `accessibility@leanshot.app` + remediation timeline (30-day response SLA).

### DMCA

- DMCA agent registration is OPERATOR action — Phase 64 plan documents the procedure + creates the page; operator handles U.S. Copyright Office filing at Phase 70 UAT step.
- `/legal/dmca` page lists: agent name (placeholder until filed) + abuse@leanshot.app email + takedown procedure + counter-notice procedure + safe-harbor disclaimer.
- `abuse@leanshot.app` mailbox routing: configure in Resend Inbound to forward to legal@leanshot.app + auto-acknowledge sender.

### Claude's Discretion

- Exact wording of state addendum copy (legal counsel will revise at Phase 70 UAT).
- Naming of new tables (suggested: `privacy_optout_requests`, `policy_notice_log`, `ad_targeting_exclusion`, `email_lifecycle_exclusion`).
- Migration filename timestamps — `20290103000001+` (Phase 64; after Phase 62's `20290102*` cluster).
- Whether to extend existing `data_rights_requests.request_type` enum vs create new state-flavor column.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`LegalLayout.tsx`** (Phase 22) — wrapper for `/legal/*` pages
- **`PrivacyPolicy.tsx`** (Phase 22) — existing privacy page; extend with state sections
- **DSAR portal** at `/account/data-rights` (Phase 22) — extend with state-residency dropdown
- **`subprocessor_diff` cron** (Phase 25) — source of truth for vendor list
- **Cookie banner** (Phase 25) — re-audit + update copy
- **Resend integration** (Phase 9 + Phase 60-12 newsletter) — reuse for grandfathered-notice + opt-out confirmation
- **PostHog opt-out** — `posthog.opt_out_capturing()` client-side + `posthog_optout_user_ids` array server-side
- **Phase 25 vendor_baa_chain** — extend for new Phase 60.5 vendors (OpenRouter, Cohere)
- **Phase 56 ad-targeting pipeline** — `ad_targeting_exclusion` consumer
- **Phase 60 newsletter unsubscribe pattern** — mirror for opt-out flows

### Established Patterns
- Legal pages use static React + `react-helmet-async` for SEO meta
- All Edge Fns split handler/index per [[reference_deno_test_top_level_serve_trap]]
- Migrations forward-dated `20290103*` (avoids back-dated push block)
- Bare `CREATE POLICY` (no `IF NOT EXISTS` — unsupported on remote PG)
- `markdown-it` available (Phase 62) for rendering markdown legal copy

### Integration Points
- **`PrivacyPolicy.tsx`** — extend with 5 anchored state addendum sections
- **`App.tsx`** — `/privacy/do-not-sell` route added (auth-optional public page)
- **`/account/data-rights`** — extend with state-residency dropdown
- **Cookie banner** — copy updates + "Do Not Sell" footer link
- **Resend** — new email template for grandfathered-policy-notice
- **PostHog + ad-network + email-lifecycle** — fan-out targets for opt-out

</code_context>

<specifics>
## Specific Ideas

- **24h opt-out propagation SLA** (tighter than CCPA 30d statute — easier to verify + better PR)
- **Anchor links** for state addendums: `/legal/privacy#california`, `#virginia`, etc.
- **"What changed" callout** sticky banner at top of policy with version date + diff summary
- **Idempotent grandfathered email** — `ON CONFLICT (user_id) DO NOTHING` on `policy_notice_log` insert; no re-sends ever
- **Subprocessor list live-rendered** — single source of truth via `subprocessor_diff` Phase 25 cron, no static duplication
- **State-residency dropdown** in DSAR portal drives conditional request-type checkboxes

</specifics>

<deferred>
## Deferred Ideas

- GDPR / EU representative — defer to v1.5 (US-only launch)
- HIPAA HITRUST cert — separate milestone
- Spanish legal copy — defer to v1.5 contractor work (Phase 58 ES wiring shipped)
- Per-state separate page (`/legal/privacy/california`, etc.) — anchored sections in single page chosen instead
- LLM-generated final legal copy — never; human counsel review required

</deferred>
