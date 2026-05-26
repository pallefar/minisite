---
phase: 61-admin-protocol-creator
plan: 07
type: execute
wave: 1
depends_on:
  - 61-01-db-tables-rls
files_modified:
  - src/components/dashboard/tabs/MedicationTab.tsx
  - src/components/dashboard/tabs/BodyTab.tsx
  - src/components/admin/protocols/ProtocolSummaryCard.tsx
  - src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx
  - src/components/protocols/PublicProtocolPage.tsx
  - src/components/protocols/__tests__/PublicProtocolPage.test.tsx
  - src/lib/markdown/protocol-shortcode-plugin.ts
  - src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts
  - src/lib/hooks/useActiveProtocolAssignment.ts
  - src/App.tsx
  - src/components/knowledge/KnowledgeArticleDetailPage.tsx
  - src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx
autonomous: true
requirements:
  - PROTOCOL-07
  - PROTOCOL-08
must_haves:
  truths:
    - "MedicationTab renders 'Expected: Xmg • Logged: Ymg' row beneath each logged dose entry when patient has an active patient_protocol_assignment AND values differ"
    - "When deviation >20%, the Logged value renders in text-[var(--color-warning)]"
    - "BodyTab inserts a 'Protocol adherence' insights card showing percentage; uses accent color on the percentage number (the one permitted accent use per UI-SPEC reserved-for #5)"
    - "When patient has no active protocol assignment, BodyTab adherence card shows EmptyState micro variant 'No protocol assigned'"
    - "ProtocolSummaryCard renders inline within KB markdown via the new [protocol:<uuid>] shortcode plugin"
    - "parseProtocolShortcodes(text) regex-parses `[protocol:<uuid>]` tokens; returns { segments, protocols } parallel to parseCitations"
    - "KnowledgeArticleDetailPage pre-parses article body via parseProtocolShortcodes BEFORE invoking ReactMarkdown — protocol segments render as <ProtocolSummaryCard />, text segments render via ReactMarkdown (CRITICAL: without this wiring PROTOCOL-08 success criterion #6 fails at runtime)"
    - "PublicProtocolPage at /protocols/<slug> renders for auth'd users only (signed-in); 404 EmptyState when slug doesn't resolve to a published row"
    - "PublicProtocolPage includes <Helmet><meta name='robots' content='noindex' /></Helmet>"
    - "App.tsx selectView extended with /protocols/* branch placed AFTER /knowledge/* and BEFORE /clinic/* and other auth-gated branches"
  artifacts:
    - path: "src/components/admin/protocols/ProtocolSummaryCard.tsx"
      provides: "Inline KB card; reused by Phase 37 markdown renderer"
      exports: ["ProtocolSummaryCard"]
    - path: "src/components/protocols/PublicProtocolPage.tsx"
      provides: "Consumer /protocols/<slug> auth-gated read-only view"
      exports: ["PublicProtocolPage"]
    - path: "src/lib/markdown/protocol-shortcode-plugin.ts"
      provides: "Pre-parse regex pass returning { segments, protocols }"
      exports: ["parseProtocolShortcodes", "PROTOCOL_SHORTCODE_REGEX"]
    - path: "src/lib/hooks/useActiveProtocolAssignment.ts"
      provides: "Reusable hook returning current assignment + week-aware expected step"
      exports: ["useActiveProtocolAssignment"]
    - path: "src/components/knowledge/KnowledgeArticleDetailPage.tsx"
      provides: "Wired-up KB renderer that pre-parses [protocol:<uuid>] shortcodes and renders inline ProtocolSummaryCard alongside ReactMarkdown text segments"
      contains: "parseProtocolShortcodes"
  key_links:
    - from: "MedicationTab"
      to: "patient_protocol_assignment"
      via: "useActiveProtocolAssignment(currentUserId) → expectedStep for current week"
      pattern: "useActiveProtocolAssignment"
    - from: "BodyTab"
      to: "patient_protocol_assignment + injections"
      via: "compute adherence % from last N weeks of logged vs expected"
      pattern: "Protocol adherence"
    - from: "App.tsx selectView"
      to: "/protocols/* branch"
      via: "if (opts.pathname.startsWith('/protocols')) return opts.user ? 'protocols' : 'auth';"
      pattern: "pathname.startsWith\\('/protocols'\\)"
    - from: "parseProtocolShortcodes"
      to: "ProtocolSummaryCard"
      via: "KB renderer resolves segments to React tree"
      pattern: "parseProtocolShortcodes"
    - from: "KnowledgeArticleDetailPage article body"
      to: "ProtocolSummaryCard render"
      via: "parseProtocolShortcodes(sanitizedBody).segments.map(seg => seg.type === 'protocol' ? <ProtocolSummaryCard protocolId={seg.protocolId}/> : <ReactMarkdown>{seg.value}</ReactMarkdown>)"
      pattern: "parseProtocolShortcodes\\(.*sanitizedBody"
---

<objective>
Ship the consumer-facing protocol surfaces: patient dose-log Expected/Logged deviation row (PROTOCOL-07), BodyTab adherence insights card, KB markdown shortcode (PROTOCOL-08), ProtocolSummaryCard, the public auth-gated `/protocols/<slug>` route, AND the KB-renderer wiring that integrates the shortcode parser into the existing KnowledgeArticleDetailPage.

Purpose: Closes the loop from admin authoring → clinician adopt → patient prefill → KB reference. All consumer surfaces are read-only (non-destructive per CONTEXT.md). Patient MedicationTab NEVER overwrites logged doses — only annotates expected values.

**Revision note (iter-1 BLOCKER fix):** The original plan shipped `parseProtocolShortcodes` and `ProtocolSummaryCard` but did NOT wire the parser into any KB renderer — PROTOCOL-08 success criterion #6 ("KB article references protocol_id → renders inline protocol summary card") would have failed silently at runtime. Task 4 (new) closes this by wiring the parser into `src/components/knowledge/KnowledgeArticleDetailPage.tsx` (the consumer KB renderer that uses `<ReactMarkdown>{sanitizedBody}</ReactMarkdown>` at line ~255). NOTE: `remark-citations.ts` is a pure pre-parse parser (not a remark AST plugin); follow that pattern — pre-parse, then render segments outside ReactMarkdown.

Output: 6 new files + 5 modifications (MedicationTab, BodyTab, App.tsx, useActiveProtocolAssignment hook, KnowledgeArticleDetailPage) + 4 unit/integration tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-UI-SPEC.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Markdown plugin pattern — mirror this verbatim (pure pre-parser, NOT a remark AST plugin):
@/Users/karstenhaldan/minisite/leanshot/src/lib/rag/remark-citations.ts

# App.tsx selectView pattern (extend the /knowledge/* branch shape):
@/Users/karstenhaldan/minisite/leanshot/src/App.tsx

# Consumer KB renderer — Task 4 integration target (line ~255 ReactMarkdown invocation):
@/Users/karstenhaldan/minisite/leanshot/src/components/knowledge/KnowledgeArticleDetailPage.tsx

# Patient surfaces to extend:
@/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/MedicationTab.tsx
@/Users/karstenhaldan/minisite/leanshot/src/components/dashboard/tabs/BodyTab.tsx

# Types:
@/Users/karstenhaldan/minisite/leanshot/src/types/protocols.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: useActiveProtocolAssignment hook + MedicationTab Expected/Logged row + BodyTab adherence card</name>
  <files>src/lib/hooks/useActiveProtocolAssignment.ts, src/components/dashboard/tabs/MedicationTab.tsx, src/components/dashboard/tabs/BodyTab.tsx</files>
  <action>
Step 1 — Write `src/lib/hooks/useActiveProtocolAssignment.ts`:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ProtocolStep, PatientProtocolAssignment } from '@/types/protocols';

export interface ActiveAssignment {
  assignment: PatientProtocolAssignment;
  protocol: { id: string; version: number; name: string; compound: string };
  currentWeek: number;
  currentStep: ProtocolStep | null;  // step matching currentWeek (or null if outside protocol duration)
  allSteps: ProtocolStep[];
}

export function useActiveProtocolAssignment(patientId: string | null) {
  const [data, setData] = useState<ActiveAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!patientId) { setData(null); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // 1. Find most recent assignment
      const { data: assignmentRows } = await supabase
        .from('patient_protocol_assignment')
        .select('*')
        .eq('patient_id', patientId)
        .order('started_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      const assignment = assignmentRows?.[0];
      if (!assignment) { setData(null); setLoading(false); return; }

      // 2. Fetch protocol meta
      const { data: protocol } = await supabase
        .from('protocols')
        .select('id, version, name, compound')
        .eq('id', assignment.protocol_id)
        .eq('version', assignment.version)
        .single();
      // 3. Fetch all steps
      const { data: steps } = await supabase
        .from('protocol_steps')
        .select('*')
        .eq('protocol_id', assignment.protocol_id)
        .eq('protocol_version', assignment.version)
        .order('week');
      if (cancelled || !protocol || !steps) { setData(null); setLoading(false); return; }

      // 4. Compute current week from started_at
      const startedMs = new Date(assignment.started_at).getTime();
      const weeksElapsed = Math.floor((Date.now() - startedMs) / (7 * 24 * 60 * 60 * 1000)) + 1;
      const currentStep = steps.find(s => s.week === weeksElapsed) ?? steps.reduce<ProtocolStep | null>(
        (best, s) => (s.week <= weeksElapsed && (!best || s.week > best.week)) ? s : best, null
      );

      setData({
        assignment,
        protocol,
        currentWeek: weeksElapsed,
        currentStep,
        allSteps: steps,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [patientId]);
  return { data, loading };
}
```

Note: per RESEARCH.md Open Question 3 — week computation lives in the browser (simple arithmetic, no server round-trip).

Step 2 — Extend `MedicationTab.tsx`:

Read the file first. Find the dose-log render loop (likely maps `injections[]` to dose-row entries).

Import the hook:
```typescript
import { useActiveProtocolAssignment } from '@/lib/hooks/useActiveProtocolAssignment';
```

At the top of the component:
```typescript
const currentUserId = useStore(s => s.user?.id ?? null);
const { data: activeAssignment } = useActiveProtocolAssignment(currentUserId);
```

For each dose-row in the existing render path, BELOW the existing logged value, conditionally render the Expected/Logged annotation row when:
- activeAssignment exists AND
- activeAssignment.currentStep exists AND
- the dose entry is within the current protocol week

```tsx
{activeAssignment?.currentStep && (() => {
  const expected = activeAssignment.currentStep.dose_mg;
  const logged = injection.dose_mg;
  if (expected === logged) return null;
  const deviationPct = Math.abs(expected - logged) / expected;
  const loggedClass = deviationPct > 0.2 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]';
  return (
    <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">
      Expected: <span className="font-mono tabular-nums">{expected}mg</span>
      <span className="mx-1 text-[var(--color-text-tertiary)]">•</span>
      Logged: <span className={`font-mono tabular-nums ${loggedClass}`}>{logged}mg</span>
    </div>
  );
})()}
```

Per UI-SPEC Surface 5: this is informational only, never blocking. The dot separator `•` styled with text-tertiary.

Step 3 — Extend `BodyTab.tsx`:

Read the file. Find the insights-card grid (existing Phase 38 analog per CONTEXT.md Code Context).

Add a new Card to the grid:

```tsx
import { useActiveProtocolAssignment } from '@/lib/hooks/useActiveProtocolAssignment';

// Inside BodyTab component:
const currentUserId = useStore(s => s.user?.id ?? null);
const { data: activeAssignment } = useActiveProtocolAssignment(currentUserId);
const injections = useStore(s => s.injections);

const adherencePct = useMemo(() => {
  if (!activeAssignment) return null;
  // Last N weeks where N = min(current_week, 4)
  const weeks = Math.min(activeAssignment.currentWeek, 4);
  const recentInjections = injections.filter(inj => {
    const d = new Date(inj.timestamp).getTime();
    return d >= Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
  });
  if (recentInjections.length === 0) return 0;
  let onTarget = 0;
  for (const inj of recentInjections) {
    const injDate = new Date(inj.timestamp);
    const weekOffset = Math.floor((injDate.getTime() - new Date(activeAssignment.assignment.started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const step = activeAssignment.allSteps.find(s => s.week === weekOffset);
    if (!step) continue;
    const deviation = Math.abs(step.dose_mg - inj.dose_mg) / step.dose_mg;
    if (deviation <= 0.2) onTarget += 1;
  }
  return Math.round((onTarget / recentInjections.length) * 100);
}, [activeAssignment, injections]);

// Render card in existing insights grid:
<Card variant="default" padding="md">
  <CardHeader title="Protocol adherence" />
  {activeAssignment ? (
    <div className="space-y-1">
      <p className="text-heading font-semibold text-[var(--color-primary)] tabular-nums">{adherencePct ?? 0}%</p>
      <p className="text-[11px] text-[var(--color-text-secondary)]">last {Math.min(activeAssignment.currentWeek, 4)} weeks</p>
    </div>
  ) : (
    <p className="text-[13px] text-[var(--color-text-secondary)]">No protocol assigned</p>
  )}
</Card>
```

Per UI-SPEC Surface 6: this is the ONE numeric display permitted to use accent color (reserved-for #5).

Constraints:
  - Read MedicationTab.tsx + BodyTab.tsx ONCE; extract patterns; modify minimally
  - Existing dose-log entries MUST NOT be overwritten by protocol expectations (UI-SPEC: non-destructive)
  - Typography: only 11/13/18/28 px sizes; only font-normal / font-semibold
  - Accent color used ONLY on adherence percentage number (and nowhere else in BodyTab additions)
  - Hook handles null patientId gracefully (returns null data)
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/lib/hooks/useActiveProtocolAssignment.ts && grep -q "useActiveProtocolAssignment" src/components/dashboard/tabs/MedicationTab.tsx && grep -q "Protocol adherence" src/components/dashboard/tabs/BodyTab.tsx && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | grep -E "(MedicationTab|BodyTab|useActiveProtocolAssignment)" | (! grep -q .)</automated>
  </verify>
  <done>Hook exists; MedicationTab + BodyTab import + use it; tsc shows no new errors.</done>
</task>

<task type="auto">
  <name>Task 2: ProtocolSummaryCard + parseProtocolShortcodes + tests</name>
  <files>src/lib/markdown/protocol-shortcode-plugin.ts, src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts, src/components/admin/protocols/ProtocolSummaryCard.tsx, src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx</files>
  <action>
Step 1 — Read `src/lib/rag/remark-citations.ts` once (the parser pattern template).

Step 2 — Write `src/lib/markdown/protocol-shortcode-plugin.ts` mirroring the remark-citations.ts structure:

```typescript
// Phase 61 Plan 07 — KB shortcode parser for [protocol:<uuid>] tokens.
// Mirrors src/lib/rag/remark-citations.ts; pre-parse pass, NOT a remark AST plugin.

export const PROTOCOL_SHORTCODE_REGEX = /\[protocol:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

export type ProtocolSegment =
  | { type: 'text'; value: string }
  | { type: 'protocol'; protocolId: string; refIndex: number };

export interface ProtocolRef {
  protocolId: string;
  refIndex: number;  // 1-based, first occurrence wins
}

export interface ProtocolParseResult {
  segments: ProtocolSegment[];
  protocols: ProtocolRef[];
}

export function parseProtocolShortcodes(text: string): ProtocolParseResult {
  const segments: ProtocolSegment[] = [];
  const protocols: ProtocolRef[] = [];
  const seen = new Map<string, number>();
  let lastIndex = 0;
  PROTOCOL_SHORTCODE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROTOCOL_SHORTCODE_REGEX.exec(text)) !== null) {
    const protocolId = match[1]!.toLowerCase();
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    let refIndex = seen.get(protocolId);
    if (refIndex === undefined) {
      refIndex = protocols.length + 1;
      seen.set(protocolId, refIndex);
      protocols.push({ protocolId, refIndex });
    }
    segments.push({ type: 'protocol', protocolId, refIndex });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return { segments, protocols };
}
```

Step 3 — Write `src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts`:
- Test 1: text with no shortcode → `segments` = single text segment; `protocols` = [] (empty)
- Test 2: text with one shortcode `[protocol:00000000-0000-0000-0000-000000000061]` → 3 segments (text, protocol, text); protocols length 1; refIndex=1
- Test 3: text with same shortcode TWICE → 5 segments; protocols length 1 (deduped); both protocol segments have refIndex=1
- Test 4: text with two DIFFERENT shortcodes → protocols length 2; refIndex 1 and 2
- Test 5: malformed shortcode `[protocol:not-a-uuid]` → treated as plain text; segments length 1; protocols length 0

Step 4 — Write `src/components/admin/protocols/ProtocolSummaryCard.tsx` per PATTERNS.md ProtocolSummaryCard pattern:

```typescript
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';

export interface ProtocolSummaryData {
  id: string;
  title: string;
  compound: string;
  week_count: number;
  slug: string;          // base_slug for /protocols/<slug> link
}

export interface ProtocolSummaryCardProps {
  protocolId: string;
}

export function ProtocolSummaryCard({ protocolId }: ProtocolSummaryCardProps) {
  const [data, setData] = useState<ProtocolSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fetch latest published version for this id
      const { data: rows, error: err } = await supabase
        .from('protocols')
        .select('id, name, compound, base_slug, version')
        .eq('id', protocolId)
        .eq('review_state', 'published')
        .order('version', { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (err || !rows || rows.length === 0) {
        setError('Protocol unavailable');
        return;
      }
      const protocol = rows[0]!;
      // Count steps for this version
      const { count } = await supabase
        .from('protocol_steps')
        .select('id', { count: 'exact', head: true })
        .eq('protocol_id', protocol.id)
        .eq('protocol_version', protocol.version);
      if (cancelled) return;
      setData({
        id: protocol.id,
        title: protocol.name,
        compound: protocol.compound,
        week_count: count ?? 0,
        slug: protocol.base_slug,
      });
    })();
    return () => { cancelled = true; };
  }, [protocolId]);

  if (error) {
    return (
      <Card variant="flat" padding="md" className="max-w-[480px] w-full">
        <p className="text-[13px] text-[var(--color-text-secondary)]">Protocol unavailable</p>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card variant="flat" padding="md" className="max-w-[480px] w-full">
        <div className="h-12 animate-pulse bg-[var(--color-surface-elevated)] rounded" />
      </Card>
    );
  }
  return (
    <Card variant="flat" padding="md" className="max-w-[480px] w-full">
      <div className="space-y-1">
        <p className="text-[13px] font-semibold">{data.title}</p>
        <p className="text-[13px] text-[var(--color-text-secondary)]">{data.compound}</p>
        <div className="flex items-center gap-2 mt-2">
          <Badge tone="neutral" aria-label={`${data.week_count} weeks`}>{data.week_count} weeks</Badge>
          <a
            href={`/protocols/${data.slug}`}
            className="text-[13px] text-[var(--color-primary)] hover:underline ms-auto"
          >
            View full protocol →
          </a>
        </div>
      </div>
    </Card>
  );
}
```

Step 5 — Test `ProtocolSummaryCard.test.tsx`:
- Mock supabase chain to return a published protocol + step count = 6
- Render `<ProtocolSummaryCard protocolId="00000000-0000-0000-0000-000000000061" />`
- Wait for fetch resolution; assert title 'Tirzepatide 12-week titration', compound 'tirzepatide', '6 weeks' badge, link href '/protocols/tirzepatide-12-week-titration'
- Separate test: mock returns no rows (404) → renders 'Protocol unavailable'
- Separate test: while loading, skeleton element present (animate-pulse class)

Constraints:
  - UUID regex MUST match exactly RFC 4122 form (8-4-4-4-12 hex)
  - Card uses Card DS primitive `variant="flat"`
  - Link uses `var(--color-primary)` — the one permitted accent use on interactive links (UI-SPEC reserved-for #4 equivalent)
  - Typography ceiling honored
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/lib/markdown/protocol-shortcode-plugin.ts && test -f src/components/admin/protocols/ProtocolSummaryCard.tsx && npx vitest run --config vite.config.ts src/lib/markdown/__tests__/protocol-shortcode-plugin.test.ts src/components/admin/protocols/__tests__/ProtocolSummaryCard.test.tsx 2>&1 | tail -25 | grep -E "passed|✓"</automated>
  </verify>
  <done>Shortcode parser + ProtocolSummaryCard exist; 2 test files green (5 + 3 cases respectively).</done>
</task>

<task type="auto">
  <name>Task 3: PublicProtocolPage + App.tsx selectView /protocols/* branch</name>
  <files>src/components/protocols/PublicProtocolPage.tsx, src/components/protocols/__tests__/PublicProtocolPage.test.tsx, src/App.tsx</files>
  <action>
Step 1 — Write `src/components/protocols/PublicProtocolPage.tsx` per PATTERNS.md `PublicProtocolPage` pattern (knowledge analog) + UI-SPEC Surface 8:

```typescript
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { supabase } from '@/lib/supabase';
import type { Protocol, ProtocolStep, ProtocolEvidence } from '@/types/protocols';

interface ProtocolViewData {
  protocol: Pick<Protocol, 'id' | 'version' | 'name' | 'compound' | 'audience' | 'slug' | 'base_slug' | 'published_at'>;
  steps: ProtocolStep[];
  evidence: ProtocolEvidence[];
}

function getSlugFromPathname(): string | null {
  const m = window.location.pathname.match(/^\/protocols\/([^/]+)\/?$/);
  return m ? m[1]! : null;
}

export function PublicProtocolPage() {
  const slug = getSlugFromPathname();
  const [data, setData] = useState<ProtocolViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data: rpcRows, error } = await supabase.rpc('get_protocol_by_slug', { p_base_slug: slug });
      if (cancelled) return;
      if (error || !rpcRows || (Array.isArray(rpcRows) ? rpcRows.length === 0 : !rpcRows.id)) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      // RPC returns a single row (table-returning function)
      const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      setData({
        protocol: { id: row.id, version: row.version, name: row.name, compound: row.compound, audience: row.audience, slug: row.slug, base_slug: row.base_slug, published_at: row.published_at },
        steps: row.steps ?? [],
        evidence: row.evidence ?? [],
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <>
      <Helmet>
        <meta name="robots" content="noindex" />
        {data && <title>{data.protocol.name} — LeanShot</title>}
      </Helmet>
      <main className="max-w-[680px] mx-auto px-6 py-12">
        {loading && <Skeleton className="h-32 mb-4" />}
        {notFound && (
          <EmptyState title="Protocol not found" body="This protocol is not available." />
        )}
        {data && (
          <>
            <h1 className="text-heading font-semibold mb-2">{data.protocol.name}</h1>
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] mb-6">
              <span>{data.protocol.compound}</span>
              <span aria-hidden="true">•</span>
              {data.protocol.audience.map(a => <Pill key={a} size="sm">{a}</Pill>)}
              <span aria-hidden="true">•</span>
              <span className="text-[11px] font-mono">v{data.protocol.version}</span>
              {data.protocol.published_at && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="text-[11px]">{new Date(data.protocol.published_at).toLocaleDateString()}</span>
                </>
              )}
            </div>
            <table className="w-full text-[13px] mb-8" aria-label="Protocol steps">
              <thead>
                <tr className="text-[11px] text-[var(--color-text-secondary)]">
                  <th className="text-left py-2">Week</th>
                  <th className="text-left py-2">Dose</th>
                  <th className="text-left py-2">Frequency</th>
                  <th className="text-left py-2">Monitoring</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map(step => (
                  <tr key={step.id} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-mono tabular-nums">{step.week}</td>
                    <td className="py-2 font-mono tabular-nums">{step.dose_mg}mg</td>
                    <td className="py-2">{step.frequency}</td>
                    <td className="py-2">{step.monitoring.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.evidence.length > 0 && (
              <section>
                <h2 className="text-[18px] font-semibold mb-3">Supporting Evidence</h2>
                <ol className="space-y-2">
                  {data.evidence.map((e, i) => (
                    <li key={e.id} className="text-[13px]">
                      <sup className="text-[11px] text-[var(--color-text-secondary)]">[{i + 1}]</sup> {e.citation_text}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
```

NOTE: The RPC `get_protocol_by_slug` returns a TABLE; supabase-js may return it as either an array or single object depending on call shape. The defensive `Array.isArray(rpcRows)` handles both.

Step 2 — Write `__tests__/PublicProtocolPage.test.tsx`:
- Mock window.location.pathname='/protocols/tirzepatide-12-week-titration'
- Mock supabase.rpc to return a single protocol row with 6 steps + 2 evidence rows
- Render PublicProtocolPage wrapped in HelmetProvider
- Assert H1 with protocol name; 6 step rows; 2 evidence entries with [1]/[2] markers
- Separate test: mock RPC returns empty array → assert 'Protocol not found' EmptyState + 'This protocol is not available.' body

Step 3 — Extend `src/App.tsx` per RESEARCH.md Pattern 6 + Pitfall 7:

Read App.tsx around lines 660-720 (the selectView function and the /knowledge/* branch). Add the /protocols/* branch:

```typescript
// Place BEFORE the View type declaration is fine; the View union (around line 629)
// already needs a new literal. Add 'protocols' to the View type:
type View = ... | 'knowledge' | 'protocols';

// In selectView (around line 684), AFTER the /knowledge/* branch (line 693) and BEFORE
// the auth-callback branch (line 699):

// Phase 61 Plan 07 — /protocols/<slug> auth-gated public route (PROTOCOL-08).
// Per reference Pitfall 7: ordering matters. Place AFTER /knowledge/* (public) and
// BEFORE /clinic/* + auth-gated branches. Unlike /knowledge (no-auth), this branch
// REQUIRES auth — non-authenticated users bounce to 'auth' view.
if (opts.pathname.startsWith('/protocols')) {
  return opts.user ? 'protocols' : 'auth';
}
```

Add the lazy import near the existing Knowledge lazy:
```typescript
const PublicProtocolPage = lazy(() =>
  import('@/components/protocols/PublicProtocolPage').then(m => ({ default: m.PublicProtocolPage }))
);
```

Add the render branch in the view switch:
```typescript
case 'protocols':
  return (
    <Suspense fallback={<div className="p-6"><Skeleton /></div>}>
      <PublicProtocolPage />
    </Suspense>
  );
```

Constraints:
  - Per Pitfall 7: ordering matters — /protocols/* AFTER /knowledge/* and BEFORE auth-gated branches
  - Use existing `Helmet` import via react-helmet-async (already a dependency from Phase 60-13)
  - SEO noindex MUST render in Helmet head
  - RPC `get_protocol_by_slug` was provided by Plan 02 — DO NOT add a new RPC
  - Typography ceiling honored
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && test -f src/components/protocols/PublicProtocolPage.tsx && grep -q "pathname.startsWith('/protocols')" src/App.tsx && grep -q "PublicProtocolPage" src/App.tsx && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | grep -E "(PublicProtocolPage|App\\.tsx)" | (! grep -q .) && npx vitest run --config vite.config.ts src/components/protocols/__tests__/PublicProtocolPage.test.tsx 2>&1 | tail -15 | grep -E "passed|✓"</automated>
  </verify>
  <done>PublicProtocolPage renders for valid slug + shows 404 EmptyState for missing; App.tsx selectView includes /protocols/* branch ordered correctly; tsc clean; unit test green.</done>
</task>

<task type="auto">
  <name>Task 4: Wire parseProtocolShortcodes into KnowledgeArticleDetailPage (BLOCKER fix — closes PROTOCOL-08 success criterion #6)</name>
  <files>src/components/knowledge/KnowledgeArticleDetailPage.tsx, src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx</files>
  <action>
**Context (why this task exists):** Iter-1 plan-check BLOCKER. Tasks 2 + 3 ship `parseProtocolShortcodes` and `ProtocolSummaryCard` but no consumer wires them. Without this task, PROTOCOL-08 success criterion #6 ("KB article references protocol_id → renders inline protocol summary card") FAILS at runtime — articles containing `[protocol:<uuid>]` would render the raw token as text.

**Integration target identified (revision iter-1 grep):**
- File: `src/components/knowledge/KnowledgeArticleDetailPage.tsx`
- Current invocation: line ~255 `<ReactMarkdown>{sanitizedBody}</ReactMarkdown>` inside an `<article>` wrapper
- Pattern to mirror: `src/lib/rag/remark-citations.ts` is a PURE pre-parser (not a remark AST plugin). Pre-parse the body string, then render an array of segments — text segments via ReactMarkdown, protocol segments via `<ProtocolSummaryCard />` — outside ReactMarkdown's single-string contract.

**Step 1 — Read the current renderer ONCE:**

```bash
# Lines around the ReactMarkdown invocation. Read the surrounding article block to preserve
# className + aria-label + sanitizedBody variable name + import block.
sed -n '1,40p;240,260p' src/components/knowledge/KnowledgeArticleDetailPage.tsx
```

Expected anchor (line ~255):
```tsx
<article className="prose ..." aria-label="Article body">
  <ReactMarkdown>{sanitizedBody}</ReactMarkdown>
</article>
```

**Step 2 — Add imports near the existing `ReactMarkdown` import:**

```typescript
import { parseProtocolShortcodes } from '@/lib/markdown/protocol-shortcode-plugin';
import { ProtocolSummaryCard } from '@/components/admin/protocols/ProtocolSummaryCard';
```

NOTE: `ProtocolSummaryCard` currently lives under `src/components/admin/protocols/` — this import crosses the admin/consumer boundary but is intentional per PATTERNS.md ("ProtocolSummaryCard is reusable across surfaces"). If Phase 62 relocates it, this is the consumer call-site to update.

**Step 3 — Replace the single `<ReactMarkdown>{sanitizedBody}</ReactMarkdown>` invocation with segment-aware rendering:**

```tsx
{(() => {
  // Phase 61 Plan 07 Task 4 — pre-parse [protocol:<uuid>] shortcodes BEFORE handing
  // markdown to ReactMarkdown. Mirrors the remark-citations.ts pure-parser pattern.
  // Text segments render as markdown; protocol segments render inline as ProtocolSummaryCard.
  const { segments } = parseProtocolShortcodes(sanitizedBody);
  return segments.map((seg, i) => {
    if (seg.type === 'protocol') {
      return (
        <div key={`protocol-${i}-${seg.protocolId}`} className="my-4 not-prose">
          <ProtocolSummaryCard protocolId={seg.protocolId} />
        </div>
      );
    }
    // Text segment — render as markdown. ReactMarkdown handles empty strings gracefully.
    return <ReactMarkdown key={`text-${i}`}>{seg.value}</ReactMarkdown>;
  });
})()}
```

Notes on the inline implementation choice:
- An IIFE keeps the change scoped to ONE expression slot inside the existing `<article>` element — minimizes risk to surrounding header / sources panel / footer logic.
- `not-prose` on the protocol wrapper opts the ProtocolSummaryCard OUT of the `prose` typography reset that surrounds article bodies (prevents card text being re-styled by prose CSS).
- Keys combine index + protocolId to remain stable when the same protocol is referenced twice.

**Step 4 — Write the integration test `src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx`:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { KnowledgeArticleDetailPage } from '@/components/knowledge/KnowledgeArticleDetailPage';

// Mock supabase + any other module deps that the page eagerly imports
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({
        // Stub article row WITH a [protocol:<uuid>] shortcode in the body.
        // Match the actual KnowledgeArticleDetailPage data contract — inspect the
        // file's fetch shape during execution and align this stub.
        data: {
          id: 'article-1',
          title: 'Tirzepatide titration guide',
          summary: 'Intro paragraph.\n\nSee the canonical protocol: [protocol:00000000-0000-0000-0000-000000000061] for week-by-week dosing.\n\nClosing paragraph.',
          slug: 'tirzepatide-titration',
          topic_tag: 'medication',
          source_tier: 'A',
          published_at: '2026-05-01T00:00:00Z',
        },
        error: null,
      })),
      // ProtocolSummaryCard's own fetch for the published protocol
      // (executor wires this in based on Task 2's ProtocolSummaryCard query shape)
    })),
  },
}));

// Stub window.location for slug resolution
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { pathname: '/knowledge/medication/tirzepatide-titration' },
    writable: true,
  });
});

describe('KB article with [protocol:<uuid>] shortcode (integration)', () => {
  it('renders ProtocolSummaryCard inline within the markdown article body', async () => {
    render(
      <HelmetProvider>
        <KnowledgeArticleDetailPage />
      </HelmetProvider>
    );

    // Wait for article fetch to resolve
    await waitFor(() => expect(screen.getByText(/Tirzepatide titration guide/i)).toBeInTheDocument());

    // CRITICAL ASSERTION: the raw shortcode token MUST NOT appear in the rendered DOM
    expect(screen.queryByText(/\[protocol:00000000-0000-0000-0000-000000000061\]/)).toBeNull();

    // CRITICAL ASSERTION: a ProtocolSummaryCard element rendered in its place
    // (asserted via either the Card's data attribute, the link to /protocols/<slug>,
    // or the title fetched by ProtocolSummaryCard's own supabase call — pick whichever
    // proxy is most stable given the executor's chosen ProtocolSummaryCard data hooks)
    await waitFor(() => {
      // Default proxy: the card renders 'View full protocol →' link
      expect(screen.getByText(/View full protocol/i)).toBeInTheDocument();
    });

    // Surrounding markdown text still renders
    expect(screen.getByText(/Intro paragraph\./)).toBeInTheDocument();
    expect(screen.getByText(/Closing paragraph\./)).toBeInTheDocument();
  });

  it('renders markdown text segments unchanged when no shortcode is present', async () => {
    // Re-mock supabase to return article WITHOUT shortcode
    // ... (executor inlines the alt mock or restructures with a per-test override)
    // Assert: no ProtocolSummaryCard renders; markdown body intact
  });
});
```

NOTE: The executor will need to align the supabase mock shape with the actual `KnowledgeArticleDetailPage` fetch contract (likely a `chunks` + `source` join based on lines 1-40 of the file). The integration test's job is to assert the WIRING — that `parseProtocolShortcodes(sanitizedBody)` is invoked and protocol segments render as `<ProtocolSummaryCard />`. If the supabase mock shape diverges, fix the mock — DO NOT skip the assertion.

**Step 5 — Verify locally:**

```bash
npx vitest run --config vite.config.ts src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx
```

Should pass with at least the primary assertion (raw token absent + ProtocolSummaryCard rendered).

Constraints:
  - DO NOT refactor the surrounding KnowledgeArticleDetailPage structure (header / sources panel / footer / related articles). Single-expression replacement at the ReactMarkdown call site only.
  - DO NOT bypass `sanitizedBody` — pre-parse OPERATES on the sanitized string. The sanitize layer (T-60-13 XSS defense) runs first; shortcode parsing runs second.
  - DO NOT add `dangerouslySetInnerHTML` anywhere. ProtocolSummaryCard is a React component; segment rendering uses React children only.
  - Typography ceiling honored (ProtocolSummaryCard already conforms from Task 2).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite/leanshot && grep -q "parseProtocolShortcodes" src/components/knowledge/KnowledgeArticleDetailPage.tsx && grep -q "ProtocolSummaryCard" src/components/knowledge/KnowledgeArticleDetailPage.tsx && test -f src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | grep -E "(KnowledgeArticleDetailPage|KbProtocolShortcode)" | (! grep -q .) && npx vitest run --config vite.config.ts src/components/knowledge/__tests__/KbProtocolShortcode.integration.test.tsx 2>&1 | tail -15 | grep -E "passed|✓"</automated>
  </verify>
  <done>KnowledgeArticleDetailPage imports parseProtocolShortcodes + ProtocolSummaryCard; the ReactMarkdown call site is wrapped with segment-aware rendering; integration test asserts raw token is absent from DOM AND ProtocolSummaryCard rendered in its place; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Patient browser → patient_protocol_assignment | RLS auth.uid() = patient_id; can only read own assignment |
| Authenticated user → /protocols/<slug> | RLS public_published_select policy on protocols restricts to review_state='published'; non-staff cannot see drafts |
| KB markdown shortcode → ProtocolSummaryCard fetch | Fetch filtered by review_state='published'; non-published protocol IDs render 'Protocol unavailable' |
| KB article body → parseProtocolShortcodes pre-parse pass | Sanitized markdown body crosses into a regex pre-parser; ONLY RFC 4122 UUID-format shortcodes match (malformed tokens left as plain text) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-07-01 | Information disclosure | Slug enumeration discovers unpublished protocol via /protocols/<slug> | mitigate | RLS filters protocols SELECT to review_state='published' for non-staff; UUID-derived slugs non-sequential; noindex prevents crawler caching |
| T-61-07-02 | Tampering | XSS via [protocol:<uuid>] shortcode injection in KB markdown | mitigate | Regex strictly matches RFC 4122 UUID format; ProtocolSummaryCard renders via React (escaped); no dangerouslySetInnerHTML; sanitize layer runs BEFORE shortcode pre-parse |
| T-61-07-03 | Information disclosure | Cross-patient data leak via useActiveProtocolAssignment | mitigate | Hook queries with `eq('patient_id', currentUserId)`; RLS auth.uid()=patient_id backstops |
| T-61-07-04 | Tampering | Patient MedicationTab overwrites their logged dose with expected dose | mitigate | Per CONTEXT.md non-destructive: Expected/Logged row is purely annotation; render-only, no write path. Existing dose-log handlers unchanged |
| T-61-07-05 | Spoofing | Unauthenticated user visits /protocols/<slug> | mitigate | selectView returns 'auth' (not 'protocols') when opts.user is null; bounce to auth flow |
| T-61-07-06 | Tampering | Malicious KB article author injects fake protocol UUID to render confusing ProtocolSummaryCard | mitigate | ProtocolSummaryCard fetches with `review_state='published'` filter; unknown/draft UUIDs → 'Protocol unavailable' fallback (no spoofed content rendered) |
</threat_model>

<verification>
- All 4 new test files green (shortcode parser, ProtocolSummaryCard, PublicProtocolPage, KbProtocolShortcode integration)
- `grep "pathname.startsWith('/protocols')" src/App.tsx` returns 1 match
- `grep "useActiveProtocolAssignment" src/components/dashboard/tabs/MedicationTab.tsx` returns 1 match
- `grep "Protocol adherence" src/components/dashboard/tabs/BodyTab.tsx` returns 1 match
- `grep "parseProtocolShortcodes" src/components/knowledge/KnowledgeArticleDetailPage.tsx` returns 1 match (Task 4 wiring confirmation)
- `npx tsc -p tsconfig.app.json --noEmit` shows no new errors in modified files
- Ordering: in selectView, /protocols/* branch appears AFTER /knowledge/* and BEFORE /clinic/* or auth-gated branches
- Integration test asserts raw `[protocol:<uuid>]` token is NOT present in rendered DOM (closes BLOCKER)
</verification>

<success_criteria>
- [ ] useActiveProtocolAssignment hook returns assignment + currentStep + currentWeek
- [ ] MedicationTab renders Expected/Logged row only when values differ; warning color on >20% deviation
- [ ] BodyTab adherence card uses accent color on percentage number ONLY
- [ ] parseProtocolShortcodes deduplicates by protocolId; refIndex stable
- [ ] ProtocolSummaryCard fetches latest published version; 404 fallback works
- [ ] PublicProtocolPage uses Helmet noindex; renders 404 EmptyState when slug doesn't resolve
- [ ] App.tsx selectView branch placed correctly per Pitfall 7
- [ ] KnowledgeArticleDetailPage wires parseProtocolShortcodes + renders ProtocolSummaryCard inline (BLOCKER fix)
- [ ] Integration test proves raw shortcode token is replaced by ProtocolSummaryCard at runtime
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-07-SUMMARY.md` documenting the hook contract, deviation calc logic, shortcode regex format, the selectView branch ordering rationale, AND the KB renderer wiring approach (segment-aware rendering around the existing ReactMarkdown call site, sanitize-then-parse ordering).
</output>
