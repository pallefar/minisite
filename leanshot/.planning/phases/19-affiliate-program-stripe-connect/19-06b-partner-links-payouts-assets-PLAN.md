---
phase: 19
plan: 6b
type: execute
wave: 4
depends_on: [1, 3, 5]
files_modified:
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerLinksPage.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerTemplatePicker.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerCustomizeForm.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerPayoutsPage.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerAssetsPage.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/StripeConnectOnboardingCard.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/__tests__/StripeConnectOnboardingCard.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/partner/__tests__/PartnerCustomizeForm.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/routes/partner-routes.ts
  - /Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/deno.json
  - /Users/karstenhaldan/minisite/supabase/config.toml
autonomous: true
requirements: [AFF-04, AFF-08]
tags: [ui, partner-dashboard, stripe-connect, edge-fn, route-registry, bl-2-path-a, w-1-split-b]

must_haves:
  truths:
    - "StripeConnectOnboardingCard renders 4-state machine consuming Plan 19-03 partner-account-status; hidden when active"
    - "/partner/links shows referral URL + 3-template picker + customization form; Save propagates through partner-profile-update Edge Function (BL-2 Path A — column allowlist + JWT auth)"
    - "/partner/payouts shows next-payout banner + status pill + history table"
    - "/partner/assets shows download grid (assets seeded in Plan 19-08)"
    - "BL-2 Path A — partner-profile-update Edge Function: JWT-authenticated POST that allowlists writes to (display_name, photo_path, blurb, calendly_url, testimonial_quote, template_choice) on the caller's affiliate row; rejects any other column"
    - "BL-4 route registry: this plan creates src/routes/partner-routes.ts with /partner/* entries; App.tsx wiring is owned by Plan 19-09"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/partner/StripeConnectOnboardingCard.tsx"
      provides: "4-state-machine card consuming Plan 19-03 partner-account-status"
      contains: "ConnectState"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/index.ts"
      provides: "BL-2 Path A — JWT-gated POST with column allowlist; service-role UPDATE on affiliates"
      contains: "ALLOWED_COLUMNS"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/routes/partner-routes.ts"
      provides: "BL-4 route registry — /partner/* descriptors consumed by App.tsx in Plan 19-09"
      contains: "PartnerLayout"
  key_links:
    - from: "StripeConnectOnboardingCard"
      to: "partner-account-status Edge Function (Plan 19-03)"
      via: "via PartnerContext (Plan 19-06a)"
      pattern: "partner-account-status"
    - from: "PartnerCustomizeForm Save"
      to: "partner-profile-update Edge Function"
      via: "fetch POST with JWT"
      pattern: "partner-profile-update"
---

<objective>
**W-1 split (b/2):** Ship the remaining partner surface — Links page (URL + 3-template picker + customize form), Payouts page (history + status pill), Assets page (download grid), shared StripeConnectOnboardingCard (consumed by both /partner/dashboard from 19-06a and /partner/payouts here), BL-4 route registry (`src/routes/partner-routes.ts`), and the **BL-2 Path A partner-profile-update Edge Function** that enforces the column allowlist for affiliate self-edits.

Purpose: AFF-04 completion (Plan 19-06a ships dashboard; this plan ships the rest) + AFF-08 surface (PartnerActivityFeed shows "Pending review" badge on flagged conversions; that surface is in 19-06a's PartnerActivityFeed).

**Iter-1 revisions (2026-05-15):**
- **W-1 split:** This is part b/2 of the original 19-06. Pairs with 19-06a (Wave 3, same batch).
- **BL-2 Path A:** Resolves the hedge "ship update via a small partner-profile-update Edge Function with JWT auth and column allowlist". The Edge Function is the column-allowlist enforcement layer because Postgres RLS cannot restrict UPDATE on a per-column basis. Threat-model row added below.
- **BL-4 route registry:** This plan creates `src/routes/partner-routes.ts` (one /partner/* entry-point pointing at the lazy PartnerLayout). Plan 19-09 imports + wires.

Output: 8 React files + 1 route registry + 3 partner-profile-update Edge Function files + 1 config.toml append.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/leanshot/src/components/billing/PastDueBanner.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/Card.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/EmptyState.tsx
@/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/clinic-invite/index.ts

<interfaces>
From `PastDueBanner.tsx`: state-driven banner with variant/heading/CTA per status (analog for StripeConnectOnboardingCard).
From Plan 19-06a `PartnerLayout`: exports `usePartnerContext()` returning `{ profile, connectState, requirements, refreshAll, lastFetchedAt }`.
Plan 19-03 endpoint: POST `/functions/v1/stripe-connect-onboard` returns `{ url }` (open in new tab).
Plan 19-01 `affiliates_public_view` exposes the 8 non-PII columns; partner pages read from `affiliates` table directly via RLS self-select.

**partner-profile-update contract:**
- POST /functions/v1/partner-profile-update with JWT.
- Body: `{ display_name?: string; photo_path?: string; blurb?: string; calendly_url?: string; testimonial_quote?: string; template_choice?: 'coach' | 'story' | 'method' }`.
- Allowlist: ONLY these 6 columns. Any other key in the body → 400 invalid_input.
- Auth: JWT resolves to user.id; UPDATE applies WHERE `affiliates.user_id = user.id AND status = 'approved'`.
- Per-column validation: lengths per Plan 19-01 schema; template_choice IN ('coach','story','method'); calendly_url URL-shape via `new URL(...)`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build partner-profile-update Edge Function + StripeConnectOnboardingCard + Links/Payouts/Assets pages + route registry + tests</name>
  <files>/Users/karstenhaldan/minisite/leanshot/src/components/partner/StripeConnectOnboardingCard.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/__tests__/StripeConnectOnboardingCard.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerLinksPage.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerTemplatePicker.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerCustomizeForm.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/__tests__/PartnerCustomizeForm.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerPayoutsPage.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/partner/PartnerAssetsPage.tsx, /Users/karstenhaldan/minisite/leanshot/src/routes/partner-routes.ts, /Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/index.ts, /Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/index.test.ts, /Users/karstenhaldan/minisite/supabase/functions/partner-profile-update/deno.json, /Users/karstenhaldan/minisite/supabase/config.toml</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md (§"/partner/links" through §"/partner/assets" + §"Stripe Connect Onboarding Card — State Machine")
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§C.7-C.13 partner surface analogs)
    /Users/karstenhaldan/minisite/leanshot/src/components/billing/PastDueBanner.tsx (state-driven banner analog)
    /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts (JWT auth + service-role admin client pattern)
    /Users/karstenhaldan/minisite/supabase/functions/clinic-invite/index.ts (Edge Function dispatcher + error pattern)
  </read_first>
  <acceptance_criteria>
    - `partner-profile-update/index.ts` accepts ONLY the 6 allowlisted columns; rejects any extra field with 400; resolves user.id from JWT; UPDATEs `affiliates SET ... WHERE user_id = $1 AND status = 'approved'`.
    - `config.toml` has `[functions.partner-profile-update]` block with `verify_jwt = true`.
    - `StripeConnectOnboardingCard.tsx` renders null when state='active'; otherwise renders state-specific heading + body + CTA per UI-SPEC.
    - `PartnerCustomizeForm.tsx` Save button calls `fetch('/functions/v1/partner-profile-update')` with JWT and the form fields.
    - `src/routes/partner-routes.ts` exports a single `PARTNER_ROUTES: RouteDescriptor[]` with one prefix entry `{ match: 'prefix', path: '/partner', componentLoader: () => import('@/components/partner/PartnerLayout') }` — PartnerLayout handles internal sub-routing on pathname suffix.
    - **NO `src/App.tsx` modification.**
    - 13 tests pass (4 Deno for partner-profile-update + 5 StripeConnectOnboardingCard vitest + 4 PartnerCustomizeForm vitest).
    - Bundle delta: partner-bundle chunk ≤ 8 kB gz (sum across 19-06a and 19-06b targets ≤ 16 kB combined).
  </acceptance_criteria>
  <action>

**File 1 — `supabase/functions/partner-profile-update/index.ts`** (BL-2 Path A — column allowlist via Edge Function):
- Module-level: `import { createClient } from 'npm:@supabase/supabase-js@2';`. Lazy admin client (clone stripe-checkout pattern).
- Constants:
  ```
  const ALLOWED_COLUMNS = ['display_name', 'photo_path', 'blurb', 'calendly_url', 'testimonial_quote', 'template_choice'] as const;
  type AllowedColumn = (typeof ALLOWED_COLUMNS)[number];
  ```
- `Deno.serve` handler:
  1. CORS preflight: if `req.method === 'OPTIONS'` return 204 + cors headers.
  2. Method check: only POST; reject others with 405.
  3. JWT auth: extract Bearer JWT; call `admin.auth.getUser(jwt)`; on failure return `jsonError(401, 'unauthenticated')`.
  4. Parse JSON body. Reject if body is not an object.
  5. **Column allowlist enforcement:** iterate `Object.keys(body)`; if ANY key is not in `ALLOWED_COLUMNS` → return `jsonError(400, 'invalid_input', { invalid_column: <key> })`.
  6. Per-column validation:
     - `display_name`: string, length 1..80.
     - `photo_path`: string, max 200 chars (Storage path).
     - `blurb`: string, max 50 chars.
     - `calendly_url`: empty string OR parses via `new URL(...)` AND host ends in `.calendly.com` or is `calendly.com`. Invalid → 400.
     - `testimonial_quote`: string, max 200 chars.
     - `template_choice`: must be one of `['coach', 'story', 'method']`.
  7. SELECT from `affiliates` WHERE `user_id = user.id` LIMIT 1. If no row → 404 `not_an_affiliate`. If `status !== 'approved'` → 403 `not_approved`.
  8. UPDATE `affiliates` SET <provided columns> + `updated_at = now()` WHERE `id = $aff.id`. Use parameterized update via `admin.from('affiliates').update(filteredBody).eq('id', aff.id)`.
  9. Return `jsonResponse(200, { ok: true })`.
- Error handler: top-level try/catch returns `{ error: 'internal' }`; logs Pattern S3.
- Rate-limit: in-memory map keyed by user.id, 10 saves per 60s (light cap; legitimate save flow is debounced client-side).

**File 2 — `supabase/functions/partner-profile-update/index.test.ts`** (4 Deno tests):
- T1: missing JWT → 401.
- T2: body contains extra column (`email`) → 400 `invalid_input`.
- T3: valid body with `template_choice='coach'` → UPDATE called with the 1-column patch; response 200.
- T4: calendly_url with non-calendly host → 400.

**File 3 — `supabase/functions/partner-profile-update/deno.json`**: minimal `{ "imports": {} }`.

**File 4 — `supabase/config.toml`** APPEND (after all earlier `[functions.*]` blocks):
```
[functions.partner-profile-update]
verify_jwt = true
```

**File 5 — `StripeConnectOnboardingCard.tsx`** (per UI-SPEC §"Stripe Connect Onboarding Card — State Machine" + PATTERNS.md §C.13):
- Type: `type ConnectState = 'pending' | 'needs_info' | 'active' | 'restricted'`.
- Props: `{ state: ConnectState; requirements?: string[]; disabled_reason?: string | null; }`.
- If `state === 'active'` → return `null` (UI-SPEC: hidden when active).
- Otherwise use `<Card variant="tonal" padding="lg" span={12}>` with state-specific heading + body + CTA per UI-SPEC state table (verbatim copy required).
- CTA `<Button variant="primary">` (or `variant="secondary"` for restricted state) that, on click, calls `fetch('/functions/v1/stripe-connect-onboard', { method: 'POST', headers: { Authorization: \`Bearer ${session.access_token}\` } })` then `window.open(url, '_blank', 'noopener,noreferrer')` (UI-SPEC line 310). Show loading state via `aria-busy` while fetching.
- For `needs_info`: display first 3 `requirements[]` entries + `+N more` if more — UI-SPEC line 306 verbatim.
- For `restricted`: display `disabled_reason` (admin-curated string from Stripe).
- Slide-down animation on first render per UI-SPEC §Interaction (`translate-y-[-8px] opacity-0` → `0/100` over 300ms; honor `useReducedMotion`).

**File 6 — `__tests__/StripeConnectOnboardingCard.test.tsx`** (5 vitest tests):
- T1: state='active' → renders nothing.
- T2: state='pending' → heading "Complete tax onboarding to receive payouts"; CTA "Start onboarding →".
- T3: state='needs_info' + requirements=['legal_entity','tax_id','bank'] → body lists first 3 then `+0 more`.
- T4: state='restricted' + disabled_reason='requirements.past_due' → body contains disabled_reason; CTA "Contact support".
- T5: CTA click fires POST /stripe-connect-onboard + opens url in new tab.

**File 7 — `PartnerLinksPage.tsx`** (per UI-SPEC §"/partner/links"):
- Consumes `usePartnerContext()` for `profile`.
- Two-column on desktop: left `<Card span={6}>` showing referral URL `https://leanshot.app/r/{referral_code}` in `font-mono text-lg`, with Copy button using `navigator.clipboard.writeText` → success toast "Link copied to clipboard" (UI-SPEC).
- Right `<Card span={6}>`: 3-template picker via `<PartnerTemplatePicker>`.
- Bottom `<Card span={12}>`: customize form via `<PartnerCustomizeForm>`.
- Live-preview render deferred to Plan 19-08 landing renderers (inline TODO).

**File 8 — `PartnerTemplatePicker.tsx`** (per UI-SPEC + PATTERNS.md §C.10):
- Props: `{ selected: 'coach' | 'story' | 'method'; onChange: (t) => void; }`.
- 3 `<Card variant={selected===id ? 'selected' : 'clickable'}>` cards in a grid, one per template id.
- Cards keyboard-navigable: `tabIndex={0}` + `onKeyDown` for Enter/Space; `aria-pressed={selected===id}`.
- Card body per UI-SPEC copywriting: "The coach — photo-forward + Calendly" / "The story — testimonial-forward" / "The method — benefits list, no photo".

**File 9 — `PartnerCustomizeForm.tsx`** (BL-2 — calls partner-profile-update):
- 5 inputs: display_name (max 80, Input), photo upload (file input with helper "Square JPG or PNG, at least 400×400px. Falls back to a colored initial if blank."), blurb (max 50, Input), calendly_url (URL, optional, validated), testimonial_quote (max 200, textarea, only visible when `selectedTemplate === 'story'` — Tailwind `transition-opacity duration-quick`).
- Photo upload writes to Storage path `affiliate-photos/{user_id}/profile.{ext}` via supabase-js Storage client. Use raw `<img class="aspect-square object-cover" />` for the preview (UI-SPEC D-20 — Storage transforms deferred per Phase 16 research).
- Save button: `<Button variant="primary">Save changes</Button>` → calls `fetch('/functions/v1/partner-profile-update', { method: 'POST', headers: { Authorization: \`Bearer ${session.access_token}\`, 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name, photo_path, blurb, calendly_url, testimonial_quote, template_choice }) })`. On 200 → toast "Page updated". On 400/403 → toast with error message from response.

**File 10 — `__tests__/PartnerCustomizeForm.test.tsx`** (4 vitest tests):
- T1: renders 5 fields when selectedTemplate='story'; testimonial_quote shown.
- T2: renders 4 fields when selectedTemplate='coach'; testimonial_quote hidden.
- T3: invalid calendly_url → form-level error; partner-profile-update NOT called.
- T4: valid save → partner-profile-update called with the 6-field body (no extra keys).

**File 11 — `PartnerPayoutsPage.tsx`** (per UI-SPEC §"/partner/payouts"):
- Top conditional `<StripeConnectOnboardingCard>` (consumed via PartnerContext).
- Next-payout banner: `<Card variant="tonal" span={12}>`: "Next payout: {next_first_of_month} · Estimated: ${pending_amount}" (compute next 1st of month after `MIN(payouts.eligible_at)`).
- Stripe Connect status pill: `<Badge tone={...}>Tax onboarding · pending|action needed|Payouts active|Payouts on hold</Badge>` (UI-SPEC copy).
- Payouts table `<Card span={12}>`: 4 columns: date, amount, status badge, stripe_transfer_id (truncated, click-to-copy). Empty state "No payouts yet — Payouts run monthly on the 1st once you've earned at least $25 in confirmed commissions." (UI-SPEC).
- Data: `from('payouts').select('*').eq('affiliate_id', profile.id).order('created_at', { ascending: false })`.

**File 12 — `PartnerAssetsPage.tsx`** (per UI-SPEC §"/partner/assets"):
- Grid `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`.
- Asset cards: list seeded assets from Storage bucket `marketing-assets/v1/` — for this plan, hardcode the list in `src/lib/affiliate/assets.ts` (or inline). Plan 19-08 will populate the bucket.
- Each card: `<Card variant="default" padding="md">` with thumbnail (`aspect-video object-cover rounded-card`), name, metadata text (e.g. "PNG · 728×90 · 24 KB"), `<Button variant="secondary" size="sm" leadingIcon={<Download />} block>Download</Button>` (UI-SPEC).
- Download: generates a 1-hour signed URL via supabase Storage `createSignedUrl(path, 3600)`.
- Empty state per UI-SPEC: "Assets coming soon — We're preparing logo packs, banner sets, and swipe-copy. Check back in a day or two."

**File 13 — `src/routes/partner-routes.ts`** (BL-4 — partner route registry):
- Re-import the `RouteDescriptor` type from `affiliate-apply-routes.ts` (Plan 19-05): `import type { RouteDescriptor } from './affiliate-apply-routes';`.
- Also need PartnerLayout to internally route on pathname suffix (`/partner/dashboard` vs `/partner/links` etc.). Update `PartnerLayout.tsx` (Plan 19-06a) ALSO via this plan's commit? NO — that's a 19-06a file. Instead, **PartnerLayout from 19-06a already reads `window.location.pathname`** for sub-nav active state; this plan extends that read to drive which child component renders. Implementation note: PartnerLayout in 19-06a renders `{children}` — the children come from a small switch in `partner-routes.ts`'s helper.
- Concrete approach for partner-routes.ts:
  ```
  import type { RouteDescriptor } from './affiliate-apply-routes';
  export const PARTNER_ROUTES: RouteDescriptor[] = [
    { match: 'prefix', path: '/partner', componentLoader: () => import('@/components/partner/PartnerLayout') },
  ];
  ```
- `PartnerLayout` (from 19-06a) is the ONE entry point for `/partner/*` — it reads `window.location.pathname` and dynamic-imports the right child (Dashboard / Links / Payouts / Assets) inside a `<Suspense>` boundary. Plan 19-06a's PartnerLayout already accepts `pathname` as a prop or reads from window directly; ensure 19-06a + 19-06b coordinate on this contract (this plan's executor can extend PartnerLayout if 19-06a's version doesn't already have the sub-route switch — note in SUMMARY).

**Constraints:**
- 4 sizes / 2 weights per surface (UI-SPEC).
- DO NOT use `s.user!` non-null assertion — guard via `if (!user) return null;` before destructuring.
- Reuse existing primitives — NO new primitives.
- **NO `src/App.tsx` modification** (BL-4 — Plan 19-09 owns wiring).
- Edge Function imports via esm.sh / npm: URLs only ([[reference-supabase-edge-function-deploy]]).
- Test file MUST be `index.test.ts` ([[reference-deno-test-discovery]]).
- Commit with pathspec on this plan's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/partner-profile-update/index.test.ts --allow-env --allow-net && cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/components/partner/__tests__/StripeConnectOnboardingCard.test.tsx src/components/partner/__tests__/PartnerCustomizeForm.test.tsx --run && (git diff --quiet src/App.tsx || (echo "BL-4 FAIL"; exit 1))</automated>
  </verify>
  <done>partner-profile-update Edge Function enforces 6-column allowlist with JWT auth; StripeConnectOnboardingCard renders 4 states correctly; Links/Payouts/Assets pages compose per UI-SPEC; route registry `src/routes/partner-routes.ts` created; `src/App.tsx` UNTOUCHED in this plan (BL-4 verified); 13 tests pass; partner-bundle chunk ≤ 8 kB gz.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser (affiliate) → partner-profile-update | JWT-gated; user.id resolved server-side; column allowlist enforced |
| Browser → Storage signed URLs | 1-hour TTL signed URLs for marketing assets |
| Browser → Stripe-hosted onboarding (new tab) | External; we never receive Stripe-side data here |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-06b-S | Spoofing | Affiliate impersonates another affiliate's profile-update | mitigate | JWT user.id is the canonical key; UPDATE WHERE clause is `user_id = $1`, not from request body |
| T-19-06b-T | Tampering | Affiliate writes a non-allowlist column (e.g. `commission_rate_cents`) | mitigate | BL-2 Path A — column allowlist enforced in partner-profile-update Edge Function; any extra body key → 400 (V11) |
| T-19-06b-T | Tampering | Affiliate sets template_choice to invalid value | mitigate | Per-column validation against `['coach','story','method']`; rejects others with 400; DB CHECK constraint is the secondary backstop |
| T-19-06b-T | Tampering | XSS via display_name/blurb/testimonial_quote with `<script>` injection | mitigate | React auto-escapes string children in dashboard cards + landing renderers (V5); server-side max-length enforced |
| T-19-06b-R | Repudiation | Affiliate denies a payout was sent | mitigate | Payouts table immutable from client (no UPDATE policy); Stripe transfer_id is canonical |
| T-19-06b-I | Information Disclosure | Storage URL TTL too long | mitigate | createSignedUrl with 3600s TTL; not persisted in JS state beyond download click |
| T-19-06b-D | DoS | partner-profile-update spam | mitigate | Per-user in-memory rate-limit (10 saves / 60s); legitimate flow is debounced client-side |
| T-19-06b-E | Elevation of Privilege | Affiliate edits a different affiliate's row | mitigate | partner-profile-update gates by `auth.uid() = affiliates.user_id`; RLS denies cross-tenant UPDATE even if Edge Function were bypassed |
</threat_model>

<verification>
- 4 Deno tests for partner-profile-update pass (auth, column-allowlist, validation, status='approved' gate)
- 5 StripeConnectOnboardingCard vitest tests pass
- 4 PartnerCustomizeForm vitest tests pass
- `src/routes/partner-routes.ts` registry created
- `src/App.tsx` UNTOUCHED in this plan (BL-4)
- Bundle delta: partner-bundle chunk ≤ 8 kB gz; combined 19-06a + 19-06b ≤ 16 kB
- BL-2 Path A: column allowlist enforced in Edge Function (NOT in DB RLS — Postgres can't restrict columns per policy)
</verification>

<success_criteria>
- Affiliate user opens /partner/links (once 19-09 wires App.tsx) → Copy referral URL works; template-picker selection persists via partner-profile-update; customize form Save toasts "Page updated"
- /partner/payouts shows next-payout banner + status pill + history table
- /partner/assets shows download grid (assets seeded by Plan 19-08 — empty state OK at this plan's close)
- StripeConnectOnboardingCard appears at top of dashboard + payouts when state≠active; CTA opens Stripe URL in new tab
- partner-profile-update rejects any non-allowlisted column with 400
</success_criteria>

<output>
After completion, create `19-06b-SUMMARY.md`: list of 13 new files; bundle delta (partner-bundle chunk); BL-2 Path A column-allowlist contract; route registry file path documented for Plan 19-09; threat-model T-19-06b-T row referenced; BL-4 note that App.tsx is UNTOUCHED.
</output>
