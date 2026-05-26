# Phase 61 — Validation Matrix

**Date:** 2026-05-26
**Plans:** 8
**Waves:** 0, 1, 2

Per-plan automated-verify commands (inline summary; plan-checker Dim 8e source).

## Per-Plan Verify Commands

| Plan | File | Verify Command | Asserts |
|------|------|----------------|---------|
| 61-01 | 61-01-db-tables-rls-PLAN.md | `cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20260526000001_protocol_tables.sql && test -f leanshot/src/types/protocols.ts && grep -q "create table.*public.protocols" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "auth.uid() = patient_id" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "public.is_staff()" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "on delete cascade" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "ProtocolReviewState" leanshot/src/types/protocols.ts && grep -q "AiAssistResponse" leanshot/src/types/protocols.ts && cd leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 \| grep -E "src/types/protocols\\.ts.*error" \| (! grep -q .)` | 6 tables; RLS uses is_staff(); patient table uses auth.uid(); ProtocolEvidence cascades on step delete; TS types compile |
| 61-01 | (same) | `grep -c "insert into public.protocols" supabase/migrations/20260526000003_protocol_seed_data.sql \| grep -vE "^0$" && grep -q "tirzepatide\\|retatrutide\\|ghrp-2" supabase/migrations/20260526000003_protocol_seed_data.sql && grep -q "on conflict" supabase/migrations/20260526000003_protocol_seed_data.sql` | 3 reference protocols seeded, idempotent ON CONFLICT |
| 61-02 | 61-02-secdef-rpcs-PLAN.md | `grep -c "create or replace function public\\." supabase/migrations/20260526000002_protocol_secdef_rpcs.sql \| grep -E "^7$" && grep -c "security definer" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql \| grep -E "^7$" && grep -q "SELF_REVIEW_REJECTED" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql && grep -cE "grant execute on function" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql \| grep -E "^7$" && grep -q "on conflict (patient_id, protocol_id)" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql && grep -q "date_trunc('day'" supabase/migrations/20260526000002_protocol_secdef_rpcs.sql` | 7 SECDEF RPCs; publish has SELF_REVIEW_REJECTED; assign uses ON CONFLICT; usage counter uses UTC-day truncation |
| 61-03 | 61-03-protocol-ai-assist-fn-PLAN.md | `cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts ../supabase/functions/protocol-ai-assist/__tests__/handler.test.ts` | 6 tests: 0-chunks refusal, PHARMA-02 carveout refusal, rate-limit 429, success path with vendor='openrouter_anthropic', placeholder-key 503+Slack, server-side refusal when model returned no cited_chunk_ids |
| 61-03 | (same) | `test -f supabase/functions/protocol-ai-assist/index.ts && grep -q "import.meta.main" supabase/functions/protocol-ai-assist/index.ts && grep -q "Deno.serve" supabase/functions/protocol-ai-assist/index.ts && grep -q "handleAiAssist" supabase/functions/protocol-ai-assist/index.ts && ! grep -q "Deno\\." supabase/functions/protocol-ai-assist/handler.ts` | Deno test top-level serve trap honored; handler.ts has no Deno.* references |
| 61-04 | 61-04-admin-core-ui-PLAN.md | `cd /Users/karstenhaldan/minisite/leanshot && grep -c "color-rose-soft" src/index.css \| grep -vE "^0$" && grep -q "key: 'protocols'" src/lib/admin/modules.ts && grep -q "admin/protocols/ProtocolsLayout" src/lib/admin/modules.ts && npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolStatusBadge.test.tsx src/components/admin/protocols/__tests__/ProtocolsListPage.test.tsx` | rose-soft @theme token added; protocols manifest entry registered; ProtocolStatusBadge + ProtocolsListPage unit tests green |
| 61-05 | 61-05-admin-editor-ui-PLAN.md | `cd /Users/karstenhaldan/minisite/leanshot && npx vitest run --config vite.config.ts src/components/admin/protocols/__tests__/ProtocolReviewBanner.test.tsx src/components/admin/protocols/__tests__/EvidenceSearchSheet.test.tsx src/components/admin/protocols/__tests__/AiAssistModal.test.tsx src/components/admin/protocols/__tests__/ProtocolEditorPage.test.tsx` | 4 test files; ≥11 cases including: Publish button ABSENT from DOM for author; reviewer sees Publish; SELF_REVIEW_REJECTED → correct toast copy; step removal uses undo Toast (not modal); editing published creates new version row INSERT |
| 61-06 | 61-06-clinic-adopt-flow-PLAN.md | `cd /Users/karstenhaldan/minisite/leanshot && grep -q "ClinicProtocolsPage" src/components/clinic/ClinicWorkspace.tsx && npx vitest run --config vite.config.ts src/components/clinic/protocols/__tests__/` | ClinicWorkspace nav extended; 3 test files green; AdoptDiffModal calls assign_protocol_to_patient RPC with expected args |
| 61-07 | 61-07-patient-kb-public-PLAN.md | `cd /Users/karstenhaldan/minisite/leanshot && grep -q "useActiveProtocolAssignment" src/components/dashboard/tabs/MedicationTab.tsx && grep -q "Protocol adherence" src/components/dashboard/tabs/BodyTab.tsx && grep -q "pathname.startsWith('/protocols')" src/App.tsx && npx vitest run --config vite.config.ts src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx src/components/protocols/__tests__/PublicProtocolPage.test.tsx` | MedicationTab + BodyTab extensions present; App.tsx selectView /protocols/* branch present; shortcode parser dedupe/UUID regex pass; PublicProtocolPage renders 404 EmptyState |
| 61-07 | (same — Task 4 KB wiring, revision iter-1 BLOCKER fix) | `grep -q "parseProtocolShortcodes" src/components/knowledge/KnowledgeArticleDetailPage.tsx && grep -q "ProtocolSummaryCard" src/components/knowledge/KnowledgeArticleDetailPage.tsx && npx vitest run --config vite.config.ts src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx` | KB renderer wires parseProtocolShortcodes; integration test asserts raw `[protocol:<uuid>]` token is ABSENT from DOM and ProtocolSummaryCard rendered inline (closes PROTOCOL-08 success criterion #6) |
| 61-08 | 61-08-close-out-PLAN.md | `cd /Users/karstenhaldan/minisite/leanshot && grep -q "^- \\[x\\] \\*\\*Phase 61:" .planning/ROADMAP.md && grep -q "completed_phases: 10" .planning/STATE.md && test -f .planning/phases/61-admin-protocol-creator/61-CARRY-OVER.md && test -f .planning/phases/61-admin-protocol-creator/61-SUMMARY.md` | ROADMAP flipped; STATE counters incremented; CARRY-OVER + SUMMARY present |

## Phase Requirement Coverage

| Req ID | Description | Plan(s) | Verify |
|--------|-------------|---------|--------|
| PROTOCOL-01 | Schema 6 tables + RLS + index + seed | 61-01 | grep on migration file structure + tsc on types |
| PROTOCOL-02 | Admin UI `/admin/protocols` — list + editor + step builder + evidence drawer + AI assist | 61-04, 61-05, 61-03 | Vitest suites for ListPage / EditorPage / EvidenceSheet / AiAssistModal / handler |
| PROTOCOL-03 | RAG retrieve integration for evidence search | 61-05 (EvidenceSearchSheet), 61-03 (Edge Fn) | Vitest mocks rag-retrieve invoke; handler.test.ts asserts ragRetrieve called |
| PROTOCOL-04 | 2-person review (SECDEF + UI DOM-removal) | 61-02 (RPC) + 61-05 (UI) | grep `SELF_REVIEW_REJECTED` in migration; Vitest `queryByText('Publish Protocol')` returns null for author |
| PROTOCOL-05 | Versioning + rollback | 61-01 (composite PK) + 61-02 (rollback RPC) + 61-05 (edit creates new version) | grep `rollback_protocol`; Vitest assertion on INSERT-new-row on edit-of-published |
| PROTOCOL-06 | Clinician adopt + patient prefill | 61-06 (clinic) + 61-07 (MedicationTab hook) | Vitest assert rpc('assign_protocol_to_patient'); useActiveProtocolAssignment hook used |
| PROTOCOL-07 | Patient dose-log deviation surfacing | 61-07 | MedicationTab grep + BodyTab grep |
| PROTOCOL-08 | KB shortcode → ProtocolSummaryCard inline in KB article | 61-07 | parseProtocolShortcodes tests; ProtocolSummaryCard renders; App.tsx /protocols/* route; KbProtocolShortcode.integration test asserts wired into KnowledgeArticleDetailPage (BLOCKER closed iter-1) |

## Source Coverage Audit

| Source | Item | Plan | Status |
|--------|------|------|--------|
| GOAL (ROADMAP §Phase 61) | Admin authoring tool — step-builder grid + RAG-evidence search drawer + AI-assist suggestions | 61-04, 61-05, 61-03 | COVERED |
| GOAL | 2-person review enforced via SECDEF | 61-02 + 61-05 | COVERED |
| GOAL | Versioning + rollback | 61-01 + 61-02 + 61-05 | COVERED |
| GOAL | Clinician adopt → patient prefill | 61-06 + 61-07 | COVERED |
| GOAL | Patient dose-log surfaces expected vs logged | 61-07 | COVERED |
| GOAL | KB inline protocol summary card with citation footnotes | 61-07 | COVERED |
| REQ | PROTOCOL-01..08 | as mapped above | COVERED |
| RESEARCH | OpenRouter substitution (anthropic/claude-sonnet-4-5 dotted) | 61-03 | COVERED |
| RESEARCH | handler.ts split from index.ts per D-60-05-01 | 61-03 | COVERED |
| RESEARCH | UTC-day rate limit boundary | 61-02 + 61-03 | COVERED |
| RESEARCH | Slug uniqueness via base_slug separation (Pitfall 2) | 61-01 | COVERED |
| RESEARCH | step_id ON DELETE CASCADE (Pitfall 6) | 61-01 | COVERED |
| RESEARCH | publish RPC SELF_REVIEW_REJECTED message detection (Pitfall 1) | 61-02 + 61-05 | COVERED |
| RESEARCH | selectView ordering /protocols/* AFTER /knowledge (Pitfall 7) | 61-07 | COVERED |
| CONTEXT D-CTX-01 | monitoring text[] not lookup | 61-01 | COVERED |
| CONTEXT | NO drag-and-drop in MVP | 61-05 (step rows have insert/remove only) | COVERED |
| CONTEXT | Author NEVER sees Publish button in DOM | 61-05 | COVERED |
| CONTEXT | Rate limit 50/day/admin | 61-02 + 61-03 | COVERED |
| CONTEXT | 3 reference protocols seeded (tirzepatide, retatrutide, ghrp-2) | 61-01 (seed migration) | COVERED |
| CONTEXT | GHRP-2 clinic-only audience | 61-01 (seed migration) | COVERED |
| CONTEXT | Banner copy "Pending review by another admin" | 61-05 (ProtocolReviewBanner test) | COVERED |
| CONTEXT | SELF_REVIEW_REJECTED → toast "Another admin must review this protocol before publish." | 61-05 (ProtocolEditorPage test) | COVERED |
| CONTEXT | AI-assist refusal copy "Suggestion blocked — no qualifying evidence in RAG." | 61-05 (AiAssistModal test) | COVERED |
| CONTEXT | Rate limit toast "AI assist limit reached for today. Resets at midnight UTC." | 61-05 (AiAssistModal test) | COVERED |
| CONTEXT | Vendor field 'openrouter_anthropic' in $ai_generation | 61-03 (handler test) | COVERED |

**No gaps identified. All source items mapped to plans with verify commands.**

## Phase Gate Command

Run after Plan 08 close-out to validate the entire phase before merge:

```bash
cd /Users/karstenhaldan/minisite/leanshot && \
  npx tsc -p tsconfig.app.json --noEmit && \
  npx vitest run --config vite.config.ts \
    src/components/admin/protocols/__tests__/ \
    src/components/clinic/protocols/__tests__/ \
    src/components/protocols/__tests__/ \
    src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts \
    ../supabase/functions/protocol-ai-assist/__tests__/handler.test.ts && \
  cd /Users/karstenhaldan/minisite && \
  supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp 2>&1 | grep -E "20260526" && \
  supabase functions list --project-ref ytnsipxxmzgaebkqmokp 2>&1 | grep -E "protocol-ai-assist.*ACTIVE"
```

Expected: all green; 3 new migrations listed; protocol-ai-assist Fn ACTIVE.
