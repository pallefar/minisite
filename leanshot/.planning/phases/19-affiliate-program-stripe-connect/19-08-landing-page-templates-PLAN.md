---
phase: 19
plan: 8
type: execute
wave: 5
depends_on: [1, "6b"]
files_modified:
  - /Users/karstenhaldan/minisite/supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-impression/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-impression/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/affiliate-impression/deno.json
  - /Users/karstenhaldan/minisite/supabase/config.toml
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateCoach.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateStory.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateMethod.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/AffiliateLandingResolver.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/__tests__/LandingTemplateCoach.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/__tests__/LandingTemplateStory.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/components/landing/__tests__/LandingTemplateMethod.test.tsx
  - /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/impression.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/__tests__/impression.test.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts
  - /Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/__tests__/affiliate-templates.test.ts
  - /Users/karstenhaldan/minisite/leanshot/src/routes/landing-routes.ts
  - /Users/karstenhaldan/minisite/leanshot/scripts/seed-marketing-assets.sh
autonomous: false
requirements: [AFF-08, AFF-09, AFF-04]
tags: [page-builder, landing, templates, storage-seeding, impression-tracking, d-38, route-registry]
user_setup:
  - service: supabase-storage
    why: "Seed marketing-assets/v1/ Storage bucket with 8-12 admin-curated downloads (D-13/D-14)"
    dashboard_config:
      - task: "Upload logo SVG/PNG variants + banner ads + swipe-copy per UI-SPEC §D-14 (bucket creation is done by Plan 19-01 migration; this step only uploads files)"
        location: "Supabase Dashboard → Storage → Buckets → marketing-assets → v1/"

must_haves:
  truths:
    - "Migration seeds 3 admin-owned landing_pages template rows ('_template_coach', '_template_story', '_template_method') with flat-JSONB block trees per UI-SPEC"
    - "Page-builder catalog (templates.ts) exposes the 3 affiliate templates via the existing scaffoldFromTemplate helper (Phase 15 extension, not replacement)"
    - "LandingTemplateCoach/Story/Method components render the published landing page at /r/{code}/landing — consuming customization slots from the affiliate row via affiliates_public_view (created in Plan 19-01 per BL-3)"
    - "Marketing-assets Storage bucket seeded with 8-12 files per UI-SPEC §D-14; Plan 19-06b PartnerAssetsPage downloads via signed URL"
    - "BL-4 route registry: this plan creates src/routes/landing-routes.ts with /r/:code/landing entry; App.tsx wiring is owned by Plan 19-09"
    - "BL-8 / D-38 impression tracking: on /r/{code}/landing render, AffiliateLandingResolver fires a non-blocking insert into affiliate_impressions (server-readable client-side ping); honors Do-Not-Track + Sec-CH-* hints; IP truncated to /24 + UA hashed before insert"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql"
      provides: "3 landing_pages template rows (template_choice column + affiliates_public_view + RLS policy already shipped in 19-01)"
      contains: "_template_coach"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateCoach.tsx"
      provides: "coach template renderer (photo-forward, Calendly CTA)"
      contains: "InitialsAvatar"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/components/landing/AffiliateLandingResolver.tsx"
      provides: "Public route handler — fetches affiliate from affiliates_public_view, fires impression ping (D-38), routes to template renderer based on template_choice"
      contains: "affiliates_public_view"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/impression.ts"
      provides: "D-38 impression-insert helper — non-blocking client-side ping respecting DNT + Sec-CH-* hints; POSTs to affiliate-impression Edge Function"
      contains: "affiliate_impressions"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/affiliate-impression/index.ts"
      provides: "BL-9: server-side impression Edge Function — verify_jwt=false; rate-limited 10/min per IP /24; calls insert_affiliate_impression RPC (defined in Plan 19-01 per BL-10) which set_masklens IP to /24"
      contains: "insert_affiliate_impression"
    - path: "/Users/karstenhaldan/minisite/supabase/config.toml"
      provides: "BL-9: [functions.affiliate-impression] block (verify_jwt=false) appended to existing config.toml; chain after 19-06b's partner-profile-update append"
      contains: "affiliate-impression"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts"
      provides: "Extended template catalog including 'coach'/'story'/'method' affiliate templates"
      contains: "affiliate"
    - path: "/Users/karstenhaldan/minisite/leanshot/src/routes/landing-routes.ts"
      provides: "BL-4 route registry — /r/:code/landing descriptors consumed by App.tsx in Plan 19-09"
      contains: "AffiliateLandingResolver"
  key_links:
    - from: "/r/:code/landing route (wired by 19-09)"
      to: "AffiliateLandingResolver → LandingTemplateCoach|Story|Method"
      via: "affiliate.template_choice column (column lives in 19-01)"
      pattern: "template_choice"
    - from: "AffiliateLandingResolver mount"
      to: "affiliate_impressions table"
      via: "lib/affiliate/impression.ts non-blocking ping"
      pattern: "affiliate_impressions"
---

<objective>
Ship the 3 co-branded landing-page templates (`coach` / `story` / `method`) as Phase 15 page-builder template instances. Each template is a flat-JSONB block tree (Phase 15 PAGE-03 schema) rendered by 3 dedicated React components that read affiliate-customization slots from the `affiliates_public_view` (BL-3 — view created in Plan 19-01). Also seeds the `marketing-assets/v1/` Storage bucket (bucket DDL in Plan 19-01; this plan uploads the content) and ships the BL-8/D-38 impression-tracking client.

Purpose: AFF-09 (co-branded landing at `/r/{code}`) + AFF-08 forward-compat (D-38 impression table populated at v1.2 so v1.3 ratio detector has historical data). UI-SPEC §D-16 locks 3 variants (over the default-1 recommendation per `feedback_aggressive_foundations`). User customization fills slots — affiliates do NOT get full page-builder edit access (deferred to v1.3).

**Iter-1 revisions (2026-05-15):**
- **BL-3 stripped:** Removed `template_choice` column addition, `affiliates_public_view` definition, and `pol_affiliates_public_landing_read` policy from this plan. All three now live in Plan 19-01 (so 19-08 has a clean Wave-2 dep on 19-01 only — no circular schema ownership). Migration `20270101000009` shrinks to ONLY the 3 template seed rows.
- **BL-8 / D-38 added:** Ships `src/lib/affiliate/impression.ts` (non-blocking client-side ping) + the impression-insert task in AffiliateLandingResolver. Honors DNT + Sec-CH-* hints. IP truncated to /24 client-side before any data leaves the browser; UA hashed via SubtleCrypto SHA-256 before insert. Schema for `affiliate_impressions` table created by Plan 19-01.
- **BL-4 route registry + NO App.tsx mutation:** Creates `src/routes/landing-routes.ts`. App.tsx is wired by Plan 19-09 only.
- **W-2 hedges resolved:** Removed "use whatever the library's actual shape is" + "verify whether Phase 14 webhook is on v19" — Stripe SDK is locked at v19 (Phase 14 lock confirmed via Plan 19-04 grep audit).

Output: 1 seed migration + 3 template renderer components + 1 resolver + 1 impression-client lib + 1 route registry + 6 vitest tests + page-builder templates.ts extension + Storage bucket seed checkpoint.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/HeroBlock.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/TestimonialBlock.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/FeatureGridBlock.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/CTABlock.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/FooterBlock.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/ui/InitialsAvatar.tsx

<interfaces>
From Phase 15 `src/lib/page-builder/templates.ts`: `scaffoldFromTemplate({ template, overrides })` returns a `BlockNode[]` tree. Existing templates list (5 from Phase 15) — extend with 3 affiliate templates.
From Phase 15 block components: consume `BlockNode.props` JSON.
UI-SPEC §"/r/{code}" template variant JSON examples (lines 220-254) — load-bearing for block tree shape.
UI-SPEC §"Used by InitialsAvatar" lines 286-293 — `coach` template uses lg size in hero; `story` + `method` use md size in attribution card.

**Schema dependency (from Plan 19-01):**
- `affiliates.template_choice` column with check ('coach','story','method') — DEFINED in 19-01 (BL-3).
- `public.affiliates_public_view` exposing 8 non-PII columns — DEFINED in 19-01 (BL-3).
- `public.affiliate_impressions` table — DEFINED in 19-01 (D-38).
- `pol_affiliates_public_landing_read` RLS policy — DEFINED in 19-01 (BL-3).

This plan reads + uses these; it does NOT define them.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration to seed 3 templates + extend page-builder templates.ts catalog</name>
  <files>/Users/karstenhaldan/minisite/supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql, /Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts, /Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/__tests__/affiliate-templates.test.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md (§"/r/{code} — 3 co-branded landing-page templates" lines 212-256 — block-tree JSON for each variant; §"Copywriting Contract" §"/r/{code} landing-page template defaults" lines 421-425)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§A.8 seed migration analog from `20260801000010_seed_system_roles_trigger.sql`)
    /Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts (existing 5 templates from Phase 15; locate the catalog export shape + scaffoldFromTemplate signature)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-01-schema-rls-tier-effective-PLAN.md (confirm template_choice + affiliates_public_view + impressions table are owned by 19-01, NOT this plan — BL-3 + BL-8 split)
  </read_first>
  <acceptance_criteria>
    - Migration `20270101000009_affiliate_landing_template_seeds.sql` contains ONLY 3 `INSERT INTO public.landing_pages` rows with slugs `_template_coach`, `_template_story`, `_template_method` (NO column additions, NO view definitions, NO RLS policies — those live in 19-01).
    - `psql -c "select count(*) from public.landing_pages where slug like '_template_%';"` returns 3.
    - `src/lib/page-builder/templates.ts` exports an extended catalog with 3 new affiliate entries; existing Phase 15 entries untouched.
    - `getAffiliateTemplates()` helper exported; returns array of 3 template descriptors with ids `['coach','story','method']`.
    - 6 vitest tests pass.
  </acceptance_criteria>
  <action>
Seed migration (3 rows only) + page-builder catalog extension. **NO schema changes** — column / view / policy ownership is Plan 19-01 (BL-3).

**File 1 — `supabase/migrations/20270101000009_affiliate_landing_template_seeds.sql`**:
- HEADER COMMENT: "D-16 (3 template variants — user override on default-1 per feedback_aggressive_foundations) + D-17 (templates are Phase 15 page-builder instances). BL-3 revision (2026-05-15): template_choice column + affiliates_public_view + pol_affiliates_public_landing_read live in Plan 19-01 migration. This migration ONLY seeds the 3 template rows in landing_pages."
- Body — 3 INSERTs with `on conflict (slug) do update`:
  ```
  insert into public.landing_pages (slug, title, description, blocks, is_published)
  values
    ('_template_coach', 'Affiliate template — Coach',
       'Photo-forward affiliate landing page',
       '{ "version": 1, "template": "coach", "blocks": [<block tree per UI-SPEC §coach>] }'::jsonb,
       false),
    ('_template_story', 'Affiliate template — Story',
       'Testimonial-forward affiliate landing page',
       '{ "version": 1, "template": "story", "blocks": [<block tree per UI-SPEC §story>] }'::jsonb,
       false),
    ('_template_method', 'Affiliate template — Method',
       'Benefits-list-forward affiliate landing page',
       '{ "version": 1, "template": "method", "blocks": [<block tree per UI-SPEC §method>] }'::jsonb,
       false)
  on conflict (slug) do update
    set blocks = excluded.blocks, updated_at = now();
  ```
- Block-tree JSON for each template follows UI-SPEC §"/r/{code}" lines 220-254 exactly. Each block has `id`, `type`, `props` with `{{slot_name}}` bindings for affiliate customization fields. Use Phase 15 `BlockNode` schema — verify column shape from `landing_pages` table in `20261101000002_page_builder_tables.sql`.
- Required slot bindings per UI-SPEC §D-18: `{{display_name}}`, `{{photo_path}}`, `{{blurb}}`, `{{calendly_url}}` (with `showIf: 'calendly_url'`), `{{testimonial_quote}}` (story-only), `{{referral_code}}` (CTA href).

**File 2 — `src/lib/page-builder/templates.ts` MODIFY**:
- Read the existing catalog data structure (likely an exported const array of template descriptors with `{ id, label, description, blocks }`).
- Add 3 entries: `{ id: 'coach', label: 'The coach', description: 'Photo-forward + Calendly', category: 'affiliate', blocks: [...] }` and same for story/method. Use exact UI-SPEC block trees (mirror the SQL seed JSON above for the in-code catalog).
- DO NOT modify any existing Phase 15 entries.
- Export a typed helper `getAffiliateTemplates(): TemplateDescriptor[]` returning the 3 affiliate templates (used by Plan 19-06b PartnerTemplatePicker).
- The Phase 15 `scaffoldFromTemplate({ template, overrides })` helper is data-driven over the catalog — adding to the catalog is sufficient; no helper modification needed.

**File 3 — `src/lib/page-builder/__tests__/affiliate-templates.test.ts`** (vitest):
- T1: `getAffiliateTemplates()` returns exactly 3 templates with ids `['coach','story','method']`.
- T2: Each template's blocks array contains at minimum a Hero, CTA, Footer block.
- T3: The `coach` template's Hero block references `{{display_name}}` + `{{photo_path}}` + `{{calendly_url}}` slots.
- T4: The `story` template's Hero contains `{{testimonial_quote}}` slot.
- T5: The `method` template Hero does NOT reference `{{photo_path}}` (no above-the-fold photo per UI-SPEC).
- T6: Calling `scaffoldFromTemplate({ template: 'coach', overrides: { display_name: 'Jane' } })` returns a BlockNode tree where `{{display_name}}` is REPLACED with 'Jane' in the Hero block.

**Constraints:**
- DO NOT change the `landing_pages` table shape.
- DO NOT add columns to `affiliates` — `template_choice` lives in Plan 19-01 (BL-3).
- DO NOT define `affiliates_public_view` — Plan 19-01 owns it (BL-3).
- DO NOT add Storage RLS policies — Plan 19-01 owns the marketing-assets bucket DDL (or it ships in Plan 19-08 Task 1 if Phase 13 hasn't already created the bucket; verify via `grep -rn "marketing-assets" supabase/migrations/`).
- Idempotent: re-running the migration must not error (use `on conflict`).
- Commit with pathspec on this task's files only.

**Note on marketing-assets bucket:** The `affiliate_impressions` table + RLS lives in Plan 19-01. The `marketing-assets` Storage bucket DDL — verify via `grep -rn 'storage.buckets.*marketing-assets' supabase/migrations/` whether it already exists. If NOT, add a small `create bucket` block to this migration file (clone `20261101000008_page_assets_bucket.sql` pattern). If YES, the bucket creation is skipped and only the seed uploads happen in Task 3.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && supabase db reset --local && psql "$LOCAL_DB_URL" -c "select count(*) from public.landing_pages where slug like '_template_%';" | grep -E '^\s+3\s*$' && cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/lib/page-builder/__tests__/affiliate-templates.test.ts --run</automated>
  </verify>
  <done>Migration seeds exactly 3 template rows; templates.ts catalog exposes 3 affiliate templates; 6 vitest tests pass; scaffoldFromTemplate works for new templates; NO schema column / view / policy changes in this plan.</done>
</task>

<task type="auto">
  <name>Task 2 (BL-8 / D-38): Build impression-tracking client lib + non-blocking ping helper</name>
  <files>/Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/impression.ts, /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/__tests__/impression.test.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md (D-38 — full lock for impression tracking: non-blocking, DNT honor, IP /24 + UA hash, no detector at v1.2)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-01-schema-rls-tier-effective-PLAN.md (affiliate_impressions table schema: id, affiliate_id fk, ip_24 inet, ua_hash text, referer text, created_at)
    /Users/karstenhaldan/minisite/leanshot/src/lib/affiliate/api.ts (supabase-js client patterns from 19-06a)
  </read_first>
  <acceptance_criteria>
    - `supabase/functions/affiliate-impression/index.ts` exists, public (`verify_jwt=false` in config.toml), POST-only, rate-limited 10/min per source IP /24.
    - Edge Function validates body shape `{ affiliate_id: uuid, ua_hash: 64-char hex, referer: string ≤500ch }` and confirms the affiliate row exists with `status='approved'` (silent 200 on unknown — no enumeration).
    - Server-side IP truncation: Edge Function calls `admin.rpc('insert_affiliate_impression', { p_affiliate_id, p_ip, p_ua_hash, p_referer })` — the SQL helper (defined in Plan 19-01 per BL-10) does `set_masklen(p_ip::inet, 24)` and the INSERT.
    - `src/lib/affiliate/impression.ts` exports `async function recordImpression(affiliateId: string): Promise<void>` — fire-and-forget; the caller `void recordImpression(...)` and never awaits.
    - `recordImpression` honors Do-Not-Track: if `navigator.doNotTrack === '1'`, returns immediately without firing fetch.
    - UA hash computed client-side via `crypto.subtle.digest('SHA-256', new TextEncoder().encode(navigator.userAgent))` → 64-char hex. `referer = document.referrer ?? ''`.
    - Client `fetch('/functions/v1/affiliate-impression', { method: 'POST', ... }).catch(() => undefined)` — any failure silent; impression must NEVER throw or block landing render.
    - 4 vitest tests + 3 Deno tests pass (see action body for the test cases).
  </acceptance_criteria>
  <action>
**Architecture (final, locked):** Client → fire-and-forget POST → `affiliate-impression` Edge Function → `admin.rpc('insert_affiliate_impression', …)` → SQL helper truncates IP via `set_masklen` and INSERTs into `affiliate_impressions`. The SQL helper is defined in Plan 19-01 migration 5a per BL-10. The client never holds an IP; the Edge Function reads it from `x-forwarded-for` and passes raw to the SQL helper which truncates server-side.

**File 1 — `supabase/functions/affiliate-impression/index.ts`** (NEW — public, verify_jwt=false):
- Module: service-role admin client; in-memory rate-limit map (10/min per IP /24).
- Handler:
  1. Method POST only; else 405.
  2. Body parse: `{ affiliate_id, ua_hash, referer }`. Validate `affiliate_id` is UUID; `ua_hash` is 64-char hex (SHA-256 output); `referer` max 500 chars.
  3. Rate-limit by IP /24; on hit → 429.
  4. Confirm affiliate exists + status='approved' (cheap SELECT). On no row → 200 silent (don't reveal).
  5. Read raw client IP from `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0'`. Call `admin.rpc('insert_affiliate_impression', { p_affiliate_id, p_ip: raw_ip, p_ua_hash, p_referer })`. The SQL helper (Plan 19-01 migration 5a per BL-10) is SECURITY DEFINER and does the `set_masklen(p_ip::inet, 24)` + INSERT atomically. Service role only — `grant execute on function public.insert_affiliate_impression(uuid, text, text, text) to service_role` (no anon/authenticated).
  6. Return 200 `{ ok: true }`.

**File 2 — `supabase/functions/affiliate-impression/index.test.ts`** (3 Deno tests):
- T1: method GET → 405.
- T2: valid body + approved affiliate → INSERT RPC called.
- T3: 11th request from same /24 in 60s → 429.

**File 3 — `supabase/functions/affiliate-impression/deno.json`**: minimal.

**File 4 — `supabase/config.toml`** APPEND (after 19-05's `[functions.affiliate-apply]` block — Wave 3 chain):
```
[functions.affiliate-impression]
verify_jwt = false  # Public impression ping; rate-limited
```

**File 5 — `src/lib/affiliate/impression.ts`** (client wrapper):
- Export `async function recordImpression(affiliateId: string): Promise<void>`:
  - If `typeof navigator !== 'undefined' && navigator.doNotTrack === '1'` → return immediately.
  - Compute `ua_hash`: `const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(navigator.userAgent ?? '')); const ua_hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');`
  - `await fetch('/functions/v1/affiliate-impression', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ affiliate_id: affiliateId, ua_hash, referer: document.referrer ?? '' }) }).catch(() => undefined);` — silent catch; impression failure must NEVER break the landing render.
  - This function is fire-and-forget; callers `void recordImpression(...)` and continue immediately.
- Export `function shouldRecordImpression(): boolean` — pure check of DNT for unit testing.

**File 6 — `src/lib/affiliate/__tests__/impression.test.ts`** (4 vitest tests):
- T1: `shouldRecordImpression()` returns false when `navigator.doNotTrack === '1'`.
- T2: `shouldRecordImpression()` returns true when DNT is unset.
- T3: `recordImpression('abc-uuid')` calls fetch with correct body shape (mock fetch).
- T4: `recordImpression` does NOT call fetch when DNT is set.

**Constraints:**
- Client-side IP is NOT available; server-side Edge Function does the /24 truncation via `set_masklen` inside the SQL helper.
- Plan 19-01 ships `public.insert_affiliate_impression(p_affiliate_id uuid, p_ip text, p_ua_hash text, p_referer text)` as migration 5a (BL-10 fix). This task depends on that helper.
- `crypto.subtle.digest` is async — call from inside `useEffect` in AffiliateLandingResolver (Task 3), not during render.
- DO NOT add a global rate-limit dependency (no Upstash, no in-DB rate-limit table) — in-memory map per Edge Function instance is sufficient at v1.2 scale.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/affiliate-impression/index.test.ts --allow-env --allow-net && cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/lib/affiliate/__tests__/impression.test.ts --run</automated>
  </verify>
  <done>affiliate-impression Edge Function inserts to affiliate_impressions via SQL helper (set_masklen for /24); rate-limited 10/min per /24; client wrapper honors DNT; impression failure is silent + non-blocking; 4 vitest + 3 Deno tests pass.</done>
</task>

<task type="auto">
  <name>Task 3: Build 3 template renderer components + AffiliateLandingResolver + route registry (NO App.tsx mutation)</name>
  <files>/Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateCoach.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateStory.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/landing/LandingTemplateMethod.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/landing/AffiliateLandingResolver.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/landing/__tests__/LandingTemplateCoach.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/landing/__tests__/LandingTemplateStory.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/components/landing/__tests__/LandingTemplateMethod.test.tsx, /Users/karstenhaldan/minisite/leanshot/src/routes/landing-routes.ts</files>
  <read_first>
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-UI-SPEC.md (§"/r/{code}" — coach/story/method full layouts + §Typography landing-page type budget lines 92-101 + §"Copywriting Contract" landing-page defaults lines 419-425)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (§C.15-C.17 landing renderer analogs — clone from Phase 15 HeroBlock/TestimonialBlock/FeatureGridBlock)
    /Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/HeroBlock.tsx
    /Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/TestimonialBlock.tsx
    /Users/karstenhaldan/minisite/leanshot/src/components/admin/pages/blocks/FeatureGridBlock.tsx
    /Users/karstenhaldan/minisite/leanshot/src/components/ui/InitialsAvatar.tsx (from Plan 19-05)
    /Users/karstenhaldan/minisite/leanshot/src/routes/affiliate-apply-routes.ts (from Plan 19-05 — RouteDescriptor type to re-import)
  </read_first>
  <acceptance_criteria>
    - 3 landing components default-export per template; consume props `{ affiliate: AffiliatePublicRow }` where `AffiliatePublicRow` matches the 8 columns of `affiliates_public_view`.
    - `AffiliateLandingResolver.tsx` reads `?code=` from path `/r/{code}/landing`, fetches via `supabase.from('affiliates_public_view').select('*').eq('referral_code', code).maybeSingle()`, fires `void recordImpression(affiliate.id)` on mount in useEffect, then dynamic-imports the matching `LandingTemplateCoach|Story|Method` based on `affiliate.template_choice`.
    - 404 view rendered when affiliate not found (status≠approved is filtered by the view's RLS).
    - 6+ vitest tests pass.
    - Each landing chunk ≤ 12 kB gz.
    - **NO `src/App.tsx` modification.**
    - `src/routes/landing-routes.ts` exports `LANDING_ROUTES: RouteDescriptor[]` with one entry pointing at `AffiliateLandingResolver`.
  </acceptance_criteria>
  <action>
3 React components rendering the templates + 1 resolver that does the fetch + impression-ping + template dispatch.

**File 1 — `LandingTemplateCoach.tsx`** (per UI-SPEC §"Template variant: coach"):
- Props: `{ affiliate: { id: string; display_name: string; photo_path: string | null; blurb: string; calendly_url: string | null; testimonial_quote: string | null; template_choice: 'coach' | 'story' | 'method'; referral_code: string } }`.
- Layout: split-screen hero (`grid md:grid-cols-2 gap-8 items-center`):
  - Left: photo OR `<InitialsAvatar name={display_name} size="lg" />` fallback (UI-SPEC D-19); on desktop 200px, on mobile 120px (via responsive Tailwind on InitialsAvatar).
  - Right: `<h1 className="text-display font-[var(--font-display)]">{display_name}</h1>` (Fraunces, UI-SPEC §Typography landing display=64px) + `<p className="text-lg">{blurb}</p>` + primary CTA `<a href={`/signup?aff=${referral_code}`} className="...">Start your free trial</a>` (UI-SPEC copy) + secondary CTA `<a href={calendly_url} target="_blank">Book a 1:1 with me</a>` (only when calendly_url is truthy).
- Below hero: value-prop feature grid (clone from FeatureGridBlock — UI-SPEC mentions `coach_value_props` — supply 3 hardcoded benefits as defaults: "Track every shot + side effect", "Built-in coach + AI insights", "Doctor-share view for clinic visits").
- Final CTA section: heading "Track your GLP-1 journey" + button "Start free trial" linking to `/signup?aff={referral_code}` (UI-SPEC).
- Footer: `text-sm` "Referred by {display_name}. LeanShot · Privacy · Terms" (UI-SPEC fineprint).
- Container: `<main className="max-w-[1200px] mx-auto px-4 md:px-8 py-12 md:py-16">`.
- 4 sizes/2 weights budget (UI-SPEC §Typography /r/{code}): `text-display` + `text-4xl` + `text-lg` + `text-sm` ONLY.

**File 2 — `LandingTemplateStory.tsx`** (per UI-SPEC §"Template variant: story"):
- Props: same shape; uses `testimonial_quote`.
- Hero: large pull-quote `<blockquote className="text-4xl italic font-[var(--font-display)]">"{testimonial_quote}"</blockquote>` followed by attribution `<div className="flex items-center gap-3"><InitialsAvatar name={display_name} size="md" /><span>{display_name}</span></div>` (UI-SPEC §"Template variant: story" — photo as 80px circle).
- Below: 3-card benefit grid (FeatureGrid analog with cols=3 — 3 hardcoded benefits).
- Final CTA section + footer same as coach template.
- 4 sizes budget: `text-4xl` + `text-lg` + `text-sm` + `text-xs` (no `text-display` since story uses Fraunces ITALIC on text-4xl per UI-SPEC).

**File 3 — `LandingTemplateMethod.tsx`** (per UI-SPEC §"Template variant: method"):
- Props: same shape (testimonial_quote unused).
- Hero NO photo: `<h1 className="text-4xl font-semibold">How I work with LeanShot</h1>` + 5-bullet value list (`<ul><li class="flex gap-2 text-lg"><Check className="size-5 text-[var(--color-primary)]" /> ...</li></ul>` using lucide Check icons; 5 hardcoded bullets representing "Why I recommend LeanShot").
- Below hero: smaller attribution card "Brought to you by {display_name}" with `<InitialsAvatar size="md">` to the side (UI-SPEC).
- Final CTA + footer same.
- 4 sizes budget: `text-4xl` + `text-lg` + `text-sm` + `text-xs`.

**File 4 — `AffiliateLandingResolver.tsx`** (resolver — fetch + impression + dispatch):
- Props: `{ code: string }` (passed from App.tsx wiring in Plan 19-09).
- On mount via `useEffect`:
  1. `const { data: affiliate } = await supabase.from('affiliates_public_view').select('*').eq('referral_code', code).maybeSingle();` (anon-callable per Plan 19-01 `pol_affiliates_public_landing_read`).
  2. If `!affiliate` → set state to 404.
  3. If `affiliate` → set state to the row.
  4. Fire `void recordImpression(affiliate.id)` (NON-BLOCKING; from Task 2's `impression.ts`).
- Render:
  - During loading: `<Skeleton />`.
  - On 404: `<NotFoundView />` (heading "This page isn't available." + link back to `/`).
  - On found: dynamic-import the matching template:
    ```
    const TemplateComponent = useMemo(() => {
      if (!affiliate) return null;
      return React.lazy(() => {
        switch (affiliate.template_choice) {
          case 'story': return import('./LandingTemplateStory');
          case 'method': return import('./LandingTemplateMethod');
          case 'coach':
          default: return import('./LandingTemplateCoach');
        }
      });
    }, [affiliate?.template_choice]);
    ```
  - Render `<Suspense fallback={<Skeleton />}><TemplateComponent affiliate={affiliate} /></Suspense>`.

**Files 5-7 — 3 vitest tests** (one per template + 1 resolver test merged):
- T1: renders with `display_name='Jane'`, `photo_path=null` → InitialsAvatar fallback visible; affiliate CTA href `/signup?aff={code}`.
- T2: with `photo_path='photos/jane.png'` → `<img>` renders with `src` containing Storage URL.
- T3: (coach only) without calendly_url → secondary CTA hidden.
- T4: (story only) renders pull-quote with exact text from `testimonial_quote`.
- T5: (method only) renders 5 bullet items without any `<img>` above the fold.
- T6: footer contains `Referred by {display_name}` text.
- Add a resolver test: T7: AffiliateLandingResolver mounts, calls supabase fetch + recordImpression, renders matching template based on template_choice mock (test all 3 branches).

**File 8 — `src/routes/landing-routes.ts`** (BL-4 — landing route registry):
- Re-import RouteDescriptor from affiliate-apply-routes:
  ```
  import type { RouteDescriptor } from './affiliate-apply-routes';
  export const LANDING_ROUTES: RouteDescriptor[] = [
    { match: 'prefix', path: '/r/', componentLoader: () => import('@/components/landing/AffiliateLandingResolver') },
  ];
  ```
- The `match: 'prefix'` resolves `/r/{code}/landing` to `AffiliateLandingResolver`. The resolver itself extracts `code` from `window.location.pathname.split('/')[2]` and the trailing `/landing` is the fixed suffix.
- Note for Plan 19-09: App.tsx must match `^/r/([a-z0-9-]+)/landing$` and pass the captured `code` as a prop to `<AffiliateLandingResolver code={...} />`. Document this in 19-09 wiring task.

**Constraints:**
- 4 sizes / 2 weights per template surface (UI-SPEC).
- NO hardcoded hex colors; only `var(--color-*)` tokens.
- Tables and gradients use existing primitives — DO NOT introduce new ones.
- Photo upload preview MUST use `<img className="aspect-square object-cover" />` per UI-SPEC D-20 (Storage transforms deferred).
- `/r/:code/landing` route is the public landing render (no JWT); affiliate lookup uses the anon client via `affiliates_public_view` (Plan 19-01 owns the view's anon-readable RLS).
- Each landing template is a separate lazy chunk (≤ 12 kB gz each).
- **NO `src/App.tsx` modification** (BL-4 — Plan 19-09 owns wiring).
- Commit with pathspec on this plan's files only.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && npm run test -- src/components/landing --run && npm run build && du -b dist/assets/LandingTemplate*-*.js.gz 2>/dev/null | awk '{ if ($1 > 12288) { print "CHUNK OVER 12KB GZ — FAIL: " $0; exit 1 } else print "chunk OK: " $2 ": " $1 " bytes" }' && (git diff --quiet src/App.tsx || (echo "BL-4 FAIL"; exit 1))</automated>
  </verify>
  <done>3 landing templates render correctly with affiliate customization; AffiliateLandingResolver fetches affiliate + fires impression-ping + dispatches by template_choice; InitialsAvatar fallback works; lazy-loaded chunks ≤ 12 kB gz each; 7+ vitest tests pass; `src/routes/landing-routes.ts` registry created; `src/App.tsx` UNTOUCHED.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Seed marketing-assets Storage bucket with 8-12 admin assets (D-13/D-14)</name>
  <what-built>
    Storage bucket `marketing-assets` exists (created in Plan 19-08 Task 1 OR Plan 19-01 depending on where the bucket DDL landed). Bucket needs to be populated with the asset set per UI-SPEC §D-14: logo variants (SVG + 200×200 PNG + 1200×1200 PNG), banner ads (728×90, 300×250, 1080×1080 — 3 each), swipe-copy email template (.txt), swipe-copy social post (.txt).
  </what-built>
  <how-to-verify>
1. Author + run `/Users/karstenhaldan/minisite/leanshot/scripts/seed-marketing-assets.sh` containing:
   ```
   #!/usr/bin/env bash
   set -euo pipefail
   PROJECT_REF="ytnsipxxmzgaebkqmokp"
   # List bucket contents
   supabase storage ls "ss:///marketing-assets/v1/" --linked 2>&1 || (echo "FAIL — bucket access denied or v1/ prefix empty"; exit 1)
   # Expected files: at least 8 entries
   count=$(supabase storage ls "ss:///marketing-assets/v1/" --linked 2>&1 | wc -l)
   if [ "$count" -lt 8 ]; then
     echo "Need to upload assets. Use: supabase storage upload ss:///marketing-assets/v1/<file> <local-path> --linked"
     echo "Required set per UI-SPEC §D-14:"
     echo "  - logo.svg, logo-200.png, logo-1200.png (transparent + on-brand-bg variants)"
     echo "  - banner-728x90.png, banner-300x250.png, banner-1080x1080.png (3 variants)"
     echo "  - explainer-video-link.txt (YouTube/Vimeo URL)"
     echo "  - swipe-copy-email.txt"
     echo "  - swipe-copy-social.txt"
     exit 1
   fi
   echo "MARKETING-ASSETS SEEDED — $count files in v1/"
   ```
2. If FAILs with empty bucket: the upload steps are CLI-driven (per [[feedback-cli-over-paste-back]]):
   - Source assets: from `/Users/karstenhaldan/minisite/leanshot/.planning/design-system/` if Phase 13 has produced logo/banner artwork, OR ask the user to provide source SVG/PNG files.
   - Upload: `supabase storage upload ss:///marketing-assets/v1/logo.svg ./path/to/logo.svg --linked` (one call per file).
   - Swipe-copy text: author the `.txt` files in `/tmp/` then upload — content is short marketing copy referencing LeanShot's value props.
3. Re-run smoke; should print `MARKETING-ASSETS SEEDED — N files in v1/`.

EXPECTED ASSETS (8 minimum):
- `logo.svg`, `logo-200.png`, `logo-1200.png`
- `banner-728x90.png`, `banner-300x250.png`, `banner-1080x1080.png`
- `swipe-copy-email.txt`, `swipe-copy-social.txt`
(`explainer-video-link.txt` may point to a placeholder if no video yet — but file must exist.)
  </how-to-verify>
  <resume-signal>Type "marketing-assets-seeded" or describe issues</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Anon visitor → /r/{code}/landing | Untrusted; reads via affiliates_public_view restricted to status='approved' (Plan 19-01) |
| Anon visitor → marketing-assets bucket | Read-only via signed URLs (1h TTL); writes require is_staff |
| Anon visitor → affiliate-impression Edge Function (D-38) | Untrusted; rate-limited 10/min per /24; affiliate_id existence + status='approved' checked server-side |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-08-S | Spoofing | Visitor reaches /r/{code}/landing for rejected affiliate | mitigate | affiliates_public_view filters `status='approved'` (Plan 19-01); rejected affiliates → 404 view |
| T-19-08-T | Tampering | XSS via display_name with `<script>` injection | mitigate | React auto-escapes string children; testimonial_quote/blurb pass through same escape; no `dangerouslySetInnerHTML` anywhere in templates (V5) |
| T-19-08-T | Tampering | Affiliate changes template_choice to invalid value | mitigate | Column CHECK constraint `in ('coach','story','method')` (Plan 19-01); partner-profile-update Edge Function enforces same allowlist (Plan 19-06b) |
| T-19-08-T | Tampering | Impression-stuffing for fake baselines | mitigate | Rate-limit 10/min per /24 in affiliate-impression Edge Function; DNT honor; affiliate.status='approved' check before insert |
| T-19-08-I | Information Disclosure | Public landing page leaks affiliate email/IP | mitigate | affiliates_public_view exposes ONLY display_name/photo_path/blurb/calendly_url/testimonial_quote/template_choice/referral_code/id — NO PII columns (Plan 19-01 BL-3) |
| T-19-08-I | Information Disclosure | Marketing-assets bucket exposes unreleased branding | mitigate | Authenticated-only SELECT policy; 1h signed URL TTL; admin manages content |
| T-19-08-I | Information Disclosure | Raw UA + IP captured in impressions | mitigate | UA SHA-256-hashed client-side; IP /24-truncated server-side via set_masklen; raw values never stored (D-38) |
| T-19-08-D | DoS | Page bloat from 1200×1200 logo image | mitigate | Browser-side lazy `<img loading="lazy">` for below-fold images |
| T-19-08-E | Elevation of Privilege | Affiliate writes seed template rows | mitigate | landing_pages RLS from Phase 15 requires is_staff() for templates; affiliate's own page row is separate |
</threat_model>

<verification>
- Task 1: Migration seeds 3 template rows only (NO column / view / policy changes — BL-3 split); templates.ts has 3 affiliate entries; 6 vitest tests pass
- Task 2: affiliate-impression Edge Function inserts via SQL helper with /24 truncation; client wrapper honors DNT; 7 tests pass
- Task 3: 3 LandingTemplate components render with InitialsAvatar fallback; AffiliateLandingResolver fetches via affiliates_public_view; impression fires on mount; each chunk ≤ 12 kB gz; 7+ vitest tests pass; `src/App.tsx` UNTOUCHED
- Task 4 [checkpoint]: marketing-assets bucket has ≥ 8 files in v1/ prefix
- No XSS path through display_name / blurb / testimonial_quote (React auto-escape)
- 4 sizes / 2 weights per landing surface
</verification>

<success_criteria>
- Visitor at `https://leanshot.app/r/coachjane/landing` (after `/r/coachjane` cookie-set redirect) sees the coach/story/method template that the affiliate selected
- InitialsAvatar fallback renders deterministically when photo_path is null
- All CTAs link to `/signup?aff={referral_code}` so attribution survives via cookie + URL param
- /r/{code}/landing for rejected/suspended affiliates returns 404 (RLS view filter from Plan 19-01)
- marketing-assets bucket seeded; Plan 19-06b PartnerAssetsPage downloads work via signed URL
- Three landing chunks each ≤ 12 kB gz; index chunk unchanged
- **D-38 forward-compat:** affiliate_impressions rows accumulate from v1.2 ship-date; v1.3 ratio detector has historical baseline
</success_criteria>

<output>
After completion, create `19-08-SUMMARY.md`: 3 templates' block-tree JSON committed inline; impression-tracking architecture (client → Edge Function → SQL helper for /24 truncation); marketing-assets seeded count; chunk sizes; XSS auto-escape audit notes; route registry path for 19-09 consumption; BL-3 split clarification (column / view / policy ownership lives in 19-01); BL-4 note that App.tsx is UNTOUCHED; flag the affiliate-impression Edge Function for Plan 19-09's deploy list.
</output>
