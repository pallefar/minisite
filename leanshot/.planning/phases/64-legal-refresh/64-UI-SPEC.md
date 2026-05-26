---
phase: 64
slug: legal-refresh
status: approved
shadcn_initialized: false
preset: none
created: 2026-05-26
reviewed_at: 2026-05-26
---

# Phase 64 — UI Design Contract: Legal Refresh

## Scope Note

Phase 64 reuses the LeanShot v1.4 design system established in Phase 60-13 (`/knowledge/*`), Phase 61 (`/admin/protocols/*`), and Phase 62 (`/admin/research/*` + `/research/<slug>`). No new tokens, primitives, spacing, or typography rules introduced. This spec confirms the contract for new Phase 64 surfaces (state-privacy sections + Do-Not-Sell form + DSAR state extensions + accessibility + DMCA pages + cookie banner update + grandfathered-notice email template).

## Color (verbatim Phase 60+ token table)

All tokens defined in `src/index.css @theme {}`. Phase 64 uses ONLY:
- `--color-bg` (#f2ede0) — dominant 60%
- `--color-surface` (#fefcf7) — secondary 30%
- `--color-primary` (#1b4842) — accent 10%, primary CTAs only
- `--color-danger` (#cf5454) — destructive actions (opt-out submit, DMCA takedown CTA)
- `--color-text` / `--color-text-secondary` / `--color-text-tertiary` — body/meta/caption
- `--color-warning-soft` + `--color-rose-soft` — banner backgrounds ("Last updated" sticky callout)
- `--color-border` + `--color-surface-elevated` — cards + form section dividers

## Typography (verbatim Phase 61 ceiling)

- 4 sizes: `text-[11px]` (legal meta), `text-[13px]` (body), `text-[18px]` (section headings), `text-heading` (page H1 28px)
- 2 weights: `font-normal` (400), `font-semibold` (600)
- Body line-height: 1.5 (legal text density; readability critical)
- Page H1 on `/legal/*` uses `font-display` (Fraunces) per Phase 60-13 KnowledgeArticleDetailPage precedent

## Spacing (verbatim Phase 60+ scale)

8-point scale {4, 8, 16, 24, 32, 48, 64}px + 44px touch-target minimum.

## Surfaces in Scope

### 1. PrivacyPolicy.tsx (extend)
- Existing page extended with 5 state addendum sections (CA/VA/CO/CT/UT)
- Each section anchored by H2 (18px/600) with `id="california"`, etc.
- Table-of-contents nav at top (sticky on lg+ viewports) with anchor links to each state section
- "Last updated YYYY-MM-DD" + "What changed" callout in `--color-warning-soft` banner at top
- Subprocessor list rendered via `<SubprocessorList />` component (live-fetched from Phase 25 cron output)

### 2. /privacy/do-not-sell standalone page
- LegalLayout wrapper
- H1 "Do Not Sell or Share My Personal Information" (28px)
- Form fields: name (Input), email (Input), state-residency (Select), opt-out scope (3 Checkbox tone:default)
- Submit CTA: "Submit opt-out request" (NOT generic "Submit") — primary color
- Success state: green success Badge + "We've received your request. Confirmation email sent to {email}. Allow 24 hours for propagation."
- Error state: red text + "Try again — if the problem persists, email privacy@leanshot.app"

### 3. /account/data-rights (DSAR portal extension)
- Existing form extended with state-residency Select at top
- Conditional checkboxes appear based on state selection (CA/VA/CO/CT/UT-specific request types)
- "Cancel request" CTA copy: `"Keep my data rights pending"` (NOT generic "Cancel" per Phase 61 lesson)

### 4. /legal/accessibility (new page)
- LegalLayout wrapper, H1 "Accessibility Statement"
- Body sections: WCAG 2.2 AA target, ADA Title III posture, contact, remediation timeline, 30-day SLA
- "Report an accessibility issue" CTA → `mailto:accessibility@leanshot.app`

### 5. /legal/dmca (new page)
- LegalLayout wrapper, H1 "DMCA Notice & Takedown"
- Body sections: agent info (placeholder until U.S. Copyright Office filing), takedown procedure, counter-notice procedure, safe-harbor disclaimer
- "Submit DMCA notice" CTA → `mailto:abuse@leanshot.app?subject=DMCA%20Takedown%20Notice`

### 6. Cookie banner update (extend existing)
- Existing banner copy updated per AUTH-16 cross-ref
- "Do Not Sell" link added to banner footer (text-[11px], text-text-secondary)
- All non-conformances from axe-core re-audit fixed inline

### 7. Grandfathered-notice email template
- Resend email template with: policy summary header + "What changed" section + "What you can do" CTA + footer with unsubscribe + physical address
- Plain text + HTML variants
- Subject: "Updated Privacy Policy & Terms — your data, your control"

## Copywriting Contract

- **Primary CTAs (verb + noun)**: "Submit opt-out request", "Submit DMCA notice", "Report an accessibility issue", "Update my preferences"
- **Cancel CTAs (no generic "Cancel")**: "Keep my data rights pending"
- **Empty states**: N/A (no empty list surfaces in Phase 64)
- **Error states**: All include solution path (specific contact email or "Try again" with operator email fallback)
- **Destructive confirmations**: opt-out submit shows confirmation modal with verbatim copy: "Submit this opt-out request? You can change your mind later by emailing privacy@leanshot.app. Allow 24 hours for propagation across our systems."

## Reuse Targets

- `LegalLayout.tsx` (Phase 22) verbatim for all new legal pages
- `Input.tsx`, `Select.tsx`, `Checkbox.tsx`, `Button.tsx` from `src/components/ui/`
- `react-helmet-async` for SEO meta on `/legal/*` (mirror Phase 60-13)
- Resend email template patterns from Phase 60-12 newsletter

## Registry Safety

No third-party UI registries. Tailwind v4 `@theme` tokens + own DS primitives.
