# Phase 62: Insights & Research Engine - Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 19 new/modified files
**Analogs found:** 19 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/components/admin/research/ResearchLayout.tsx` | component | request-response | `src/components/admin/protocols/ProtocolsLayout.tsx` | exact |
| `src/components/admin/research/CohortBuilderPage.tsx` | component | CRUD | `src/components/admin/protocols/ProtocolsListPage.tsx` | role-match |
| `src/components/admin/research/RetentionChart.tsx` | component | transform | `src/components/dashboard/charts/BaseChart.tsx` | exact |
| `src/components/admin/research/CrossTabMatrix.tsx` | component | transform | `src/components/admin/protocols/ProtocolsListPage.tsx` (table pattern) | role-match |
| `src/components/admin/research/PublicationsListPage.tsx` | component | CRUD | `src/components/admin/protocols/ProtocolsListPage.tsx` | exact |
| `src/components/admin/research/PublicationEditorPage.tsx` | component | CRUD | `src/components/admin/protocols/ProtocolEditorPage.tsx` | exact |
| `src/components/admin/research/ResearchReviewBanner.tsx` | component | request-response | `src/components/admin/protocols/ProtocolReviewBanner.tsx` | exact |
| `src/components/research/PublicResearchArticlePage.tsx` | component | request-response | `src/components/knowledge/KnowledgeArticleDetailPage.tsx` | exact |
| `src/components/research/PublicResearchIndexPage.tsx` | component | request-response | `src/components/knowledge/KnowledgeRootPage.tsx` | exact |
| `src/components/research/DpMethodsFooter.tsx` | component | transform | `src/components/admin/rag/TierBadge.tsx` | role-match |
| `src/components/dashboard/settings/ResearchConsentSection.tsx` | component | CRUD | `src/components/dashboard/settings/SettingsPage.tsx` (section pattern) | role-match |
| `supabase/migrations/20290102000001_insights_schema.sql` | migration | batch | `supabase/migrations/20290101000001_protocol_tables.sql` | exact |
| `supabase/migrations/20290102000002_insights_secdef_rpcs.sql` | migration | CRUD | `supabase/migrations/20290101000002_protocol_secdef_rpcs.sql` | exact |
| `supabase/migrations/20290102000003_insights_matviews.sql` | migration | batch | `supabase/migrations/20290101000001_protocol_tables.sql` (table pattern) | role-match |
| `supabase/migrations/20290102000004_research_consent_columns.sql` | migration | CRUD | `supabase/migrations/20290101000001_protocol_tables.sql` (ALTER pattern) | role-match |
| `supabase/migrations/20290102000005_pending_rag_ingest_queue.sql` | migration | event-driven | `supabase/migrations/20290101000001_protocol_tables.sql` | role-match |
| `supabase/functions/research-publish/handler.ts` | service | request-response | `supabase/functions/protocol-ai-assist/handler.ts` | exact |
| `supabase/functions/research-publish/index.ts` | config | request-response | `supabase/functions/protocol-ai-assist/index.ts` | exact |
| `src/lib/markdown/research-renderer.ts` | utility | transform | `src/lib/markdown/protocol-shortcode-plugin.ts` | role-match |

---

## Pattern Assignments

### `src/components/admin/research/ResearchLayout.tsx` (component, request-response)

**Analog:** `src/components/admin/protocols/ProtocolsLayout.tsx` (lines 1-120)

**Copy verbatim, change:**
- Module base path `/admin/protocols` → `/admin/research`
- `aria-label="Protocols sections"` → `aria-label="Research sections"`
- `SUB_ROUTES` entries: `list` → `publications`, `editor` → `cohort`
- Lazy import from `./PublicationsListPage` and `./CohortBuilderPage`

**Imports pattern** (lines 17):
```typescript
import React, { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
```

**Sub-nav pattern** (lines 80-119):
```tsx
<div className="grid gap-6 lg:grid-cols-[200px_1fr]">
  <nav aria-label="Research sections" className="lg:sticky lg:top-4 lg:self-start">
    <ul className="flex flex-wrap lg:flex-col gap-1">
      {SUB_ROUTES.map((r) => {
        const isActive = active.key === r.key;
        return (
          <li key={r.key}>
            <a
              href={`/admin/research/${r.path}`}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'inline-flex w-full items-center h-9 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'inline-flex w-full items-center h-9 px-3 rounded-pill text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
              }
            >
              {r.label}
            </a>
          </li>
        );
      })}
    </ul>
  </nav>
  <main className="max-w-screen-xl">
    <Suspense fallback={<div className="p-6 text-[13px] text-[var(--color-text-secondary)]">Loading…</div>}>
      <Active />
    </Suspense>
  </main>
</div>
```

**Routing pattern** (lines 53-60):
```typescript
function resolveActive(pathname: string): SubRoute {
  const m = pathname.match(/^\/admin\/research\/?(?:([^/]+).*)?$/);
  const seg = (m?.[1] ?? '').toLowerCase();
  const found = SUB_ROUTES.find((r) => r.path === seg);
  return found ?? SUB_ROUTES.find((r) => r.key === DEFAULT_KEY)!;
}
```

**Convention bullets:**
- No react-router; use `window.location.pathname` + `popstate` event listener
- Active route accent: `bg-[var(--color-primary)]` per UI-SPEC §A1
- Typography ONLY `text-[13px]` for sub-nav labels per Phase 60 BLOCKER
- `Suspense` fallback at `text-[13px] text-[var(--color-text-secondary)]`
- Default sub-route is `publications` (mirrors `list` default in protocols)

---

### `src/components/admin/research/CohortBuilderPage.tsx` (component, CRUD)

**Analog:** `src/components/admin/protocols/ProtocolsListPage.tsx` (lines 1-332)

**Diff from analog:** This is a form-heavy page (build a cohort) rather than a list. The table pattern for results still applies, but the primary interaction is submitting filter params to `compile_research_cohort` RPC and rendering suppressed/success banners.

**Imports pattern** (lines 10-21):
```typescript
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/lib/store';
```

**Fetch/RPC pattern** (lines 66-100 adapted):
```typescript
// POST to compile_research_cohort SECDEF RPC
const { data, error } = await supabase.rpc('compile_research_cohort', {
  p_filters: { tenure_bucket: tenureBucket, audience, outcome_metric: outcomeMetric },
});
if (error) {
  setError('Failed to compile cohort. Refresh to try again.');
  setLoading(false);
  return;
}
// Check k-floor suppression before rendering chart
if (data?.suppressed) {
  setSuppressed(true);
  return;
}
```

**Suppressed-cohort UX** (decision from CONTEXT.md):
```tsx
{suppressed && (
  <div className="flex items-center gap-2 px-4 py-3 rounded-card bg-[var(--color-rose-soft)]">
    <span className="text-[13px] font-semibold text-[var(--color-warning)]">
      Cohort too small (k&lt;5) — broaden filters
    </span>
  </div>
)}
```

**Convention bullets:**
- `useEffect` with cancellation token pattern: `let cancelled = false; return () => { cancelled = true; }`
- Filter pills: `<Pill size="sm" active={} aria-pressed={} onClick={}>` — exact same pattern as ProtocolsListPage
- Loading skeleton: `h-20 rounded-card bg-[var(--color-surface-elevated)] animate-pulse` (3 rows)
- Error: `text-[13px] text-[var(--color-danger)]`
- Named export + default export both required (mirrors ProtocolsListPage lines 332-333)

---

### `src/components/admin/research/RetentionChart.tsx` (component, transform)

**Analog:** `src/components/dashboard/charts/BaseChart.tsx` (lines 1-60)

**Full analog — copy import/usage pattern:**

**Imports + usage pattern** (lines 1-60):
```typescript
import { type ChartConfiguration } from 'chart.js';
import { useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { BaseChart } from '@/components/dashboard/charts/BaseChart';
```

**Stacked-area config pattern** (per CONTEXT.md decision: "stacked-area chart pattern"):
```typescript
// RetentionChart wraps BaseChart with a stacked-area ChartConfiguration
function buildRetentionConfig(data: RetentionDataPoint[], theme: string): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels: data.map((d) => d.week_label),
      datasets: [
        {
          label: 'Retained',
          data: data.map((d) => d.retained_pct),
          fill: true,
          tension: 0.3,
          backgroundColor: theme === 'dark' ? 'rgba(var(--color-primary-rgb), 0.3)' : 'rgba(var(--color-primary-rgb), 0.15)',
          borderColor: 'var(--color-primary)',
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  };
}
```

**Call-site key pattern** (from BaseChart docs in file):
```tsx
// Caller MUST set key={theme} to force remount on theme change
<BaseChart
  key={theme}
  config={retentionConfig}
  ariaLabel="Retention curve: percentage retained by week"
  height={280}
/>
```

**Convention bullets:**
- `BaseChart` is the ONLY chart primitive — never instantiate `new Chart()` in feature components
- `key={theme}` on the wrapping element triggers hard remount on theme switch (prevents stale colors)
- `ariaLabel` prop is required (accessibility contract enforced by `BaseChartProps` interface)
- `height` in px, defaults to 240 — override to 280 for retention curves
- No new chart library; bundle constraint in CLAUDE.md

---

### `src/components/admin/research/CrossTabMatrix.tsx` (component, transform)

**Analog:** Table pattern from `src/components/admin/protocols/ProtocolsListPage.tsx` (lines 243-322)

**Diff from analog:** Pure display component — no row actions, no navigation. Renders a data matrix (outcome metric × cohort bucket) with cell values + epsilon display in caption.

**Table pattern** (lines 243-320):
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-[13px]">
    <caption className="text-[11px] text-[var(--color-text-tertiary)] text-left pb-2">
      ε = {epsilon} (differential privacy noise applied)
    </caption>
    <thead className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
      <tr>
        {columnLabels.map((col) => (
          <th key={col} className="text-start py-2 pe-4">{col}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.label} className="border-t border-[var(--color-border)]">
          <td className="py-3 pe-4 font-semibold text-[var(--color-text)]">{row.label}</td>
          {row.values.map((v, i) => (
            <td key={i} className="py-3 pe-4 text-[var(--color-text-secondary)]">
              {v !== null ? v.toFixed(1) : <span className="text-[var(--color-text-tertiary)]">—</span>}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

**Convention bullets:**
- Typography: `text-[11px]` headers, `text-[13px]` body — exact same as ProtocolsListPage
- `overflow-x-auto` wrapper always required for tables (mobile safety)
- Epsilon display MUST appear in caption per CONTEXT.md academic integrity rule
- Suppressed cells render `—` in `text-[var(--color-text-tertiary)]` (consistent with ProtocolsListPage missing-data pattern)

---

### `src/components/admin/research/PublicationsListPage.tsx` (component, CRUD)

**Analog:** `src/components/admin/protocols/ProtocolsListPage.tsx` (lines 1-332)

**Copy verbatim, change:**
- Table columns: `slug`, `status`, `reviewer_id`, `published_at`, `created_by`, `updated_at`
- `handleNew()` inserts into `research_publications` not `protocols`
- Filter states: `all | draft | in_review | published | archived`
- Navigate to `/admin/research/<id>` for editor
- CTA label: "New Publication" not "New Protocol"

**Key patterns identical to ProtocolsListPage:**
- Supabase `from('research_publications').select(...).order('updated_at', { ascending: false })` in `useEffect`
- Filter pill `<Pill size="sm" active={} aria-pressed={}>` pattern (lines 196-209)
- `useMemo` for filtered rows (lines 103-106)
- Keyboard shortcuts: `n`=new, `j`/`k`=navigate, `Shift+?`=help (lines 143-174)
- Sticky header with `z-10 pb-3 border-b border-[var(--color-border)] mb-4` (line 181)

**Status badge:** Create `PublicationStatusBadge` mirroring `ProtocolStatusBadge.tsx` — same `Badge` tone mapping: `draft=neutral`, `in_review=warning`, `published=success`, `archived=neutral`.

---

### `src/components/admin/research/PublicationEditorPage.tsx` (component, CRUD)

**Analog:** `src/components/admin/protocols/ProtocolEditorPage.tsx` (lines 1-597)

**Copy two-column grid verbatim, change:**
- Left column: markdown editor textarea (no step table; single long-form markdown field)
- Right column: sticky metadata panel — `slug`, `status`, `reviewer_id`, `created_by`, action buttons
- `handlePublish()` calls `supabase.rpc('publish_research', { p_publication_id: publication.id })`
- `isSelfCreated = currentUserId === publication.created_by` — same 2-person rule invariant
- `ResearchReviewBanner` replaces `ProtocolReviewBanner`
- State machine: `draft → in_review → published → archived`

**Two-column layout pattern** (lines 371):
```tsx
<div className="grid gap-6 lg:grid-cols-[1fr_320px]">
  {/* Left: markdown editor */}
  <div className="space-y-4">
    <textarea
      value={publication.markdown_content}
      onChange={(e) => setPublication((p) => p ? { ...p, markdown_content: e.target.value } : p)}
      onBlur={() => void handleSaveDraft()}
      aria-label="Publication markdown content"
      className="w-full h-96 text-[13px] font-mono bg-transparent border border-[var(--color-border)] rounded-card p-3 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] resize-y"
    />
  </div>
  {/* Right: metadata panel */}
  <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
    {/* Same panel pattern as ProtocolEditorPage lines 492-556 */}
  </aside>
</div>
```

**2-person rule publish pattern** (lines 153-177):
```typescript
const handlePublish = useCallback(async () => {
  if (!publication) return;
  setPublishing(true);
  try {
    const { error: rpcErr } = await supabase.rpc('publish_research', {
      p_publication_id: publication.id,
    });
    if (rpcErr) {
      if (rpcErr.message?.includes('SELF_REVIEW_REJECTED') || rpcErr.code === '42501') {
        showToast('Another admin must review this publication before publish.', 'error');
        return;
      }
      showToast(rpcErr.message ?? 'Publish failed', 'error');
      return;
    }
    showToast('Publication published.', 'success');
    void loadPublication(publication.id);
  } finally {
    setPublishing(false);
  }
}, [publication, showToast, loadPublication]);
```

**Convention bullets:**
- Publish button FULLY REMOVED from DOM (not disabled) when `isSelfCreated` — same as PROTOCOL-04
- `useToast()` + `supabase` from `@/lib/supabase` — same imports as analog
- Error state: `text-[13px] text-[var(--color-danger)] p-6`
- Loading state: `<Skeleton className="h-8 w-1/3 rounded-card" />` pattern

---

### `src/components/admin/research/ResearchReviewBanner.tsx` (component, request-response)

**Analog:** `src/components/admin/protocols/ProtocolReviewBanner.tsx` (lines 1-63)

**Copy VERBATIM — change only labels:**
- `'Pending review by another admin'` → same text (already generic)
- `'Review as: {name}'` → same text
- `'Publish Protocol'` → `'Publish Research'`
- Props interface: `ResearchReviewBannerProps` (rename from `ProtocolReviewBannerProps`)

**Full verbatim pattern** (lines 18-63):
```typescript
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ResearchReviewBannerProps {
  isAuthor: boolean;
  reviewerName?: string;
  onPublish?: () => Promise<void>;
  publishing?: boolean;
}

export function ResearchReviewBanner({ isAuthor, reviewerName, onPublish, publishing }: ResearchReviewBannerProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[var(--color-rose-soft)] mb-6">
      <Clock className="size-4 text-[var(--color-warning)] shrink-0" aria-hidden="true" />
      {isAuthor ? (
        <span className="text-[13px] font-semibold text-[var(--color-warning)]">
          Pending review by another admin
        </span>
      ) : (
        <>
          <span className="text-[13px] font-semibold text-[var(--color-warning)]">
            Review as: {reviewerName ?? 'reviewer'}
          </span>
          {onPublish && (
            <Button size="sm" variant="primary" loading={publishing} onClick={onPublish} className="ms-auto">
              Publish Research
            </Button>
          )}
        </>
      )}
    </div>
  );
}
```

**Convention bullets:**
- `--color-rose-soft` background + `--color-warning` text/icon — verified tokens from Phase 61
- Publish button MUST NOT render when `isAuthor=true` — full conditional render, not `disabled`
- `mb-6` spacing below banner before the two-column grid

---

### `src/components/research/PublicResearchArticlePage.tsx` (component, request-response)

**Analog:** `src/components/knowledge/KnowledgeArticleDetailPage.tsx` (lines 1-346)

**Copy structure verbatim, change:**
- JSON-LD type: `'MedicalWebPage'` → `'ScholarlyArticle'` (CONTEXT.md decision)
- `robots`: NO `noindex` directive — research papers are SEO-discoverable (inverts Phase 60-13 decision)
- Canonical base path: `/research/<slug>` instead of `/knowledge/<topic>/<slug>`
- Footer: `<DpMethodsFooter epsilon={0.5} cohortSize={} suppressedBuckets={}>` replaces FDA disclaimer for public publications
- Source panel: replace `<SourcesPanel>` with publication metadata panel (reviewer, published date)
- Import source: fetch from `research_publications` table not `kb_chunks`

**JSON-LD ScholarlyArticle pattern** (lines 73-100 adapted):
```typescript
function buildScholarlyArticleJsonLd(pub: ResearchPublication, canonicalUrl: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: pub.title,
    description: pub.abstract?.slice(0, 160) ?? '',
    datePublished: pub.published_at ?? undefined,
    dateModified: pub.updated_at ?? undefined,
    author: { '@type': 'Organization', name: 'LeanShot Research' },
    publisher: {
      '@type': 'Organization',
      name: 'LeanShot',
      logo: { '@type': 'ImageObject', url: `${CANONICAL_BASE}/og-image.png` },
    },
    mainEntityOfPage: canonicalUrl,
  };
}
```

**Helmet pattern** (lines 196-206):
```tsx
<Helmet>
  <title>{title} — LeanShot Research</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="article" />
  <meta property="og:image" content={ogImageUrl} />
  {/* NO noindex — research papers are SEO-discoverable per CONTEXT.md decision */}
  <script type="application/ld+json">{JSON.stringify(scholarlyArticleJsonLd)}</script>
</Helmet>
```

**Body render pattern** (lines 248-276 adapted):
```tsx
<article
  className="prose prose-sm max-w-none text-text [&_a]:text-primary [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary"
  aria-label="Research article body"
>
  <ReactMarkdown>{sanitizedMarkdown}</ReactMarkdown>
</article>
```

**Convention bullets:**
- `react-helmet-async` `<Helmet>` pattern — identical to KnowledgeArticleDetailPage
- `undefined` loading state (not `null`) for 3-state: `undefined=loading`, `null=not-found`, `object=loaded`
- `let cancelled = false` fetch cancellation pattern in `useEffect`
- `<Skeleton>` loading state: `max-w-screen-lg mx-auto px-4 py-8 space-y-4`
- Main layout: `max-w-screen-lg mx-auto px-4 py-8` (identical)

---

### `src/components/research/PublicResearchIndexPage.tsx` (component, request-response)

**Analog:** `src/components/knowledge/KnowledgeRootPage.tsx` (lines 1-256)

**Copy structure verbatim, change:**
- H1: "Research" (not "Knowledge Base") — still uses `font-display italic text-heading` (SOLE Fraunces usage)
- JSON-LD: `'WebSite'` schema stays the same type, update `name` and `url`
- Card grid: list of `research_publications` (published only) instead of topics
- RSS link: add `<link rel="alternate" type="application/rss+xml" href="/research/rss.xml">` in `<Helmet>`
- No newsletter form (research index serves different CTA)

**Hero + JSON-LD pattern** (lines 31-46):
```typescript
const researchWebsiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'LeanShot Research',
  url: `${CANONICAL_BASE}/research`,
};
```

```tsx
<Helmet>
  <title>Research — LeanShot</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={`${CANONICAL_BASE}/research`} />
  <link rel="alternate" type="application/rss+xml" href="/research/rss.xml" title="LeanShot Research RSS" />
  <script type="application/ld+json">{JSON.stringify(researchWebsiteJsonLd)}</script>
</Helmet>
```

**Card grid pattern** (lines 127-159):
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {publications.map((pub) => (
    <button
      key={pub.id}
      type="button"
      onClick={() => navigate(`/research/${pub.slug}`)}
      className="text-left rounded-xl border border-border bg-surface p-4 hover:border-border focus-visible:outline-2 focus-visible:outline-primary"
      aria-label={`Read: ${pub.title}`}
    >
      <div className="text-lg font-semibold text-text leading-snug line-clamp-2">{pub.title}</div>
      <div className="text-xs text-text-secondary mt-1">{formatDate(pub.published_at)}</div>
    </button>
  ))}
</div>
```

**Convention bullets:**
- `Promise.all` for parallel data fetches in single `useEffect` (lines 62-76)
- `cancelled` token pattern: `let cancelled = false` / `return () => { cancelled = true; }`
- Fail-soft error handling: `catch { /* render with empty state */ }` (no error state rendered to user)
- `reducedMotion` check via `useReducedMotion()` hook for transition CSS

---

### `src/components/research/DpMethodsFooter.tsx` (component, transform)

**Analog:** `src/components/admin/rag/TierBadge.tsx` (lines 1-35)

**Same pattern:** Small display-only component wrapping `Badge` primitives + semantic copy. No state, no data fetching.

**Full pattern** (lines 1-35 adapted):
```typescript
import { Badge } from '@/components/ui/Badge';

export interface DpMethodsFooterProps {
  epsilon: number;         // 0.5 for public, 1.0 for admin
  cohortSize: number;      // k (≥5 always, per k-floor)
  suppressedBuckets: number; // count of suppressed sub-groups
}

export function DpMethodsFooter({ epsilon, cohortSize, suppressedBuckets }: DpMethodsFooterProps) {
  return (
    <footer className="border-t border-[var(--color-border)] pt-6 space-y-2 text-[13px] text-[var(--color-text-secondary)]">
      <div className="flex flex-wrap gap-3 items-center">
        <Badge tone="neutral" aria-label={`Differential privacy epsilon ${epsilon}`}>
          ε = {epsilon}
        </Badge>
        <span>Cohort n = {cohortSize}</span>
        {suppressedBuckets > 0 && (
          <span className="text-[var(--color-text-tertiary)]">
            {suppressedBuckets} sub-group{suppressedBuckets !== 1 ? 's' : ''} suppressed (k&lt;5)
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-tertiary)]">
        Laplace noise (ε = {epsilon}) applied to all aggregate values. K-anonymity floor k≥5 enforced.
      </p>
    </footer>
  );
}
```

**Convention bullets:**
- Export both named + default (TierBadge does same pattern)
- Props typed as interface not `type` (project convention for object shapes)
- `aria-label` on Badge explaining DP semantics (accessibility contract)
- Typography: `text-[13px]` body, `text-[11px]` fine print

---

### `src/components/dashboard/settings/ResearchConsentSection.tsx` (component, CRUD)

**Analog:** `src/components/dashboard/settings/SettingsPage.tsx` section pattern (lines 144-170)

**Pattern:** Self-contained section component (matches how `HealthKitSettingsSection`, `NewsletterSettings` etc. are structured — lazy-imported into SettingsPage).

**Consent toggle + revoke modal pattern:**
```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export function ResearchConsentSection() {
  const [consent, setConsent] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const showToast = useToast();
  // ... fetch current consent on mount, UPSERT on toggle
}
```

**Revoke confirmation modal text** (from CONTEXT.md specifics):
```
"Revoking will remove your data from future research within 24 hours.
Already-published papers cite aggregate cohorts, not individuals —
past publications are not retracted."
```

**Convention bullets:**
- Lazy import into SettingsPage (same as `NewsletterSettings` line 69-72)
- Uses `<ConfirmModal>` from `@/components/ui/Confirm` for revoke confirmation
- Default consent is `false` (opt-in only, per HIPAA Privacy Rule §164.508)
- `consent_revoked_at = now()` set on revoke; nightly cron purges within 24h
- Section extends the `Section` type from `@/lib/i18n/settings-labels` (new entry: `'research-consent'`)
- NAV entry added with `{ id: 'research-consent', Icon: Heart }` in SettingsPage NAV array

---

### `supabase/migrations/20290102000001_insights_schema.sql` (migration, batch)

**Analog:** `supabase/migrations/20290101000001_protocol_tables.sql` (lines 1-100+)

**Full structure to copy:**
- File-level comment block with table inventory, RLS enforcement notes, idempotency notes
- ENUM creation via DO block (check `pg_type` before `CREATE TYPE`)
- Tables with `CREATE TABLE IF NOT EXISTS`
- Trigger function `tg_set_updated_at()` — reuse via `CREATE OR REPLACE` (already exists from Phase 61)
- RLS policies via bare `CREATE POLICY` (NO `IF NOT EXISTS` — unsupported on remote PG per Phase 61 close-out lesson)

**Tables to create:**
1. `research_publications` — `(id uuid PK, slug text unique, markdown_path text, title text, abstract text, status enum 'draft|in_review|published|archived', created_by uuid FK, reviewer_id uuid FK, published_at timestamptz, created_at, updated_at)`
2. `research_review_log` — append-only audit (mirrors `protocol_review_log`)
3. ENUM `public.research_publication_status`

**ENUM DO-block pattern** (lines 48-63):
```sql
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'research_publication_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.research_publication_status as enum (
      'draft', 'in_review', 'published', 'archived'
    );
  end if;
end $$;
```

**RLS pattern** (lines 115+):
```sql
-- Staff: is_staff() guard (NOT IF NOT EXISTS on remote PG)
alter table public.research_publications enable row level security;
create policy "staff_all_research_publications" on public.research_publications
  using (public.is_staff());
```

**Convention bullets:**
- Migration filename `20290102000001` — follows Phase 61 cluster `20290101*`, avoids back-dated push block
- `begin; ... commit;` transaction wrapper
- `revoke all on table ... from public; grant select on table ... to authenticated` for public-readable tables
- `tg_set_updated_at()` trigger already exists — just `CREATE TRIGGER IF NOT EXISTS` guard

---

### `supabase/migrations/20290102000002_insights_secdef_rpcs.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20290101000002_protocol_secdef_rpcs.sql` (lines 1-523)

**Copy header pattern verbatim** (lines 1-33):
```sql
-- Phase 62 Plan XX — SECDEF RPCs: research cohort + 2-person review + consent purge
-- ============================================================================
-- Every RPC:
--   * LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog
--   * Opens with: if not public.is_staff() then raise exception 'not authorized'
--                 using errcode = '42501'; end if;
--   * REVOKE ALL ON FUNCTION ... FROM public
--   * GRANT EXECUTE ON FUNCTION ... TO authenticated
```

**4 RPCs to implement:**

1. `public.compile_research_cohort(p_filters jsonb)` — k-floor check BEFORE materialization:
```sql
create or replace function public.compile_research_cohort(p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_cohort_count int;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Count cohort first (k-floor guard)
  select count(distinct user_id) into v_cohort_count
  from <source_table>
  where <filter conditions from p_filters>;

  if v_cohort_count < 5 then
    return jsonb_build_object('suppressed', true, 'reason', 'k_floor', 'k', v_cohort_count);
  end if;
  -- Apply Laplace noise and return rollup
  return jsonb_build_object(
    'suppressed', false,
    'cohort_size', v_cohort_count,
    'data', (SELECT ... FROM insights_* matviews WITH laplace_noise applied)
  );
end $$;
```

2. `public.publish_research(p_publication_id uuid)` — mirrors `publish_protocol` VERBATIM:
```sql
-- SELF_REVIEW_REJECTED guard: v_created_by = auth.uid() → raise exception
-- FOR UPDATE row lock on every state-read (T-62-02 mitigation)
-- Audit INSERT into research_review_log
-- on publish: INSERT into pending_rag_ingest (publication_id, queued_at) → RAG feedback loop
```

3. `public.laplace_noise(value numeric, epsilon numeric)` — PL/pgSQL Laplace transform:
```sql
create or replace function public.laplace_noise(value numeric, epsilon numeric)
returns numeric
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  u numeric;
begin
  -- Laplace noise via inverse CDF: gen_random_uuid entropy → uniform → Laplace
  u := (random() - 0.5);
  return value - (1.0 / epsilon) * sign(u) * ln(1.0 - 2.0 * abs(u));
end $$;
```

4. `public.purge_research_data_for_revoked()` — nightly cron target:
```sql
-- Find profiles WHERE research_consent=false AND last_purged_at < consent_revoked_at
-- DELETE from insights_*_source tables for those user_ids
-- UPDATE profiles SET last_purged_at = now()
-- REVOKE ALL; GRANT EXECUTE TO authenticated (cron calls via vault bearer pattern)
```

**Convention bullets:**
- All RPCs: `SECURITY DEFINER SET search_path = public, extensions, pg_catalog`
- All RPCs: `if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;`
- `FOR UPDATE` row lock before any state mutation (same as `publish_protocol`)
- Audit INSERT always happens BEFORE function returns
- `REVOKE ALL ... FROM public; GRANT EXECUTE ... TO authenticated`
- `begin; ... commit;` transaction wrapper

---

### `supabase/migrations/20290102000003_insights_matviews.sql` (migration, batch)

**Analog:** `supabase/migrations/20290101000001_protocol_tables.sql` (table structure pattern)

**Matview pattern:**
```sql
-- 5 matviews:
-- insights_dose_rollup: aggregate dose adherence metrics per compound/cohort (no user_id)
-- insights_body_metrics_rollup: weight/BMI changes per tenure bucket
-- insights_retention_rollup: retention curves by week + cohort
-- insights_engagement_rollup: gamification + AI coach interaction rates
-- insights_ai_interaction_rollup: AI coach session frequency + NPS proxies

create materialized view if not exists public.insights_dose_rollup as
  select
    compound,
    tenure_bucket,
    count(distinct user_id)  as cohort_size,  -- NEVER expose user_id in output
    avg(adherence_pct)       as avg_adherence
  from <source_table>
  group by compound, tenure_bucket
  having count(distinct user_id) >= 5;  -- k-floor HAVING clause (defense-in-depth)
-- NO user_id column in ANY matview output (PHI-leak gate in CI will catch violations)

create unique index if not exists idx_insights_dose_rollup_compound_tenure
  on public.insights_dose_rollup(compound, tenure_bucket);
```

**Convention bullets:**
- `HAVING count(distinct user_id) >= 5` on every matview (k-anonymity defense-in-depth)
- NO `user_id`, `email`, `phone`, `address` columns in matview SELECT — CI PHI gate will catch
- `CREATE UNIQUE INDEX IF NOT EXISTS` for `REFRESH MATERIALIZED VIEW CONCURRENTLY`
- Cron refreshes via pg_cron at 02:00 UTC — this migration only creates the matview, not the cron job
- `create materialized view IF NOT EXISTS` (idempotent)

---

### `supabase/migrations/20290102000004_research_consent_columns.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20290101000001_protocol_tables.sql` (ALTER TABLE pattern implied)

**Simple ALTER migration:**
```sql
begin;

-- Add research consent columns to profiles
alter table public.profiles
  add column if not exists research_consent     boolean     not null default false,
  add column if not exists consent_revoked_at   timestamptz,
  add column if not exists last_purged_at       timestamptz;

-- Index for nightly purge cron (quickly finds users to purge)
create index if not exists idx_profiles_consent_purge
  on public.profiles(research_consent, consent_revoked_at, last_purged_at)
  where research_consent = false and consent_revoked_at is not null;

commit;
```

**Convention bullets:**
- `ADD COLUMN IF NOT EXISTS` for idempotency
- Default `false` for `research_consent` (opt-in only)
- Partial index `WHERE research_consent = false AND consent_revoked_at IS NOT NULL` for cron efficiency
- No RLS policy changes needed — existing `profiles` RLS already gates on `auth.uid() = id`

---

### `supabase/migrations/20290102000005_pending_rag_ingest_queue.sql` (migration, event-driven)

**Analog:** `supabase/migrations/20290101000001_protocol_tables.sql` (table + trigger pattern)

**Queue table + trigger:**
```sql
begin;

create table if not exists public.pending_rag_ingest (
  id             uuid        not null default gen_random_uuid() primary key,
  publication_id uuid        not null references public.research_publications(id) on delete cascade,
  queued_at      timestamptz not null default now(),
  picked_at      timestamptz,
  completed_at   timestamptz,
  error_message  text
);

-- Trigger: on research_publications status → 'published', enqueue for RAG ingest
create or replace function public.tg_enqueue_rag_ingest()
returns trigger language plpgsql as $$
begin
  if new.status = 'published' and (old.status is null or old.status <> 'published') then
    insert into public.pending_rag_ingest(publication_id, queued_at)
    values (new.id, now())
    on conflict do nothing;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'enqueue_rag_ingest_on_publish'
      and tgrelid = 'public.research_publications'::regclass
  ) then
    create trigger enqueue_rag_ingest_on_publish
      after update on public.research_publications
      for each row execute function public.tg_enqueue_rag_ingest();
  end if;
end $$;

commit;
```

**Convention bullets:**
- `ON DELETE CASCADE` on `publication_id` FK (orphaned queue rows auto-clean)
- `ON CONFLICT DO NOTHING` for idempotent re-publish
- Trigger guard via `pg_trigger` existence check (idempotent)
- `picked_at` / `completed_at` / `error_message` columns for Phase 60 ingest cron to track state

---

### `supabase/functions/research-publish/handler.ts` (service, request-response)

**Analog:** `supabase/functions/protocol-ai-assist/handler.ts` (lines 1-503)

**Copy handler/index.ts split pattern verbatim. Change:**
- No OpenRouter call — this is a markdown→HTML renderer + DB state-machine
- HandlerDeps: `supabaseClient`, `fetchImpl`, `sendSlackAlertFn`, `markdownRenderer`
- HandlerRequest: `{ publication_id: string; actor_id: string }`
- Steps: (1) placeholder guard → (2) Supabase client → (3) fetch publication → (4) 2-person rule check → (5) render markdown → (6) `publish_research` RPC → (7) audit log → (8) return

**Dependency injection pattern** (lines 159-173):
```typescript
export interface HandlerDeps {
  supabaseUrl: string;
  supabaseServiceKey: string;
  slackWebhookUrl?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<...>;
  supabaseClient?: SupabaseLike;
  sendSlackAlertFn?: (...) => Promise<void>;
  markdownRenderer?: (markdown: string) => string; // markdown-it render
  now?: () => Date;
}
```

**Handler skeleton** (lines 249-503 pattern):
```typescript
export async function handleResearchPublish(
  req: HandlerRequest,
  deps: HandlerDeps,
): Promise<HandlerResponse> {
  // Step 1: Placeholder runtime guard (503 + Slack P1 if SUPABASE_SERVICE_ROLE_KEY missing)
  // Step 2: Fetch publication row (select markdown_path, created_by, status)
  // Step 3: 2-person rule check (actor_id === created_by → 401 SELF_REVIEW_REJECTED)
  // Step 4: Render markdown via markdownRenderer dep
  // Step 5: Call publish_research RPC (state machine transition)
  // Step 6: Return { status: 200, body: { html, slug, published_at } }
}
```

**Convention bullets:**
- `MUST NOT import Deno.*` in handler.ts (enables Vitest testing)
- All external deps injected via HandlerDeps (no top-level import of npm: packages)
- Placeholder runtime guard pattern (`PLACEHOLDER_KEY_PATTERN.test(key)` → 503 + Slack P1)
- `HandlerRequest` / `HandlerResponse` interfaces exported for test injection

---

### `supabase/functions/research-publish/index.ts` (config, request-response)

**Analog:** `supabase/functions/protocol-ai-assist/index.ts` (lines 1-162)

**Copy VERBATIM, change:**
- Import `handleResearchPublish` from `./handler.ts` (not `handleAiAssist`)
- Wire `markdownRenderer: (md) => new (await import('npm:markdown-it@14')).default().render(md)`
- Function name in comments: `research-publish` (not `protocol-ai-assist`)
- Remove ragRetrieve, isPharma02GatedTopicFn deps (not needed)

**Key patterns identical** (lines 42-161):
```typescript
// CORS headers pattern (lines 42-46)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// import.meta.main guard (lines 154-156) — CRITICAL
if (import.meta.main) {
  Deno.serve(serveHandler);
}

// JWT extraction + admin.auth.getUser(jwt) pattern (lines 76-103)
```

**Convention bullets:**
- `if (import.meta.main) Deno.serve(...)` guard is MANDATORY per `reference_deno_test_top_level_serve_trap`
- Service-role client: `createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })`
- `jsonResponse(status, body)` helper: same shape as analog (lines 52-60)
- `export { serveHandler }` at bottom for test import

**deno.json** (copy analog exactly):
```json
{
  "imports": {
    "_shared/": "../_shared/"
  }
}
```

---

### `src/lib/markdown/research-renderer.ts` (utility, transform)

**Analog:** `src/lib/markdown/protocol-shortcode-plugin.ts` (lines 1-107)

**Same structure:** Pure function, no React, no side effects, exported parse/render function.

**Diff from analog:** This is a markdown-it renderer wrapper (not a pre-parse segmenter). The analog uses regex-split; this uses markdown-it library.

**Pattern:**
```typescript
/**
 * research-renderer.ts — markdown-it wrapper for research publication rendering.
 *
 * Mirrors src/lib/markdown/protocol-shortcode-plugin.ts structure.
 * Pure function — no React, no side effects.
 *
 * Used by: research-publish Edge Fn (server-side) and optionally admin preview.
 * NOT for browser rendering of untrusted user content (use sanitizeRagMarkdown first).
 */

export interface RenderResult {
  html: string;
  wordCount: number;
  headings: Array<{ level: number; text: string; anchor: string }>;
}

/**
 * Render markdown to HTML using markdown-it.
 * Returns HTML + metadata (word count, heading outline for TOC).
 */
export function renderResearchMarkdown(markdown: string): RenderResult {
  // markdown-it config: typographer, linkify, html=false (no raw HTML injection)
  // Returns { html, wordCount, headings }
}
```

**Convention bullets:**
- `export function` (named export) + `export default` both present (project convention)
- Pure function — no imports of React, Supabase, or Deno.*
- `kebab-case` filename per CLAUDE.md lib/utility naming conventions
- Test file at `src/lib/markdown/__tests__/research-renderer.test.ts` (mirrors `protocol-shortcode-plugin.test.ts`)

---

## Shared Patterns

### 2-Person Review (SELF_REVIEW_REJECTED)
**Source:** `supabase/migrations/20290101000002_protocol_secdef_rpcs.sql` lines 136-143 + `src/components/admin/protocols/ProtocolEditorPage.tsx` lines 149 + `src/components/admin/protocols/ProtocolReviewBanner.tsx`
**Apply to:** `publish_research` RPC + `PublicationEditorPage.tsx` + `ResearchReviewBanner.tsx`

3-layer invariant (per `feedback_3_layer_must_never_invariant_pattern`):
1. DB layer — `publish_research` raises `SELF_REVIEW_REJECTED` when `auth.uid() = created_by`
2. UI layer — Publish button fully removed from DOM when `isSelfCreated` (not just `disabled`)
3. CI layer — eval test asserts 2-person rule at every PR

### is_staff() Guard
**Source:** `supabase/migrations/20261101000006_is_staff_helper.sql`
**Apply to:** All SECDEF RPCs in `20290102000002_insights_secdef_rpcs.sql`

```sql
if not public.is_staff() then
  raise exception 'not authorized' using errcode = '42501';
end if;
```

### Vault Bearer Pattern for Cron
**Source:** `reference_supabase_pg_cron_vault_service_role_pattern` (MEMORY.md)
**Apply to:** Daily matview refresh cron + nightly purge cron in insights migrations

```sql
-- CORRECT vault pattern for this project:
(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')
-- NOT: current_setting('app.service_role_key') — GUC does NOT exist on this project
```

### Supabase Client Import
**Source:** `src/components/admin/protocols/ProtocolsListPage.tsx` line 17
**Apply to:** All admin research components

```typescript
import { supabase } from '@/lib/supabase';
```

### useToast + useStore
**Source:** `src/components/admin/protocols/ProtocolEditorPage.tsx` lines 26-28
**Apply to:** `PublicationEditorPage.tsx`, `CohortBuilderPage.tsx`

```typescript
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';
```

### Admin Module Registration
**Source:** `src/lib/admin/modules.ts` lines 323-337 (protocols entry)
**Apply to:** New `research` module entry

```typescript
{
  key: 'research',
  label: 'Research',
  route: 'research',
  icon: FlaskConical,  // lucide-react
  lazy: () => import('@/components/admin/research/ResearchLayout'),
  flagKey: 'admin_research',
} satisfies AdminModule,
```

### App.tsx selectView Branch
**Source:** `KnowledgeRoute.tsx` / `ProtocolsLayout` registration pattern per CONTEXT.md integration points
**Apply to:** Add `/research/*` branch BEFORE marketing fallback (mirror Phase 60-13 `/knowledge/*`)

### React-router vs pathname routing split
**Source:** CLAUDE.md "No router" constraint + `reference_react_router_consumer_admin_split` (MEMORY.md)
**Rule:** Admin surfaces (`/admin/research/*`) use pathname-based routing (no react-router). Public consumer surfaces (`/research/*`) follow Phase 60-13 knowledge hub pattern which uses `useParams` + `useNavigate` from react-router (admin surfaces only per CLAUDE.md note). Verify which routing mechanism Phase 60-13 actually uses at call site.

### Helmet + JSON-LD Pattern
**Source:** `src/components/knowledge/KnowledgeArticleDetailPage.tsx` lines 196-206
**Apply to:** `PublicResearchArticlePage.tsx` + `PublicResearchIndexPage.tsx`

```tsx
import { Helmet } from 'react-helmet-async';
// <Helmet> is the only meta/title/canonical mechanism — no direct document.title
```

### Placeholder Runtime Guard
**Source:** `supabase/functions/protocol-ai-assist/handler.ts` lines 67 + 256-278
**Apply to:** `research-publish/handler.ts`

```typescript
const PLACEHOLDER_KEY_PATTERN = /^(placeholder|TODO|REPLACE_ME)/i;
if (!key || PLACEHOLDER_KEY_PATTERN.test(key)) {
  // 503 + Slack P1 — NOT a TODO comment
}
```

### Edge Fn handler/index.ts Split
**Source:** `supabase/functions/protocol-ai-assist/handler.ts` + `index.ts`
**Apply to:** `research-publish/handler.ts` + `research-publish/index.ts`

The split exists solely to enable Vitest testing without triggering `Deno.serve`. The `import.meta.main` guard in `index.ts` is mandatory.

### Migration Naming + Ordering
**Source:** `reference_supabase_back_dated_migration_blocks_push` (MEMORY.md)
**Apply to:** All Phase 62 migrations

- Use timestamps `20290102000001` through `20290102000005`
- If migrations need sub-ordering: `20290102000001`, `20290102000002`, etc.
- Never use back-dated timestamps (CLI refuses to push anything if any file is older than last applied)

---

## No Analog Found

All files have analogs. However, these aspects are novel (no existing code to copy from):

| Aspect | Reason | Use RESEARCH.md instead |
|---|---|---|
| `laplace_noise()` PL/pgSQL function | No existing DP functions in codebase | Use pure math: inverse CDF via `random()` + `ln()` |
| `insights_*_rollup` matview SQL bodies | No existing matviews in codebase | Planner discovers exact column names from source tables |
| RSS feed generation (`/research/rss.xml`) | No RSS feed in codebase | RFC 822 pubDate standard; build-time Vite plugin |
| `eval/phase62/no-phi-in-matviews.test.ts` | CI grep gate; pattern exists in other eval phases | Copy `eval/phase61/` test file structure |

---

## Metadata

**Analog search scope:** `leanshot/src/components/admin/protocols/`, `leanshot/src/components/knowledge/`, `leanshot/src/components/dashboard/charts/`, `leanshot/src/components/dashboard/settings/`, `leanshot/src/components/admin/rag/`, `supabase/migrations/20290101*`, `supabase/functions/protocol-ai-assist/`, `leanshot/src/lib/markdown/`, `leanshot/src/lib/admin/modules.ts`
**Files scanned:** 14 analog files read in full
**Pattern extraction date:** 2026-05-26
