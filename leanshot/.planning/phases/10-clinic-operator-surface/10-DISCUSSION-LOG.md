# Phase 10: Clinic Operator Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 10-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 10-Clinic Operator Surface
**Areas discussed (12):** rank algorithm + execution location, drill-in component reuse, roster data fetching, org-owner audit surface UI, performance verification methodology, Coach vs Viewer behavioral differences, mobile roster UX, realtime roster updates, ranking-explainability, per-patient mirror data shape, bulk operator affordances, telemetry / analytics

---

## Decisions selected

| Area | Decision | Recommended? |
|------|----------|--------------|
| Rank algo location | Server-side RPC, no caching | ✓ recommended |
| Score formula | Fixed weights V1 + breakdown tooltip | ✓ recommended |
| Drill-in reuse | Extract `ReadOnlyPatientView` shared component | ✓ recommended |
| Drill-in data | New `clinic-snapshot` Edge Function | ✓ recommended |
| Roster fetch | Single denormalized RPC | ✓ recommended |
| Roster pagination | 50/page server-side sort | ✓ recommended |
| Audit UI location | Settings tab `/clinic/{slug}/settings/audit` | ✓ recommended |
| Audit filters | Member + action + time-range + per-patient mirror | ✓ recommended |
| Audit retention | 13-month full history (Phase 7 cron) | ✓ recommended |
| Perf fixture | Dedicated CI seed + Playwright spec | ✓ recommended |
| Perf gating | PR gate path-scoped | ✓ recommended |
| Role UX | Hide sections entirely when permission missing | ✓ recommended |
| Score role gating | Coach sees breakdown, Viewer score only (new `roster.read_breakdown` key) | ✓ recommended |
| Mobile roster | Card-stack with sort-dropdown | ✓ recommended |
| Mobile drill-in | Full-screen replace with back button | ✓ recommended |
| Realtime roster | Yes — subscribe to org channel for signal updates | ✓ recommended |
| Live nudge UX | Row-flash + threshold toast | ✓ recommended |
| Rank audit | Audit every RPC call + per-patient threshold crossings | ✓ recommended |
| Patient surface | Same "View activity" modal with "Ranking events" tab | ✓ recommended |
| Patient detail level | Timestamp + actor + action + section (no IP/UA) | ✓ recommended |
| Action granularity | Per-section view audit row | ✓ recommended |
| Bulk affordances | **Full bulk suite (multi-select + 3 actions)** | ✗ chose option C (recommended was "defer") |
| Telemetry events | 10 events, PHI-safe | ✓ recommended |
| Telemetry doc | Single `10-EVENTS.md` doc | ✓ recommended |

**Pattern notable:** User chose against the "defer all bulk" recommendation for the bulk affordances decision — picked the full multi-select + 3 bulk actions suite. Consistent with `feedback_regulator_vs_user_audience_pattern.md` memory: operator workflow polish IS end-user-facing (operators are real users), so invest.

## Notable trade-offs flagged in options

- **Bulk PDF export honors consent_scope + has_permission**: sections the operator doesn't have permission to see are absent in the PDF (mirrors D-12 hide-when-no-permission contract for the live drill-in).
- **5-tab cap on bulk "open in tabs"**: browser-blocking heuristic; toast surfaces the cap.
- **Audit-row volume math**: 50 drill-ins/day × 10 sections = 500 rows/day per org. 6 months = ~90K rows. Within retention cron capacity.

## Deferred Ideas

- Custom rank weights per org (v2)
- "Send patient check-in message" / Resend-templated push from clinic (Phase 11+)
- CSV archival export for org audit (defer unless counsel asks)
- Cursor-based infinite-scroll roster (defer to v2 if orgs scale 200+)
- Org-tunable score thresholds for "needs attention" toast
- Coach permission to invite other Coaches (Phase 9 D-07 already covers; no change in Phase 10)
- Org-deletion edge case when operator owns multiple orgs (planner picks default)
- `clinic-snapshot` Edge Function rate-limit (planner picks; recommend per-op-per-org 60 req/min)
- Billing scaffold (not v1)

## Claude's Discretion

- `rank_org_patients` implementation language (plpgsql vs Deno Edge Function)
- Score-bucket boundaries (currently 0-29/30-69/70-100; planner can tune)
- PDF assembly path (jsPDF dynamic-import recommended; vs server-side bulk-export Edge Function)
- Realtime broadcast trigger payload shape
- Roster column ordering on desktop
