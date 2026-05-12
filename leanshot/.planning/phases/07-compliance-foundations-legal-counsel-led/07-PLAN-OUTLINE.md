---
phase: 7
slug: compliance-foundations-legal-counsel-led
mode: chunked-outline
created: 2026-05-12
---

# Phase 7 — Plan Outline

Authoritative source: `07-RESEARCH.md` §Recommended Plan Ordering (lines 909–950). Wave structure mirrors Phase 6 D-12 pattern: Wave 1 = CI gate + independent refactor; Wave 2 = legal-page surface + audit-log foundation; Wave 3 = policy content + UI flows that depend on hosting and audit infra.

| Plan ID | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 07-01 | Re-enable + batch-fix the 7 deferred SC e2e specs (CI green gate for every plan below) — D-07 entry condition | 1 | — | D-07 (entry condition; no COMPL ID) |
| 07-09 | Codebase-wide `s.user!` non-null-assertion sweep — typed null-guards + early-returns, one commit per file (D-06) | 1 | — | D-06 (deferred from Phase 6; no COMPL ID) |
| 07-02 | Legal-page hosting decision + `Landing.tsx:577-581` footer wiring + authenticated-app footer (host surface for 07-03/07-04 content) | 2 | 07-01 | COMPL-01, COMPL-02 (hosting surface) |
| 07-08 | `audit_logs` table + per-table server-side triggers + RLS policies + cross-tenant RLS proof + 13-month retention pg_cron — **[BLOCKING] supabase db push** required (D-04) | 2 | 07-01 | D-04 (load-bearing; feeds 07-07 skeleton + HBNR breach-tracking story for COMPL-03) |
| 07-05 | FTC HBNR registration filing acknowledgement + `.planning/runbooks/hbnr-incident-response.md` (60-day clock, breach decision tree, on-call escalation) — COMPL-03 | 2 | 07-01 | COMPL-03 |
| 07-03 | Author WMHMDA Consumer Health Data Privacy (CHDP) policy from Termly + iubenda cross-reference — structural anchors verified by grep — COMPL-02 | 3 | 07-02 | COMPL-02 |
| 07-04 | Author Privacy Policy + Terms of Service + Medical Disclaimer (all data categories enumerated from `store.ts` + `types/index.ts`) — COMPL-01 | 3 | 07-02 | COMPL-01 |
| 07-10 | Settings → "Recovery" section: restore-from-`leanshot_v4_pre_cloud_backup` UI with confirmation modal + snapshot-date display (D-05) | 3 | 07-01 | D-05 (deferred from Phase 6; no COMPL ID) |
| 07-06 | Settings data export: extend `exportData()` to include cloud entities + readable PDF (jsPDF + jspdf-autotable, **must route through `src/lib/sync-defer.ts`** to hold 50 kB index gz ceiling) — COMPL-06 export half | 3 | 07-01 | COMPL-06 (export half) |
| 07-07 | Account-delete: typed-confirmation modal → T+0 admin RPC (sign-out + soft-delete + photo move to `photos-pending-shred/`) → `pending_account_deletions` table + pg_cron T+30 finalize worker (cascade hard-delete + Storage shred + audit skeleton row) — **[BLOCKING] supabase db push** required (D-03) | 3 | 07-08 | COMPL-06 (delete half) |

## Coverage check

- **COMPL-01** (Privacy Policy): 07-04 (authoring) + 07-02 (hosting/footer)
- **COMPL-02** (WMHMDA CHDP): 07-03 (authoring) + 07-02 (hosting/footer)
- **COMPL-03** (FTC HBNR registration + incident-response): 07-05; audit-log infrastructure backing the breach-tracking story = 07-08
- **COMPL-06** (Data export + account delete): 07-06 (export) + 07-07 (delete)
- **D-07** (entry condition, re-enable 7 e2e specs): 07-01
- **D-04** (full cloud-write audit log): 07-08
- **D-05** (restore-from-backup UI): 07-10
- **D-06** (`s.user!` sweep): 07-09
- **D-03** (account-delete model details): 07-07 (consumes 07-08 audit-skeleton trigger)
- **D-01** (no-counsel self-draft): governs content of 07-03 + 07-04 (no separate plan; no "counsel review" task allowed)
- **D-02** (free-tier Storage): governs 07-07 photo-shred mechanism (Storage default encryption + DB-level key destruction, no envelope encryption)

All 4 phase requirement IDs covered. All 7 locked CONTEXT decisions covered. No deferred ideas planned.

## Schema-push plans (project rule reminder)

- **07-08** introduces `audit_logs` table + triggers + RLS policies → MUST include `[BLOCKING] supabase db push` task after SQL lands, before verification.
- **07-07** introduces `pending_account_deletions` table + pg_cron job → MUST include `[BLOCKING] supabase db push` task after SQL lands, before verification.
- Both new RLS surfaces (`audit_logs`, `pending_account_deletions`) MUST include a live cross-tenant impersonation proof test (per project rule, Phase 5/6 `rls-multi-table.test.ts` pattern).

## OUTLINE COMPLETE — 10 plans
