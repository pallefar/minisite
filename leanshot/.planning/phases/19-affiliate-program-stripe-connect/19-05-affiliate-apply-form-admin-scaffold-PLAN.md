---
phase: 19
plan: 5
type: execute
wave: 3
depends_on: [1, 3]
files_modified:
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/resend.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/templates.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/deno.json
  - /Users/karstenhaldan/minisite/supabase/config.toml
  - /Users/karstenhaldan/minisite/leanshot/src/components/affiliate/AffiliateApplyForm.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/affiliate/AffiliateApplyPage.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/affiliate/__tests__/AffiliateApplyForm.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/admin/AdminAffiliatesScaffold.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/admin/__tests__/AdminAffiliatesScaffold.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/ui/InitialsAvatar.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/ui/__tests__/InitialsAvatar.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/routes/affiliate-apply-routes.ts
autonomous: true
requirements: [AFF-05]
tags: [edge-fn, ui, apply-form, admin-scaffold, initials-avatar, resend, route-registry]

must_haves:
  truths:
    - "Anonymous visitor at /affiliate sees apply form with 5 fields per UI-SPEC; submits; receives a 'Application received' email from noreply@app.leanshot.app via direct Resend HTTPS POST (W-5 — clone clinic-invite/resend.ts pattern, NO SDK)"
    - "POST /affiliate-apply with 5 fields validates server-side, INSERTs affiliates row with status='pending', captures ip_signup + fingerprint, sends Resend transactional email, returns { ok: true }"
    - "Admin (role='admin' via is_staff) at /admin/affiliates sees read-only list of all applications with filter pills (All / Pending / Approved / Rejected / Suspended); rows show email, name, audience, status badge, applied_at"
    - "InitialsAvatar primitive renders deterministic gradient avatar from name string; reused at 5 use sites per UI-SPEC"
    - "BL-4 route registry: this plan CREATES src/routes/affiliate-apply-routes.ts with the /affiliate + /admin/affiliates entries; App.tsx wiring is owned by Plan 19-09 (single late-wave task)"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/index.ts"
      provides: "Public Edge Function (verify_jwt=false) — POST apply form; honeypot + rate-limit (clone lead-capture)"
      contains: "Deno.serve"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/resend.ts"
      provides: "Direct HTTPS Resend dispatch (W-5 — clone Phase 9 clinic-invite/resend.ts; NO SDK)"
      contains: "api.resend.com/emails"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/affiliate/AffiliateApplyForm.tsx"
      provides: "5-field React form per UI-SPEC C.1 copywriting + native <select> (no Combobox lib)"
      contains: "AffiliateApplyForm"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/admin/AdminAffiliatesScaffold.tsx"
      provides: "Read-only scaffold; P22 ADMIN-06 will replace; gated by role='admin'"
      contains: "AdminAffiliatesScaffold"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/ui/InitialsAvatar.tsx"
      provides: "Phase 19's ONLY new UI primitive — deterministic-gradient initials avatar"
      contains: "hashStringToHue"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/routes/affiliate-apply-routes.ts"
      provides: "BL-4 route registry — exports route descriptors consumed by App.tsx in Plan 19-09"
      contains: "AffiliateApplyPage"
  key_links:
    - from: "AffiliateApplyForm onSubmit"
      to: "affiliate-apply Edge Function"
      via: "fetch POST"
      pattern: "affiliate-apply"
    - from: "affiliate-apply/resend.ts dispatcher"
      to: "Resend (transactional template)"
      via: "RESEND_API_KEY + direct HTTPS POST to api.resend.com/emails"
      pattern: "api\\.resend\\.com"
    - from: "Plan 19-09 App.tsx wiring"
      to: "/affiliate, /admin/affiliates components"
      via: "import { AFFILIATE_APPLY_ROUTES } from '@/routes/affiliate-apply-routes'"
      pattern: "affiliate-apply-routes"
---

<objective>
Ship the public apply funnel + admin scaffold + the single new UI primitive (`<InitialsAvatar>`). AFF-05 (apply → manual approve → $10 flat commission) lands here. The admin scaffold is read-only because P22 ADMIN-06 owns the full operator UX (CONTEXT D-07).

Purpose: This is the affiliate program's intake surface. The form is public, lazily loaded, and rate-limited to defend against bot floods. The admin scaffold is the minimum operator surface that lets us approve the first affiliates before P22 ships.

**Iter-1 revisions (2026-05-15):**
- **BL-4 wave bump + route registry:** Was Wave 2; now Wave 3 with `depends_on: [1, 3]` (config.toml ordering chain after 19-03). Instead of mutating `src/App.tsx` directly (would collide with 19-06 and 19-08 across waves), this plan creates `src/routes/affiliate-apply-routes.ts` exporting a `RouteDescriptor[]` registry. Plan 19-09 imports the three route-registry files and wires them into App.tsx in one task.
- **W-5 Resend pinning:** Discovered via `grep -rn "npm:resend\|esm.sh/resend" supabase/functions/` that the existing clinic-invite Edge Function uses NO SDK — direct HTTPS POST to `https://api.resend.com/emails`. This plan clones that pattern (file `affiliate-apply/resend.ts`) instead of pinning `npm:resend@4`. Bundle smaller, supply-chain smaller, identical capability.

Output: `affiliate-apply` Edge Function (Resend direct-HTTPS integration), AffiliateApplyForm + AffiliateApplyPage, AdminAffiliatesScaffold, InitialsAvatar primitive, route registry file (App.tsx wiring deferred to 19-09), all tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md
@/Users/karstenhaldan/minisite/supabase/functions/lead-capture/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/clinic-invite/resend.ts
@/Users/karstenhaldan/minisite/supabase/functions/clinic-invite/template-clinic-invite.ts
@/Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/Card.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/Badge.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/Pill.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/PageListView.tsx
@/Users/karstenhaldan/minisite/leanshot/src/illustrations/StreakBadge.tsx

<interfaces>
Existing `<Card>` primitive: `<Card span={N} padding="md|lg" variant="default|tonal|...">`.
Existing `<Pill>` segmented control: used in clinic settings for filter tabs.
Existing `<Badge tone="info|success|warning|danger|neutral">`.
Existing `<Input>` + `<Button>` primitives with `loading`, `block`, `leadingIcon` props.
Existing `useToast` hook + global Toast primitive (role='status' aria-live='polite').
Existing `isStaff()` server-side check from Phase 9; client-side gate uses `auth.users.app_metadata.role === 'admin'` (per CONTEXT D-07).
Existing `lead-capture` Edge Function: verify_jwt=false, honeypot, IP rate-limit (5/15min), clones cors.ts + service-role insert pattern.

**Resend pattern (W-5 resolution):** `supabase/functions/clinic-invite/resend.ts` lines 24-30+:
- NO SDK; the file is a thin wrapper that POSTs to `https://api.resend.com/emails` with `Authorization: Bearer ${Deno.env.get('RESEND_API_KEY')}`.
- `RESEND_FROM` env var defaults to `'LeanShot <noreply@app.leanshot.app>'`.
- CI stub: when `RESEND_API_KEY === 'test-stub'`, the dispatcher short-circuits and returns `{ ok: true }` without making an HTTPS call.
- Returns `{ ok: boolean; error?: string }`; never echoes Resend response bodies.

UI-SPEC §C.1 copywriting contract: full string locks for form + email subjects/openings (READ EVERY CELL).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build affiliate-apply Edge Function with direct-HTTPS Resend dispatcher + InitialsAvatar primitive</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/index.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/index.test.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/resend.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/templates.ts, /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/deno.json, /Users/karstenhaldan/minisite/supabase/config.toml, /Users/karstenhaldan/minisite/leanshot/src/components/ui/InitialsAvatar.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/ui/__tests__/InitialsAvatar.test.tsx</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/functions/lead-capture/index.ts (full file — honeypot + rate-limit + verify_jwt=false analog)
    /Users/karstenhaldan/minisite/supabase/functions/clinic-invite/resend.ts (full file — direct-HTTPS Resend dispatcher; W-5 lock)
    /Users/karstenhaldan/minisite/supabase/functions/clinic-invite/template-clinic-invite.ts (HTML email template structure — render functions)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md (§C.1 form copy + §"Resend transactional emails" subjects + §"New Primitive InitialsAvatar")
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§C.18 InitialsAvatar API + §C.1 form analog)
    /Users/karstenhaldan/minisite/leanshot/src/illustrations/StreakBadge.tsx (size token convention)
    /Users/karstenhaldan/minisite/leanshot/src/components/ui/Badge.tsx (sized-variants pattern)
  </read_first>
  <acceptance_criteria>
    - `supabase/functions/affiliate-apply/resend.ts` clones the shape of `clinic-invite/resend.ts` — direct HTTPS POST to `https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`. Zero imports of `npm:resend` or `esm.sh/resend`.
    - `supabase/functions/affiliate-apply/index.ts` validates 5 input fields + honeypot, idempotency on email, IP /24 rate-limit (5/15min), service-role INSERT into affiliates.
    - `supabase/config.toml` has `[functions.affiliate-apply]` block with `verify_jwt = false`.
    - 6 Deno tests pass; honeypot → silent 200; rate-limit → 429; Resend dispatch mocked via test-stub.
    - `InitialsAvatar.tsx` exports a `size: 'sm' | 'md' | 'lg'` prop (exactly 3 sizes — UI-checker traps >4); `hashStringToHue` is pure + deterministic; `role="img"` + `aria-label` set.
    - 6 vitest tests pass.
  </acceptance_criteria>
  <action>
Three deliverables in this task: the Edge Function (with direct-HTTPS Resend), the email templates module, and the standalone InitialsAvatar UI primitive.

**File 1 — `supabase/functions/affiliate-apply/index.ts`** (public POST, verify_jwt=false):
- Clone the structure of `lead-capture/index.ts` (module-level service-role admin client; honeypot field check; IP rate-limit 5 requests / 15 min using a small in-memory map keyed by `x-forwarded-for` truncated to /24).
- Imports: `import { createClient } from 'npm:@supabase/supabase-js@2';` + `import { sendApplicationReceivedEmail } from './resend.ts';`. NO `npm:resend` import (W-5).
- Handler validates request body using manual schema (do NOT pull a zod dep — match `lead-capture` style):
  - `email: string` — regex `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`, max 254 chars (V5).
  - `name: string` — non-empty, max 80 chars.
  - `audience_size: number` — integer, >= 0, <= 50_000_000.
  - `audience_type: string` — one of `['Instagram','TikTok','YouTube','Newsletter','Coaching','Other']` (D-05 exact list).
  - `why_us: string` — max 500 chars (D-05).
  - `honeypot: string` — must be empty (if non-empty, return 200 + silent no-op; bot detection).
- Capture `ip_signup = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null` and `fingerprint_signup = body.fingerprint ?? null` (client passes optional ThumbmarkJS-derived fingerprint).
- Idempotency: SELECT from `affiliates` WHERE `email = $1`. If exists with `status='pending'` → return 200 `{ already_applied: true }` (silent — V11). If `status='rejected'` → return 200 `{ already_applied: true }` (same response to avoid revealing rejection). If `status='approved'` → return 200 `{ already_applied: true }`.
- INSERT into `affiliates` with fields `email`, `display_name: name`, `audience_size`, `audience_type`, `why_us`, `status: 'pending'`, `ip_signup`, `fingerprint_signup` — uses service-role per Plan 19-01 policies. On unique conflict on email → return 200 silent.
- Send Resend via the dispatcher: `const dispatch = await sendApplicationReceivedEmail({ to: email, name });`. On `dispatch.ok === false` → log via Pattern S3, return 200 `{ ok: true, email_warning: true }` (don't fail the user-visible flow because the audit email failed; we still have the DB row).
- Return `jsonResponse(200, { ok: true })` on success.
- Error handler: top-level try/catch returns `{ error: 'internal' }` (V7).

**File 2 — `supabase/functions/affiliate-apply/resend.ts`** (W-5 — direct-HTTPS clone of clinic-invite/resend.ts):
- Module-level: `const FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';`
- Export `interface SendApplicationReceivedParams { to: string; name: string; }`
- Export `async function sendApplicationReceivedEmail(params: SendApplicationReceivedParams): Promise<{ ok: boolean; error?: string }>`:
  1. CI stub: `if (Deno.env.get('RESEND_API_KEY') === 'test-stub') return { ok: true };`
  2. Build body: `{ from: FROM, to: [params.to], subject: 'LeanShot affiliate application received', html: renderApplicationReceived(params), text: renderApplicationReceivedText(params) }` (subject from UI-SPEC §"Resend transactional emails" row 1).
  3. POST to `https://api.resend.com/emails` with headers `{ Authorization: \`Bearer ${Deno.env.get('RESEND_API_KEY')}\`, 'Content-Type': 'application/json' }`.
  4. On non-2xx: `return { ok: false, error: \`resend_${res.status}\` };` — DO NOT echo `res.text()` (V7).
  5. On success: `return { ok: true };`.
- Error catch: `console.error('[affiliate-apply] resend dispatch failed', err instanceof Error ? err.message : 'unknown'); return { ok: false, error: 'resend_network' };`.

**File 3 — `supabase/functions/affiliate-apply/templates.ts`**:
- Export `renderApplicationReceived({ name }: { name: string }): string` — returns HTML email body per UI-SPEC §"Resend transactional emails" row 1: subject already locked in resend.ts; HTML opening "Thanks for applying to the LeanShot affiliate program. We'll review within 3-5 business days and email you with next steps."
- Export `renderApplicationReceivedText({ name }: { name: string }): string` — plain-text fallback for clients without HTML rendering.
- Body structure clones `clinic-invite/template-clinic-invite.ts` (inline styles, Phase 13 v2 brand color tokens hardcoded as hex for email rendering — these are NOT app-side tokens; email clients don't read CSS variables).
- Use `cream #f2ede0` background, `teal-700 #1b4842` brand color, Geist or system-ui fallback for body, Fraunces fallback for heading.
- Footer: "Reply to this email if you have questions. — Team LeanShot".

**File 4 — `supabase/functions/affiliate-apply/index.test.ts`** (Deno test, mocked admin; Resend via test-stub):
- T1: missing fields → 400 (or whatever existing error code lead-capture uses).
- T2: invalid email → 400.
- T3: honeypot non-empty → 200 `{ ok: true }` (silent), NO DB insert, NO email sent.
- T4: valid input + new email + `RESEND_API_KEY=test-stub` → INSERT called, resend returns ok via stub, response `{ ok: true }`.
- T5: already-existing pending application → 200 `{ already_applied: true }`, no INSERT, no email.
- T6: rate-limit exceeded (6th request from same IP /24 in 15 min) → 429.

**File 5 — `supabase/functions/affiliate-apply/deno.json`**: minimal `{ "imports": {} }`.

**File 6 — `supabase/config.toml`** (APPEND a new block AT THE END OF THE FILE — order matters; Plan 19-03 already added its blocks per Wave 2 sequencing chain BL-4):
```
[functions.affiliate-apply]
verify_jwt = false  # Public apply form endpoint
```

**File 7 — `/Users/karstenhaldan/minisite/leanshot/src/components/ui/InitialsAvatar.tsx`** (per UI-SPEC §"New Primitive" + PATTERNS.md §C.18):
- Export `InitialsAvatarProps` interface: `{ name: string; size?: 'sm' | 'md' | 'lg'; rounded?: 'card' | 'full'; className?: string }` (DO NOT add a 4th size — UI-checker traps `>4 sizes` per [[reference-ui-checker-dimension-traps]]).
- Export `hashStringToHue(s: string): number` — pure function: `let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360;`.
- Component renders a div with:
  - Size classes via lookup `SIZE_CLASSES[size]`: sm=`'w-10 h-10 text-lg'`, md=`'w-20 h-20 text-3xl'`, lg=`'w-[120px] h-[120px] md:w-[200px] md:h-[200px] text-5xl md:text-display'`.
  - `style={{ background: \`linear-gradient(135deg, hsl(${hue}, 65%, 55%) 0%, hsl(${(hue+30)%360}, 65%, 45%) 100%)\` }}`.
  - Rounded class: `rounded === 'full' ? 'rounded-full' : 'rounded-card'`.
  - Display first letter of `name.trim().charAt(0).toUpperCase() || '?'`.
  - `role="img"`, `aria-label={`Avatar for ${name}`}`, `tabIndex={-1}` (not focusable).
  - Foreground color `text-white font-semibold font-[var(--font-display)]` (Fraunces, already loaded — UI-SPEC requirement).

**File 8 — `src/components/ui/__tests__/InitialsAvatar.test.tsx`** (vitest):
- T1: `hashStringToHue('Alice') === hashStringToHue('Alice')` (deterministic).
- T2: `hashStringToHue('Alice') !== hashStringToHue('Bob')` (most pairs differ).
- T3: empty name renders `'?'` placeholder.
- T4: `size='sm'` applies `w-10 h-10`; `size='lg'` applies `w-[120px]`.
- T5: `rounded='full'` applies `rounded-full`.
- T6: `role='img'` + `aria-label` set correctly.

**Constraints:**
- Edge Function imports via esm.sh / jsr / npm: URLs as needed ([[reference-supabase-edge-function-deploy]]).
- W-5: ZERO references to `npm:resend` or `esm.sh/resend` in any affiliate-apply file (`grep -c 'resend@\|npm:resend' supabase/functions/affiliate-apply/*.ts` must return 0).
- DO NOT introduce a new validation lib (zod/yup/etc.) — manual checks match project style.
- NEVER hardcode hex values in `InitialsAvatar.tsx` — `hsl(...)` is dynamic (NOT a token), and the white foreground uses Tailwind's `text-white` (default token).
- The InitialsAvatar size budget is 3 only (sm/md/lg) — DO NOT add `xl` or `2xl` per UI-checker rules.
- Commit with pathspec on this task's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && RESEND_API_KEY=test-stub deno test supabase/functions/affiliate-apply/index.test.ts --allow-env --allow-net && cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/components/ui/__tests__/InitialsAvatar.test.tsx --run && (grep -c 'npm:resend\|esm.sh/resend' /Users/karstenhaldan/minisite/supabase/functions/affiliate-apply/*.ts || true) | tee /tmp/19-05-resend-grep.txt && [ "$(cat /tmp/19-05-resend-grep.txt | tr -d '\n')" = "0" ] || (echo "W-5 FAIL — Resend SDK import found"; exit 1)</automated>
  </verify>
  <done>affiliate-apply Edge Function passes 6 Deno tests using direct-HTTPS Resend dispatcher (W-5 — no SDK); honeypot silently 200s; rate-limit returns 429; Resend test-stub mode confirmed. InitialsAvatar passes 6 vitest tests; deterministic hue; size lookup correct (3 sizes only); ARIA contract satisfied.</done>
</task>

<task type="auto">
  <name>Task 2: Build AffiliateApplyForm + AffiliateApplyPage + AdminAffiliatesScaffold + create route registry (NO App.tsx mutation — BL-4)</name>
  <files>/Users/karstenhaldan/minisite/leanshot/src/components/affiliate/AffiliateApplyForm.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/affiliate/AffiliateApplyPage.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/affiliate/__tests__/AffiliateApplyForm.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/admin/AdminAffiliatesScaffold.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/admin/__tests__/AdminAffiliatesScaffold.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/routes/affiliate-apply-routes.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md (§"/affiliate apply form" layout + §"/admin/affiliates" + Copywriting Contract — read every string)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§C.1 form analog + §C.2/C.3 admin scaffold pointer)
    /Users/karstenhaldan/minisite/leanshot/src/components/auth/SignUpForm.tsx (5-field public form analog)
    /Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/PageListView.tsx (admin-only list pattern)
    /Users/karstenhaldan/minisite/leanshot/src/components/ui/Card.tsx (Card span+padding+variant API)
    /Users/karstenhaldan/minisite/leanshot/src/components/ui/Pill.tsx (segmented control filter pattern)
    /Users/karstenhaldan/minisite/leanshot/src/components/ui/EmptyState.tsx (empty state primitive)
  </read_first>
  <acceptance_criteria>
    - `src/routes/affiliate-apply-routes.ts` exports `AFFILIATE_APPLY_ROUTES: RouteDescriptor[]` with two entries — `{ match: 'exact', path: '/affiliate', componentLoader: () => import('@/components/affiliate/AffiliateApplyPage') }` and `{ match: 'prefix', path: '/admin/affiliates', componentLoader: () => import('@/components/admin/AdminAffiliatesScaffold') }`.
    - The `RouteDescriptor` type is declared in this file and re-exported for Plan 19-09 to consume.
    - `AffiliateApplyForm.tsx` renders the 5 fields in the UI-SPEC §C.1 order; native `<select>` (no Combobox lib) for audience_type with exactly 6 options matching D-05.
    - `AdminAffiliatesScaffold.tsx` renders the read-only list with 5-pill filter + 6-column table including `<InitialsAvatar size="sm">` in the leading column.
    - **NO `src/App.tsx` modification in this plan.** Verify: `git diff src/App.tsx` returns empty after this plan ships.
    - 11 vitest tests pass.
  </acceptance_criteria>
  <action>
Two React surfaces + route registry. Tokens-only — no hardcoded hex, no new spacing/font tokens. **BL-4: NO App.tsx mutation.**

**File 1 — `src/routes/affiliate-apply-routes.ts`** (NEW — BL-4 route registry):
- Export type:
  ```
  export type RouteDescriptor =
    | { match: 'exact'; path: string; componentLoader: () => Promise<{ default: React.ComponentType }> }
    | { match: 'prefix'; path: string; componentLoader: () => Promise<{ default: React.ComponentType }> };
  ```
- Export const:
  ```
  export const AFFILIATE_APPLY_ROUTES: RouteDescriptor[] = [
    { match: 'exact', path: '/affiliate', componentLoader: () => import('@/components/affiliate/AffiliateApplyPage') },
    { match: 'prefix', path: '/admin/affiliates', componentLoader: () => import('@/components/admin/AdminAffiliatesScaffold') },
  ];
  ```
- This file is the ONLY thing in `src/routes/` for this plan; Plans 19-06 and 19-08 each create their own `*-routes.ts` files; Plan 19-09 imports all three and wires into App.tsx in a single Wave-5 task.

**File 2 — `AffiliateApplyForm.tsx`** (per UI-SPEC §C.1 + PATTERNS.md C.1):
- 5 fields IN ORDER: email, name, audience_size, audience_type, why_us — exact UI-SPEC copywriting (page heading "Apply to the LeanShot affiliate program", subhead "Earn $10 for every paid LeanShot subscription that comes from your audience. Manual review in 3-5 business days.", every field label + placeholder + validation message from §"/affiliate apply form").
- Use `<Card variant="default" padding="lg">` wrapping the form; form children use `gap-5` between fields.
- Email + name + why_us: existing `<Input>` primitive (textarea variant for why_us).
- Audience_size: `<Input type="number" min={0}>`.
- Audience_type: native `<select>` styled to match Input (UI-SPEC line 163 — explicitly forbids Combobox lib); options `Instagram · TikTok · YouTube · Newsletter · Coaching · Other` (exact strings).
- Why_us: `<textarea>` with live character counter `{count}/500` below; counter turns danger-tone when count > 500.
- Submit: `<Button variant="primary" size="lg" block aria-busy={submitting}>Submit application</Button>`; copy `Sending...` when loading.
- Per-field validation via `errors` state object; display below input in `text-[var(--color-danger)] text-xs` (UI-SPEC §Color §Semantic states).
- onSubmit: POST to `/functions/v1/affiliate-apply` with body `{ email, name, audience_size, audience_type, why_us, honeypot: '' }`; on 200 with `ok: true` → replace card body with success-state heading "Application received" + body "Thanks! We'll review your application in 3-5 business days and email you at {email}." + toast.
- On network error: toast "Couldn't send your application. Check your connection and try again."
- 4-sizes-per-surface budget (UI-SPEC §Typography): only `text-3xl` heading + `text-base` body + `text-sm` label + `text-xs` caption. NO additional sizes.

**File 3 — `AffiliateApplyPage.tsx`** (page wrapper):
- Container `<main className="max-w-[480px] mx-auto py-16 px-4 md:px-6">` per UI-SPEC §Layout.
- Top: inline brand logo + word-mark linking to `/`.
- Body: `<AffiliateApplyForm />`.
- Footer: `text-xs` link "Already approved? Sign in →" linking to `/login` or the existing sign-in route.
- Default-export the component (so the route-registry `componentLoader` `.default` resolves correctly).

**File 4 — `__tests__/AffiliateApplyForm.test.tsx`** (vitest + jsdom):
- T1: renders all 5 fields with correct labels.
- T2: invalid email shows error message below the field.
- T3: why_us > 500 chars shows counter-error + blocks submit.
- T4: valid form submit → fetch called with correct body shape.
- T5: 200 response → success-state heading replaces form body.
- T6: native `<select>` has exactly 6 options matching D-05 enum.

**File 5 — `AdminAffiliatesScaffold.tsx`** (per UI-SPEC §"/admin/affiliates"):
- Client-side guard: read user from store; if `!user || user.app_metadata?.role !== 'admin'` → render a forbidden state (heading "This area is for admins only" + link back to `/`). Guard returns early; no fetch fires.
- Top filter bar: `<Pill segmented>` with 5 options (`All / Pending / Approved / Rejected / Suspended` per CONTEXT D-06 + suspended state from Plan 19-01 schema check) + `<Badge count={N}>` per state.
- Table 6 columns: `email · display_name · audience_type · audience_size · status badge · applied_at` (UI-SPEC line 172).
- Data source: `supabase.from('affiliates').select('*').order('applied_at', { ascending: false }).limit(50)` — Plan 19-01 staff_all policy permits the read.
- Banner at bottom: "Showing first 50 — full pagination in Phase 22." (UI-SPEC line 174).
- Empty state: `<EmptyState>` with copy "No applications yet" + lucide `<Mail>` icon.
- Each row has `tabIndex={-1}` + TODO comment `// P22 ADMIN-06 will wire click handler` (UI-SPEC line 172).
- Use `<InitialsAvatar size="sm">` in the leading column of the table (UI-SPEC §"Used by" #5).
- Status badge mapping per UI-SPEC §Color §Semantic states (pending→warning, approved→success, rejected→danger, suspended→neutral).
- Default-export.
- 4-sizes-per-surface budget: `text-xl` heading + `text-sm` body + `text-xs` label + `text-[11px]` badge — match UI-SPEC.

**File 6 — `__tests__/AdminAffiliatesScaffold.test.tsx`**:
- T1: non-admin user → renders forbidden state, no data fetch.
- T2: admin user → fetches affiliates table; filter pills render with correct counts.
- T3: filter pill click → re-renders table with status filter applied.
- T4: empty result → EmptyState renders.
- T5: row contains 6 columns including InitialsAvatar.

**Constraints:**
- **DO NOT modify `src/App.tsx`** in this plan (BL-4). Plan 19-09 owns the App.tsx wiring.
- 4 sizes / 2 weights per surface (UI-SPEC). Verified by grep: in each new component file, `grep -E 'text-(xs|sm|base|lg|xl|2xl|3xl|4xl|display)' src/components/affiliate/AffiliateApplyForm.tsx | sort -u | wc -l` must be ≤ 4.
- Accent color used ONLY on primary CTAs + focus rings + KPI emphasis (UI-SPEC §Color accent reserved-for list); do NOT apply `var(--color-primary)` to body text or borders.
- Each new page is a separate lazy chunk (lazy via the registry's `componentLoader`); index.gz delta budget for this plan: ≤ 1 kB (per UI-SPEC §"Bundle Budget Awareness" line 497).
- NEVER use `s.user!` non-null assertion (project rule + [[reference-supabase-project]] item #9); use typed guard or early return.
- Commit with pathspec on this plan's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/components/affiliate src/components/admin --run && (git diff --quiet src/App.tsx || (echo "BL-4 FAIL — App.tsx was modified in this plan"; exit 1)) && echo "App.tsx untouched per BL-4"</automated>
  </verify>
  <done>ApplyForm + AdminAffiliatesScaffold pass 11 vitest tests; `affiliate-apply-routes.ts` exports the registry; `src/App.tsx` UNTOUCHED in this plan (BL-4 verified); non-admin users see forbidden state; AdminScaffold filter pills function correctly; no new sizes/tokens introduced; no `s.user!` assertions.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Anonymous visitor → /affiliate POST | Untrusted body crosses; honeypot + rate-limit + regex are the defenses |
| Authenticated admin → /admin/affiliates | Client-side gate is hint; RLS `is_staff()` policy is the enforcement |
| Edge Function → Resend (direct HTTPS) | Trusted via RESEND_API_KEY Function Secret; FROM domain pinned to noreply@app.leanshot.app; no SDK (W-5) reduces supply-chain surface |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-05-S | Spoofing | Bot floods /affiliate | mitigate | Honeypot field + IP /24 rate-limit 5/15min (cloned from lead-capture) |
| T-19-05-T | Tampering | Submit oversized why_us / XSS in name | mitigate | Server-side max-length checks + audience_type enum check; React auto-escapes name in admin table cells (V5) |
| T-19-05-R | Repudiation | Affiliate denies they applied | mitigate | `ip_signup` + `fingerprint_signup` + `applied_at` captured server-side at INSERT |
| T-19-05-I | Information Disclosure | Cross-tenant affiliate data leak | mitigate | RLS `pol_affiliates_staff_all` from Plan 19-01 requires `is_staff()`; client-side gate is depth-in-depth, not the primary defense |
| T-19-05-I | Information Disclosure | Resend error body leak | mitigate | resend.ts NEVER echoes `res.text()` per W-5 / clinic-invite pattern; only `{ ok: false, error: 'resend_<status>' }` |
| T-19-05-D | DoS | Email-spam by repeat applications | mitigate | Idempotency check on email → same response for duplicate (silent 200); rate-limit caps damage |
| T-19-05-E | Elevation of Privilege | Non-admin reaches /admin/affiliates | mitigate | RLS denies SELECT; client-side gate returns forbidden state; even if bypassed, no data visible |
| T-19-05-PSV | Privacy (Resend leak) | Email sent to wrong address (typo) | accept | User-controlled input; bounce handled by Resend; we log only event ids, never email content |
</threat_model>

<verification>
- 6 Deno tests for affiliate-apply pass (honeypot, rate-limit, idempotency, Resend mocked via test-stub)
- 6 vitest tests for InitialsAvatar pass (deterministic hue, size variants, ARIA contract)
- 6 vitest tests for AffiliateApplyForm pass (validation, submit, success state)
- 5 vitest tests for AdminAffiliatesScaffold pass (gate, filter, empty state)
- `src/routes/affiliate-apply-routes.ts` registry created; App.tsx UNTOUCHED in this plan (BL-4)
- 4-sizes-per-surface budget green; no new tokens introduced; no `s.user!` assertions
- W-5 verified: zero `npm:resend` / `esm.sh/resend` imports in affiliate-apply
</verification>

<success_criteria>
- Anonymous visitor at `/affiliate` (once Plan 19-09 wires the App.tsx route) submits valid form → receives Resend email within 30s; `affiliates` row created with `status='pending'`
- Honeypot non-empty → 200 silent (no DB row, no email)
- 6th request from same IP /24 in 15min → 429
- Admin at `/admin/affiliates` sees the application; filter pills toggle status filter; row count badges accurate
- Non-admin sees forbidden state; no data fetched (verified in vitest)
- Bundle index ≤ ~22 kB gz (≤ +1 kB delta vs pre-plan baseline)
- W-5: Resend dispatch uses direct HTTPS (zero `npm:resend` imports)
</success_criteria>

<output>
After completion, create `19-05-SUMMARY.md`: Resend pattern confirmed (W-5 — direct HTTPS, no SDK); ip+fingerprint capture confirmed; InitialsAvatar use-site inventory (5 sites per UI-SPEC); route registry file path documented for Plan 19-09 consumption; bundle delta measurement; BL-4 note that App.tsx is UNTOUCHED by this plan.
</output>
