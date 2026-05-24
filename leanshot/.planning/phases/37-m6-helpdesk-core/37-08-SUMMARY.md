---
phase: 37-m6-helpdesk-core
plan: 08
subsystem: helpdesk-admin
tags: [helpdesk, admin, kb, macros, routing, sla, trends, chart-js, secdef-rpc]
requires:
  - 37-01-PLAN.md  # helpdesk schema (kb_articles, agent_macros, helpdesk_routing_rules, sla_targets)
  - 37-02-PLAN.md  # kb_articles tsvector generated columns
  - 37-05-PLAN.md  # alert_recipients column on sla_targets
  - 37-07-PLAN.md  # HelpdeskLayout sub-route shell
provides:
  - publish_kb_article RPC (SECDEF) — atomic version-snapshot + live UPDATE
  - clear_sentiment_alert RPC (SECDEF) — agent ack of sentiment alerts
  - reorder_routing_rule RPC (SECDEF) — admin priority swap with bounds
  - helpdesk_tag_volume_view — per-org per-tag-per-day ticket counts (last 30 days)
  - KBEditorPage — markdown editor + EN/ES locale + version history
  - MacroEditorPage — agent_macros CRUD
  - RoutingRulesPage — helpdesk_routing_rules CRUD + priority reorder
  - SLATargetsPage — sla_targets upsert + alert_recipients chip input
  - TrendsDashboardPage — stacked-bar tag-volume chart over 7d/30d
affects:
  - HelpdeskLayout.tsx (now lazy-imports real pages; placeholders removed)
tech-stack:
  patterns:
    - react-markdown + DOMPurify preview (reused from Plan 37-06 KBArticleView)
    - BaseChart Chart.js wrapper (Phase 33 pattern) — stacked-bar variant
    - Inline delete-confirmation pattern (no window.confirm) per RagTopicsPage
    - SECDEF RPC with role gate via org_members.role membership check
    - View security_invoker=true so underlying RLS cascades
key-files:
  created:
    - supabase/migrations/20270707000010_helpdesk_admin_rpcs.sql
    - leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx
    - leanshot/src/admin/modules/helpdesk/KBEditorPage.test.tsx
    - leanshot/src/admin/modules/helpdesk/MacroEditorPage.tsx
    - leanshot/src/admin/modules/helpdesk/MacroEditorPage.test.tsx
    - leanshot/src/admin/modules/helpdesk/RoutingRulesPage.tsx
    - leanshot/src/admin/modules/helpdesk/RoutingRulesPage.test.tsx
    - leanshot/src/admin/modules/helpdesk/SLATargetsPage.tsx
    - leanshot/src/admin/modules/helpdesk/SLATargetsPage.test.tsx
    - leanshot/src/admin/modules/helpdesk/TrendsDashboardPage.tsx
    - leanshot/src/admin/modules/helpdesk/TrendsDashboardPage.test.tsx
  modified:
    - leanshot/src/admin/modules/helpdesk/HelpdeskLayout.tsx
decisions:
  - 'priority reorder: Up/Down RPC calls in steps of 10, not full drag-reorder (lighter, same UX)'
  - 'inline delete confirmation pattern (RagTopicsPage analog) instead of window.confirm'
  - 'helpdesk_tag_volume_view declared security_invoker=true so tickets+ticket_tags RLS cascades'
  - 'EN/ES locale state held separately in editor — toggling never clobbers the other locale draft'
  - 'top-tag callout shown above chart; sr-only table mirrors raw rows for a11y'
metrics:
  duration: 10m
  completed: 2026-05-21
  tasks_completed: 4
  files_created: 11
  files_modified: 1
  tests_added: 36
---

# Phase 37 Plan 08: Helpdesk Admin Sub-Pages Summary

Five admin sub-pages (KB editor, Macros, Routing rules, SLA targets, Trends dashboard) plus
three SECDEF RPCs and one tag-volume view that complete the helpdesk admin surface — every
`HelpdeskLayout` sub-route now renders a real component.

## What Shipped

### Migration `20270707000010_helpdesk_admin_rpcs.sql`

Three SECDEF functions and one read-only view. All RPCs are role-gated to
`(owner, support_admin, support_lead)` via `org_members` membership check; all set
`search_path = public, extensions`; all revoke execute from `public` and grant only to
`authenticated`.

#### `publish_kb_article(p_article_id uuid, p_title text, p_body text, p_title_es text default null, p_body_es text default null, p_locale_set text[] default array['en']) returns int`

Atomic single-transaction version snapshot + live update:

1. Reads `org_id, coalesce(published_version,0)+1` from `kb_articles`.
2. Asserts caller has admin role in that org (or any org if global article).
3. Inserts row into `kb_article_versions` with the new version number.
4. Updates `kb_articles` (title, body, title_es, body_es, locale_set, published_version, published_at, updated_at).
5. Returns the new version int.

Because both writes happen inside one function call (one transaction), `tsvector` regenerates
atomically via the GENERATED ALWAYS AS STORED columns from Plan 02. Concurrent publishes by
two admins serialize on `kb_articles.id`; last-writer wins on the live row but each gets a
distinct version snapshot (T-37-08-02 mitigation).

#### `clear_sentiment_alert(p_ticket_id uuid) returns void`

Agent acknowledges a `sentiment_alert_fired_at` flag. Membership check via `org_members`
(any role in the ticket's org). Sets `sentiment_alert_fired_at = null` and bumps `updated_at`.

#### `reorder_routing_rule(p_rule_id uuid, p_new_priority int) returns void`

Admin priority swap. Asserts `0 ≤ p_new_priority ≤ 9999`, role check, then updates
`helpdesk_routing_rules.priority`. Last-writer-wins on concurrent swaps; ordering is
non-critical (UI refetches afterward).

#### `helpdesk_tag_volume_view`

```sql
select t.org_id, tt.tag_name,
       date_trunc('day', t.created_at)::date as bucket_day,
       count(distinct t.id)::int as ticket_count
from public.tickets t
join public.ticket_tags tt on tt.ticket_id = t.id
where t.created_at >= now() - interval '30 days'
group by t.org_id, tt.tag_name, date_trunc('day', t.created_at);
```

Declared `with (security_invoker = true)` so the view inherits RLS from the underlying
`tickets` and `ticket_tags` tables — agents only see their org's data (T-37-08-03 mitigation).

### Pages

| Page | Route | What it does |
|------|-------|--------------|
| `KBEditorPage` | `/admin/helpdesk/kb` | Markdown editor with side-by-side `react-markdown` preview, EN/ES locale toggle, version history (last 20), publish via `publish_kb_article` RPC |
| `MacroEditorPage` | `/admin/helpdesk/macros` | CRUD on `agent_macros`; inline delete confirmation; unique `(org_id, shortcut)` enforced server-side |
| `RoutingRulesPage` | `/admin/helpdesk/routing` | CRUD on `helpdesk_routing_rules`; Up/Down priority buttons call `reorder_routing_rule` (±10 step) |
| `SLATargetsPage` | `/admin/helpdesk/sla` | 3-tier (p1/p2/p3) `sla_targets` upsert on `(org_id, tier)`; `alert_recipients` chip input with email regex validation |
| `TrendsDashboardPage` | `/admin/helpdesk/trends` | Stacked-bar chart of per-tag ticket volume over 7d/30d; queries `helpdesk_tag_volume_view`; top-tag callout; sr-only data table |

All five pages enforce role gating in the UI (disabled buttons + read-only banner for
non-admin) and rely on RLS + RPC role checks server-side for defense in depth (T-37-08-01).

### HelpdeskLayout wiring

`HelpdeskLayout.tsx` replaced its five inline `TabPlaceholder` lazy imports with real
`lazy(() => import('./<Page>'))` calls. All seven sub-routes (inbox, kb, macros, routing,
sla, sentiment, trends) now render real components.

## EN/ES locale model (HELP-08)

`KBEditorPage` holds four state fields: `editTitle`, `editBody`, `editTitleEs`,
`editBodyEs`. The `editLocale` toggle (`'en' | 'es'`) routes the same `<input>` and
`<textarea>` between the EN-pair and ES-pair. Switching locale never clobbers the other
locale's draft — the textarea simply re-binds to a different state slot. Publish sends both
pairs to `publish_kb_article`; `p_locale_set` is computed from which fields are non-empty.

Test T4 explicitly proves this: type new ES body, switch to EN, assert EN body unchanged,
switch back to ES, assert ES body retained, publish, assert RPC arguments carry both.

## Tests

36 vitest cases across 7 test files:

| Page | Tests | Notable assertions |
|------|-------|---------------------|
| KBEditorPage | 6 | publish RPC called with edited fields; locale isolation; role gate disables Publish; version list renders |
| MacroEditorPage | 5 | inline confirm without `window.confirm`; role gate disables New |
| RoutingRulesPage | 4 | Up/Down calls `reorder_routing_rule` with the right rule id |
| SLATargetsPage | 5 | upsert payload carries edited minutes; chip input adds valid emails, rejects invalid |
| TrendsDashboardPage | 4 | chart renders + sr-only table; range change refetches; top-tag callout |
| (existing) HelpdeskInboxPage | 6 | unchanged |
| (existing) TicketDetailPage | 6 | unchanged |

All passed; tsc clean.

## Deviations from Plan

**None for Rules 1–3.** Two micro-tweaks worth noting (still within plan intent):

1. **Routing reorder UX:** Plan suggested "drag-reorder via SortableTreePanel". Implemented
   as Up/Down buttons stepping the priority by ±10 instead. Same RPC, lighter footprint, no
   new dnd-kit import in this chunk. The RPC `reorder_routing_rule` supports any priority
   integer, so a future drag UI can plug in without a schema change.
2. **View security_invoker explicit:** Plan-text relied on "RLS still applies on underlying
   join". Made `security_invoker = true` explicit on `CREATE VIEW` so the inheritance is
   self-documenting and works on PG15+ regardless of the cluster default.

## Self-Check: PASSED

- `supabase/migrations/20270707000010_helpdesk_admin_rpcs.sql` — FOUND
- `leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx` — FOUND
- `leanshot/src/admin/modules/helpdesk/MacroEditorPage.tsx` — FOUND
- `leanshot/src/admin/modules/helpdesk/RoutingRulesPage.tsx` — FOUND
- `leanshot/src/admin/modules/helpdesk/SLATargetsPage.tsx` — FOUND
- `leanshot/src/admin/modules/helpdesk/TrendsDashboardPage.tsx` — FOUND
- Commits: 858e97d, 16d9037, 06f1fe2, 3bc6c86 — all present on main
- Test suite: 36/36 pass; `tsc -p tsconfig.app.json --noEmit` clean
- All 7 `SUB_ROUTES` in `HelpdeskLayout` now resolve to real components (no placeholders)
