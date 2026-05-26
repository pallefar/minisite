---
phase: 60-rag-knowledge-base-completion-waves-2-4
fixed_at: 2026-05-26T15:00:00Z
review_path: leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 60: Code Review Fix Report

**Fixed at:** 2026-05-26T15:00:00Z
**Source review:** leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (4 Critical + 4 Warning)
- Fixed: 8
- Skipped: 0

Info-level findings (IN-01, IN-02) were out of scope per `fix_scope: critical_warning`.

---

## Fixed Issues

### CR-01: DOMPurify hook registered via addHook() — T-60-13-XSS-1 now enforced

**Files modified:** `leanshot/src/lib/rag/sanitize.ts`
**Commit:** `afd3709a`
**Applied fix:** Removed the dead `HOOK: 'afterSanitizeAttributes'` and `afterSanitizeAttributes(node)` keys from the DOMPurify config object (which are silently ignored by DOMPurify). Replaced with a module-level `_hookRegistered` guard and `DOMPurify.addHook('afterSanitizeAttributes', ...)` call that runs once on first sanitize. The hook forces `target=_blank` + `rel='noopener noreferrer'` on all `<a>` elements and additionally strips non-http(s) hrefs, matching the stated T-60-13-XSS-1 invariant.

---

### CR-02: `stripControlChars` regex now strips actual control characters

**Files modified:** `leanshot/src/lib/knowledge/api.ts`
**Commit:** `27bb80bf`
**Applied fix:** The file contained binary bytes that rendered as `/[ --]/g` but were actually `/[\x00-\x1f...]/g` with a malformed range (bytes `0x00-0x1f 0x7f-0xc2 0x9f`). Replaced with the correct ASCII-safe escape form `/[\x00-\x1F\x7F]/g` using Python binary replacement. Verified: `'GLP-1 side effects'` passes through unchanged; `'\x00\x01\x1f'` are stripped; spaces, hyphens, and printable punctuation are preserved.

---

### CR-03: Vendor string aligned to canonical `'anthropic_summary'` across all callers

**Files modified:** `supabase/functions/rag-cost-query/index.ts`, `leanshot/src/lib/admin/rag/cost-api.ts`, `leanshot/src/components/admin/rag/RagCostPage.tsx`, `leanshot/src/components/admin/rag/__tests__/RagCostPage.test.tsx`
**Commit:** `62766294`
**Applied fix:** Four files used `'anthropic_summarize'` (with trailing `e`) while the DB `rag_vendor` enum and the emitter use `'anthropic_summary'`. Updated all four to use `'anthropic_summary'`. The migration comment in `20281201000011_rag_budget_caps.sql` references the old string in a comment only — left as-is (doc-only, non-functional).

---

### CR-04: Constant-time service-role-key comparison in rag-retrieve eval-sweep mode

**Files modified:** `supabase/functions/rag-retrieve/index.ts`
**Commit:** `f9433e3b`
**Applied fix:** Added `import { constantTimeEqual } from '../_shared/newsletter-token.ts'`. Replaced the short-circuit `!== serviceRoleKey` comparison with `!constantTimeEqual(presented, serviceRoleKey)`. Also fixed the Bearer token extraction from case-sensitive `replace('Bearer ', '')` to `slice(7)` with a `startsWith` guard, which is more robust to whitespace and case variants.

---

### WR-01: `vendor` field added to `$ai_generation` events in embed and rerank pipelines

**Files modified:** `supabase/functions/rag-embed-approved/index.ts`, `supabase/functions/rag-retrieve/index.ts`
**Commit:** `7a8d04a6`
**Applied fix:**
- `rag-embed-approved/index.ts`: added `vendor: 'openai_embed'` to the `_emitAiGeneration` properties object in `buildProdDeps()`.
- `rag-retrieve/index.ts` embed emit (line ~180): added `vendor: 'openai_embed'`.
- `rag-retrieve/index.ts` rerank emit (line ~278): added `vendor: provider === 'cohere' ? 'cohere_rerank' : 'jina_rerank'`.

The cost dashboard's HogQL query filters `WHERE properties.vendor = {vendor:String}` — without this field, three of the four vendor cost cards returned empty data.

---

### WR-02: Newsletter sender refuses to send when CAN-SPAM address unset or placeholder

**Files modified:** `supabase/functions/rag-newsletter-sender/index.ts`
**Commit:** `e076f9f7`
**Applied fix:** Changed `footerAddress` to read from `deps?.footerAddress ?? Deno.env.get('NEWSLETTER_PHYSICAL_ADDRESS') ?? null`. Added a pre-flight guard immediately after the env block: if `!footerAddress || footerAddress.startsWith('[')`, the function returns HTTP 503 with `{ error: 'can_spam_address_not_configured' }` and emits a Slack `regulatory` P1 alert. This prevents the Sunday 13:00 UTC cron from sending non-compliant email under 15 U.S.C. § 7704(a)(5).

**Operator action required:** Set `NEWSLETTER_PHYSICAL_ADDRESS` as a Supabase Function Secret before the first Sunday cron fires.

---

### WR-03: `newsletter_unsubscribed` telemetry uses `captureRagEvent` not `emitAiGeneration`

**Files modified:** `supabase/functions/rag-newsletter-unsubscribe-1click/index.ts`
**Commit:** `799e39e1`
**Applied fix:** Replaced `import { emitAiGeneration }` with `import { captureRagEvent } from '../_shared/posthog-server.ts'`. Replaced the `emitAiGeneration({ ... model: 'none', event_type: 'newsletter_unsubscribed' })` call with `captureRagEvent({ distinctId: userId, name: 'newsletter_unsubscribed', properties: { trace_id, via, was_rotation_update } })`. This emits a correctly-named custom event instead of polluting the `$ai_generation` LLM Analytics table with non-AI events.

---

### WR-04: Admin QueueDetailPane anchor sanitization now forces `target=_blank`

**Files modified:** `leanshot/src/components/admin/rag/QueueDetailPane.tsx`
**Commit:** `9bfc4765`
**Applied fix:** Added `ADD_ATTR: ['target', 'rel']` to `SANITIZE_CONFIG`. Added module-level `_adminHookRegistered` guard and `ensureAdminHook()` function that registers `DOMPurify.addHook('afterSanitizeAttributes', ...)` once per module load. The hook forces `target=_blank` + `rel='noopener noreferrer'` on all `<a>` elements. `ensureAdminHook()` is called at the top of the `sanitizedMarkdown` `useMemo` callback, ensuring the hook is registered before every sanitize pass.

---

## Skipped Issues

None. All 8 in-scope findings were successfully fixed.

---

_Fixed: 2026-05-26T15:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
