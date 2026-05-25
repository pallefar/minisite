# Phase 41: Public Status Page + Embed-Provider Blocks — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 18 new/modified files (5 retrofit, 12 new, 1 vendor-config)
**Analogs found:** 17 / 18 (one greenfield Vercel middleware — RESEARCH §Pattern 3 is the analog)
**Working dir:** `/Users/karstenhaldan/minisite/leanshot`
**Git root:** `/Users/karstenhaldan/minisite` (per `reference_minisite_monorepo_layout`)

---

## File Classification

### Workstream A — Better Stack (POLISH-10)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/tests/smoke/status-page.smoke.test.ts` | test (smoke) | request-response | `leanshot/tests/csp/csp-snapshot.test.ts` | role-match (file-read assertion) |
| Better Stack vendor config | vendor-config | event-driven (incident webhooks) | n/a — vendor-side | no analog (HUMAN-UAT only) |

### Workstream B — Consent emit retrofit (foundation)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/src/components/consent/consent-config.ts` (EDIT) | config + event emitter | event-driven | itself — existing `onChange`/`onConsent`/`onFirstConsent` callbacks | retrofit (extend in place) |
| `leanshot/src/lib/consent/consent-event.ts` (NEW) | utility (canonical event name + subscribe helper) | event-driven | `leanshot/src/lib/consent/consent-defer.ts` (Phase 22 sibling) | role-match |

### Workstream B — Embed blocks (retrofit + new)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx` (EDIT) | component (preview) | event-driven (consent) + request-response (iframe load) | itself — current shell stays; wrap iframe in `<ConsentGatedEmbed>` | retrofit |
| `leanshot/src/components/admin/pages/blocks/YouTubeBlock.tsx` (EDIT) | component | same | `CalendlyBlock.tsx` (sibling) | exact |
| `leanshot/src/components/admin/pages/blocks/TallyBlock.tsx` (EDIT) | component | same | `CalendlyBlock.tsx` (sibling) | exact |
| `leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx` (NEW) | component | same | `CalendlyBlock.tsx` | exact |
| `leanshot/src/components/admin/pages/blocks/ConsentGatedEmbed.tsx` (NEW) | component (HOC) | event-driven | `CalendlyBlock.tsx` Skeleton+iframe state machine | role-match |
| `leanshot/src/components/admin/pages/blocks/EmbedPlaceholderCard.tsx` (NEW) | component (presentational) | none | DSv2 `Card` primitive (`leanshot/src/components/ui/Card.tsx`) | role-match |
| `leanshot/src/components/admin/pages/editor/property-configs.ts` (EDIT) | config | none | itself — extend `PROPERTY_CONFIGS` map with `custom_iframe` key | exact |
| `leanshot/src/lib/page-builder/block-schema.ts` (EDIT) | model (type union) | none | itself — extend `BlockType` literal union | exact |
| `leanshot/src/lib/page-builder/embed-src.ts` (EDIT) | utility (pure URL/HTML builders) | none | itself — add `validateCustomIframeUrl` + `buildCustomIframeIframeHtml` mirroring existing `parseAndValidateUrl`/`buildCalendlyIframeHtml` | exact |
| `leanshot/src/lib/page-builder/custom-iframe-validate.ts` (NEW, optional) | utility | none | `embed-src.ts` `parseAndValidateUrl` (lines 86-97) | exact |

### Workstream B — Public-page renderer (Deno)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `supabase/functions/page-render/render.ts` (EDIT) | service (HTML renderer) | request-response | itself — `renderEmbedCalendly` (lines 663-672) | retrofit + new case |

### Workstream B — Dynamic CSP middleware (NEW seam)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/middleware.ts` (NEW) | middleware | request-response (header mutation) | none in repo (project is Vite SPA, never used middleware before) | RESEARCH §Pattern 3 is the only analog |
| `leanshot/vercel.json` (EDIT) | config (CSP header) | none | itself — extend `frame-src` / `script-src` / `img-src` / `connect-src` | exact |
| `leanshot/tests/csp/csp-snapshot.txt` (EDIT) | test fixture | none | itself — regenerate from `vercel.json` after edit | exact |

### Workstream B — Allowlist storage + RPCs

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `supabase/migrations/<ts>_p41_iframe_allowlist.sql` (NEW) | migration (DDL) | none | `supabase/migrations/20260601000001_audit_logs.sql` (table + RLS deny pattern) | role-match |
| `supabase/migrations/<ts>_p41_iframe_allowlist_rpcs.sql` (NEW) | migration (SECDEF RPCs) | request-response | `supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql` (6-arg `log_admin_action` call) | exact |
| `leanshot/src/lib/admin/iframe-allowlist.ts` (NEW) | service (admin client wrappers) | CRUD | `leanshot/src/lib/admin/` siblings (per RESEARCH §Recommended Structure) | role-match |

### Workstream B — Allowlist superadmin UI

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/src/lib/admin/modules.ts` (EDIT) | config (manifest) | none | itself — add `{ key: 'embeds', minRole: 'superadmin' }` entry mirroring `anomaly` (line 170-181) | exact |
| `leanshot/src/components/admin/embeds/AllowlistPage.tsx` (NEW) | component (page) | CRUD | `leanshot/src/components/admin/anomaly/AnomalyConfigPage.tsx` (superadmin module sibling) | role-match |
| `leanshot/src/components/admin/embeds/AddHostnameForm.tsx` (NEW) | component (form) | CRUD | DSv2 `Input` + `Button` + `useToast` composition | role-match |
| `leanshot/src/components/admin/embeds/AllowlistTable.tsx` (NEW) | component (table) | CRUD | n/a — verify against project admin tables | role-match |
| `leanshot/src/components/admin/embeds/RemoveHostnameConfirm.tsx` (NEW) | component (modal) | request-response | DSv2 `Confirm` primitive | role-match |
| `leanshot/src/components/admin/embeds/ReferencesSheet.tsx` (NEW) | component (drawer) | request-response | DSv2 `Sheet` primitive | role-match |

### Workstream B — Calendly OAuth popup (EMBED-08)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/src/components/admin/pages/editor/CalendlyPreviewPopup.tsx` (NEW) | component (popup orchestrator) | event-driven (postMessage) | no existing popup-OAuth flow in repo | RESEARCH §Code Examples §Calendly OAuth handler is canonical |
| `supabase/functions/calendly-oauth-start/index.ts` (NEW) | service (Edge Fn) | request-response | sibling Edge Fns under `supabase/functions/` (e.g. `page-publish`) | role-match |
| `supabase/functions/calendly-oauth-callback/index.ts` (NEW) | service (Edge Fn) | request-response | same | role-match |

### Workstream B — Helpdesk KB integration (EMBED-06)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `leanshot/src/helpdesk/KBArticleView.tsx` (EDIT) | component (markdown renderer) | none | itself — extend `<ReactMarkdown components>` mapper | retrofit |
| `leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx` (EDIT) | component (markdown editor) | none | itself — extend dompurify config with `ADD_TAGS: ['embed-block']` | retrofit |

---

## Pattern Assignments

### `CalendlyBlock.tsx` / `YouTubeBlock.tsx` / `TallyBlock.tsx` (retrofit — consent gate)

**Analog:** itself — `leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx` (current 82 lines).

**Imports pattern** (lines 8-14):
```typescript
import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { EMBED_IFRAME_TITLES, buildCalendlySrc } from '@/lib/page-builder/embed-src';
import { backgroundToneClass, paddingForDensity } from './block-style-helpers';
```

**Current iframe-state machine** (lines 30-71) — the State 2 Skeleton + State 3 opacity-transition contract already exists for the post-consent path:
```typescript
const reduceMotion = useReducedMotion();
const [loaded, setLoaded] = useState(false);
// ...
{!loaded && <Skeleton className="absolute inset-0 w-full h-full" />}
<iframe
  src={src}
  title={EMBED_IFRAME_TITLES.calendly}
  loading="lazy"
  referrerPolicy="no-referrer"
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
  allow="clipboard-write; payment"
  onLoad={() => setLoaded(true)}
  className={
    'w-full border-0 ' +
    (reduceMotion ? '' : 'transition-opacity duration-200 ease-out ') +
    (loaded ? 'opacity-100' : 'opacity-0')
  }
  style={{ minHeight: 600 }}
/>
```

**Retrofit shape** (per RESEARCH §Pattern 1): wrap the existing `<iframe>` + Skeleton block in a new `<ConsentGatedEmbed provider="calendly" categories={['functional','analytics']} minHeight={600} sandbox="allow-scripts allow-same-origin allow-popups allow-forms">` HOC. The HOC owns the State 1 placeholder + consent subscription; the existing block keeps the State 2/3 transition (passes the iframe element as a child to be conditionally rendered).

**Per-provider category mapping** (D-07 — applied at block call-site):
- Calendly → `['functional', 'analytics']`
- YouTube → `['analytics', 'marketing']`
- Tally → `['functional']`
- Custom-iframe → `['marketing']`

**Per-provider sandbox** (provider-specific; FIXED per D-16 for Custom-iframe):
- Calendly: `allow-scripts allow-same-origin allow-popups allow-forms`
- YouTube: `allow-scripts allow-same-origin allow-presentation`
- Tally: `allow-scripts allow-same-origin allow-forms`
- Custom-iframe: `allow-scripts allow-same-origin` (no admin override)

---

### `ConsentGatedEmbed.tsx` (NEW HOC)

**Analog:** the in-file Skeleton+iframe state machine in `CalendlyBlock.tsx` lines 30-71 + RESEARCH §Pattern 1.

**Subscription pattern** (canonical event from `consent-event.ts`):
```typescript
import { CONSENT_CHANGE_EVENT, type ConsentChangeDetail } from '@/lib/consent/consent-event';
import * as CookieConsent from 'vanilla-cookieconsent';

useEffect(() => {
  // Initial state — read synchronously at mount via vanilla-cookieconsent API
  setGranted(categories.every(c => CookieConsent.acceptedCategory(c)));

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ConsentChangeDetail>).detail;
    setGranted(categories.every(c => detail.categories[c] === true));
  };
  window.addEventListener(CONSENT_CHANGE_EVENT, handler);
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, handler);
}, [categories]);
```

**State machine** (per UI-SPEC §Surface B): State 1 (placeholder) → State 2 (Skeleton + opacity-0 iframe) → State 3 (iframe opacity-1). On revoke, unmount iframe element entirely (UI-SPEC anti-pattern: do not keep `src=""`).

---

### `consent-config.ts` (RETROFIT — emit event)

**Analog:** itself — `leanshot/src/components/consent/consent-config.ts` lines 261-273.

**Current callback shape** (lines 261-273):
```typescript
onFirstConsent: ({ cookie }) => {
  updateGtagConsent();
  void upsertConsentRecord(cookie);
},
onConsent: ({ cookie }) => {
  updateGtagConsent();
  void upsertConsentRecord(cookie);
},
onChange: ({ cookie }) => {
  updateGtagConsent();
  void upsertConsentRecord(cookie);
},
```

**Retrofit** (per RESEARCH §Pitfall 2 + Code Examples lines 632-666): append `emitConsentChange()` after `upsertConsentRecord(cookie)` in all three callbacks. The helper lives in this file (read state via `CookieConsent.acceptedCategory(c)`) and dispatches the canonical event:
```typescript
function emitConsentChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, {
    detail: {
      categories: {
        necessary: true,
        analytics: CookieConsent.acceptedCategory('analytics'),
        marketing: CookieConsent.acceptedCategory('marketing'),
        personalization: CookieConsent.acceptedCategory('personalization'),
        functional: CookieConsent.acceptedCategory('necessary'),
      },
    },
  }));
}
```

---

### `embed-src.ts` (EXTEND — validateCustomIframeUrl + buildCustomIframeIframeHtml)

**Analog:** itself — `leanshot/src/lib/page-builder/embed-src.ts` lines 86-97 (`parseAndValidateUrl`) + lines 183-198 (`buildCalendlyIframeHtml`).

**Validator pattern** (mirror lines 86-97 — exact-match hostname guard; NEVER `endsWith`/`includes` per existing comment block lines 22-29):
```typescript
// File: leanshot/src/lib/page-builder/embed-src.ts (extension)
export function validateCustomIframeUrl(
  raw: unknown,
  allowlistHostnames: ReadonlyArray<string>,
): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  // D-15 — exact hostname match, no subdomain expansion
  if (!allowlistHostnames.includes(parsed.hostname)) return null;
  return parsed.toString();
}
```

**iframe-HTML pattern** (mirror lines 183-198 + D-16 FIXED sandbox):
```typescript
export function buildCustomIframeIframeHtml(
  content: { embedUrl: string; iframeTitle: string },
  allowlistHostnames: ReadonlyArray<string>,
): string {
  const src = validateCustomIframeUrl(content.embedUrl, allowlistHostnames);
  if (!src) return '';
  const title = (typeof content.iframeTitle === 'string' && content.iframeTitle.length >= 3)
    ? content.iframeTitle
    : 'Embedded content';
  const attrs =
    commonIframeAttrs(title) +
    // D-16 FIXED sandbox — admin cannot override in v1.3
    ` sandbox="allow-scripts allow-same-origin"` +
    ` style="width:100%;height:100%;border:0;"`;
  return (
    `<div class="block-embed block-embed-custom-iframe" style="width:100%;min-height:400px;">` +
    `<iframe src="${escapeHtmlAttr(src)}" ${attrs}></iframe>` +
    `</div>`
  );
}
```

**Critical reuse:** call the existing module-local `escapeHtmlAttr()` (lines 135-142) + `commonIframeAttrs()` (lines 159-165). No new escaping helper.

---

### `block-schema.ts` (EXTEND — BlockType union)

**Analog:** itself — `leanshot/src/lib/page-builder/block-schema.ts` lines 36-48 (current 12-literal `BlockType` union).

**Extension** (one literal added; RESEARCH `<phase_requirements>` EMBED-07 row confirms only `custom_iframe` is new — the other 3 already exist):
```typescript
export type BlockType =
  | 'hero'
  | 'cta'
  | 'faq'
  | 'pricing'
  | 'testimonial'
  | 'feature-grid'
  | 'image-text'
  | 'footer'
  | 'calendly'
  | 'youtube'
  | 'tally'
  | 'lead-form'
  | 'custom_iframe'; // P41 EMBED-07 — superadmin-allowlisted iframe
```

**Cross-cutting consequence:** `supabase/functions/page-render/render.ts` `switch(block.type)` (line 600+) needs a `case 'custom_iframe':` branch — no fallthrough allowed (strict TS `noFallthroughCasesInSwitch`).

---

### `property-configs.ts` (EXTEND — custom_iframe entry)

**Analog:** itself — `leanshot/src/components/admin/pages/editor/property-configs.ts` lines 114-155 (existing `youtube` / `calendly` / `tally` entries).

**Pattern** (mirror the `tally` entry shape — single text URL field + boolean toggle):
```typescript
custom_iframe: {
  contentFields: [
    {
      key: 'embedUrl',
      label: 'Embed URL',
      kind: 'text',
      placeholder: 'https://meet.example.com/page',
      hint: 'Full URL of the page to embed. Hostname must be on the per-deployment allowlist — contact a superadmin if you need a new host added.',
    },
    {
      key: 'iframeTitle',
      label: 'Accessible title',
      kind: 'text',
      hint: 'Required for screen readers. Describes what the embed contains, e.g. "Patient intake form".',
    },
    { key: 'widthMode', label: 'Full-width', kind: 'boolean' },
  ],
},
```

---

### `page-render/render.ts` (EXTEND — case 'custom_iframe' + consent-gating placeholder)

**Analog:** `supabase/functions/page-render/render.ts` lines 663-672 (`renderEmbedCalendly`).

**Existing pattern** (lines 663-672):
```typescript
function renderEmbedCalendly(block: BlockNode): string {
  const c = block.content;
  const html = buildCalendlyIframeHtml({
    calendlyUrl: typeof c.calendlyUrl === 'string' ? c.calendlyUrl : '',
    prefillEmail: c.prefillEmail === true,
  });
  const wrapStyle = blockWrapperStyle(block.style, 'default', 'center');
  const wrapClass = `block block-cal-wrap${hideOnMobileClass(block.style.hideOnMobile)}`;
  return `<section class="${wrapClass}" style="${wrapStyle}"><div class="block-cal-wrap__inner">${html}</div></section>`;
}
```

**Retrofit for consent gating** (per RESEARCH §Pattern 2): wrap the `html` in a `<div data-embed-pending data-embed-category="..." data-embed-src="..." ...>` placeholder + emit a single inline `<script>` block (once per page, not per block) that hydrates pending elements when `leanshot:consent-change` fires. No module imports in the script — Deno emits as raw string.

**New `custom_iframe` case:** add the branch + `renderEmbedCustomIframe(block, allowlist)` — must accept the allowlist hostnames at render time (read from Postgres + cached for the response lifetime). Pre-validates via `validateCustomIframeUrl` from the mirrored `embed-src.ts` module (Deno relative import already works — see existing imports at top of `render.ts`).

---

### `vercel.json` (EDIT — CSP additions per D-12)

**Analog:** itself — `leanshot/vercel.json` lines 30-49.

**Current CSP** (line 45):
```
default-src 'none'; script-src 'self' https://js.stripe.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com https://api.stripe.com https://m.stripe.network; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://calendly.com https://www.youtube-nocookie.com https://tally.so; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:
```

**Additions per D-12:**
- `script-src`: add `https://assets.calendly.com https://www.youtube-nocookie.com https://s.ytimg.com https://tally.so`
- `connect-src`: add `https://api.calendly.com`
- `frame-src`: add `https://*.calendly.com https://youtube-nocookie.com https://*.tally.so`
- `img-src`: add `https://i.ytimg.com`
- Add `report-uri https://o<sentry-org>.ingest.sentry.io/api/<projid>/security/?sentry_key=<key>` (D-11)
- Sibling commit MUST update `leanshot/tests/csp/csp-snapshot.txt` — `tests/csp/csp-snapshot.test.ts` line 65 does a sorted-equal comparison and BLOCKS otherwise (per Phase 12 D-12 + RESEARCH §Pitfall 10).

---

### `middleware.ts` (NEW — Vercel Edge Middleware for D-14)

**Analog:** none in repo — first middleware. Use RESEARCH §Pattern 3 (lines 397-432) verbatim as the implementation contract.

**Critical shape** (read RESEARCH lines 397-432):
- `export const config: Config = { matcher: ['/((?!api|_next/static|assets|favicon).*)'] }`
- 60-second in-memory cache of allowlist hostnames (per RESEARCH §Pitfall 11 + Open Question 4 — admin sees changes within 60s; acceptable for low-write workflow).
- `const response = await next(); response.headers.set(...)` — modify response AFTER rewrite returns (so the rewrite to `page-render` Supabase Fn still receives middleware-augmented headers per Assumption A1).
- Append to `frame-src` directive with regex replace; DO NOT overwrite whole CSP.
- `referer`/`origin` header — none needed; allowlist is global per deployment.

**Allowlist fetch source:** Supabase REST endpoint `https://ytnsipxxmzgaebkqmokp.supabase.co/rest/v1/iframe_allowlist?select=hostname` with `apikey: SUPABASE_ANON_KEY` header (read access is gated by RLS policy that allows anon SELECT — confirm in migration design).

---

### Migration: `iframe_allowlist` table + RLS

**Analog:** `supabase/migrations/20260601000001_audit_logs.sql` lines 46-138 (table + RLS deny pattern).

**Reuse pattern:**
```sql
create table public.iframe_allowlist (
  id uuid primary key default gen_random_uuid(),
  hostname text not null unique,
  added_by_user_id uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index iframe_allowlist_hostname_idx on public.iframe_allowlist (hostname);

alter table public.iframe_allowlist enable row level security;

-- Public SELECT — needed by Vercel middleware fetch using anon key
create policy "iframe_allowlist_select_public"
  on public.iframe_allowlist for select to anon, authenticated
  using (true);

-- NO INSERT/UPDATE/DELETE policies — writes flow ONLY through SECDEF RPCs
-- (mirrors audit_logs default-deny pattern at audit_logs.sql:118-138)
```

**Pitfall:** confirm the public-SELECT policy is the right trade-off — the alternative is moving the middleware fetch to a service-role-keyed Edge Fn. Public-SELECT is fine because hostnames are not sensitive (they appear in served HTML CSP headers already).

---

### Migration: SECDEF RPCs (add/remove + audit log)

**Analog:** `supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql` lines 43-65 (canonical 6-arg `log_admin_action` call site).

**6-arg signature** (verified from `supabase/migrations/20270601000029_log_admin_action_function.sql` lines 16-23):
```
log_admin_action(
  p_action_name    text,
  p_target_user_id uuid,
  p_table_name     text   default null,
  p_row_pk         text   default null,
  p_before         jsonb  default null,
  p_after          jsonb  default null
)
```

**RPC pattern** (RESEARCH §Code Examples lines 698-738 — superadmin-gate + hostname-shape rejection + insert + audit):
```sql
create or replace function public.add_iframe_allowlist_hostname(p_hostname text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp  -- migration_gotchas reference
as $$
declare v_id uuid;
begin
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_hostname is null or p_hostname = '' then
    raise exception 'hostname required' using errcode = '22023';
  end if;
  if p_hostname like '%://%' or p_hostname like '%/%' or p_hostname like '%*%' then
    raise exception 'hostname must be a bare hostname' using errcode = '22023';
  end if;

  insert into public.iframe_allowlist (hostname, added_by_user_id)
  values (p_hostname, auth.uid())
  returning id into v_id;

  -- 6-arg canonical
  perform public.log_admin_action(
    'iframe_allowlist.add',                       -- p_action_name
    null,                                          -- p_target_user_id (no per-user target)
    'iframe_allowlist',                            -- p_table_name
    v_id::text,                                    -- p_row_pk
    null,                                          -- p_before
    jsonb_build_object('hostname', p_hostname)     -- p_after
  );
  return v_id;
end;
$$;
```

**Carryover gotchas:**
- `set search_path = extensions, public, pg_temp` is REQUIRED for SECDEF (`reference_supabase_migration_gotchas`).
- Pre-merge timestamp collision check: `ls supabase/migrations/<prefix>*.sql | wc -l` (`reference_migration_timestamp_collision_precheck`).
- Worktree executor MUST run `supabase db push` from worktree, NOT cd to main (`feedback_worktree_executor_pwd_drift_leaks_to_main`); per-commit `git rev-parse --show-toplevel` guard.

---

### `modules.ts` (EDIT — ADMIN_MODULES manifest entry)

**Analog:** `leanshot/src/lib/admin/modules.ts` lines 170-181 (`anomaly` entry — same `minRole: 'superadmin'` posture).

**Pattern** (verbatim entry shape):
```typescript
// Phase 41 Plan 41-B4 — superadmin-only Custom-iframe allowlist (D-17).
// Sub-route 'embeds/allowlist' resolves through AdminShell prefix-branch match
// (modules.ts:124 — `pathname.startsWith('/admin/${m.route}/')`).
{
  key: 'embeds',
  label: 'Embeds',
  route: 'embeds',
  icon: ShieldCheckIcon,
  lazy: () => import('@/components/admin/embeds/AllowlistPage'),
  flagKey: 'admin.embeds.enabled',
  minRole: 'superadmin' as AdminRole,
},
```

**Carryover gotcha:** per `feedback_admin_module_manifest_vs_router_branch_drift` — AdminShell.tsx already uses prefix-branch matching (`pathname.startsWith('/admin/${m.route}/')`), so the sub-route `/admin/embeds/allowlist` resolves without a hardcoded switch branch.

---

### KB Article view + editor (EMBED-06)

**Analog:** `leanshot/src/helpdesk/KBArticleView.tsx` line 66 + 98-100 (existing `DOMPurify.sanitize(body, { USE_PROFILES: { html: true } })` + `<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>`).

**Retrofit shape** (per RESEARCH §Pattern 4 + Pitfall 9):
```typescript
// EXTEND dompurify config — was: { USE_PROFILES: { html: true } }
const sanitized = DOMPurify.sanitize(body, {
  USE_PROFILES: { html: true },
  ADD_TAGS: ['embed-block'],
  ADD_ATTR: ['type', 'data-url', 'data-id', 'data-allow'],
});

// EXTEND ReactMarkdown components mapper (was no `components` prop)
const components = {
  'embed-block': ({ type, ...attrs }: any) => {
    switch (type) {
      case 'calendly': return <CalendlyBlock block={...} />;
      case 'youtube': return <YouTubeBlock block={...} />;
      case 'tally': return <TallyBlock block={...} />;
      case 'custom_iframe': return <CustomIframeBlock block={...} />;
      default: return null;
    }
  },
};
<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
  {sanitized}
</ReactMarkdown>
```

**Mirror change** in `leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx` line 237 — same dompurify config extension (preview path).

---

### Calendly OAuth popup (EMBED-08)

**Analog:** none in repo. Canonical implementation contract is RESEARCH §Code Examples lines 670-691.

**Critical guards** (Pitfall 6 — `event.origin` validation is the load-bearing safety check):
```typescript
const CALENDLY_OAUTH_ORIGIN = 'https://calendly.com';
const LEANSHOT_OAUTH_CALLBACK_ORIGIN = window.location.origin;

function handlePopupMessage(event: MessageEvent): void {
  if (
    event.origin !== CALENDLY_OAUTH_ORIGIN &&
    event.origin !== LEANSHOT_OAUTH_CALLBACK_ORIGIN
  ) {
    return; // silent reject — log to Sentry as anomaly
  }
  if (event.data?.type !== 'calendly-oauth-result') return;
  // ... handle token (in-memory closure only — never localStorage)
}
```

**State storage** (RESEARCH Alternatives Considered + Open Question 2 recommendation): **in-memory closure variable**, NOT sessionStorage. Token dies on PageEditor unmount.

**Popup-blocked detection** (UI-SPEC §Surface D State D2-error):
```typescript
const popup = window.open(url, 'calendly_oauth', 'width=560,height=720,popup=yes');
if (!popup || popup.closed || typeof popup.closed === 'undefined') {
  // State D2-error — "Popup blocked"
}
```

---

## Shared Patterns

### Shared: Auth gating

**Source 1:** `supabase/migrations/20270601000029_log_admin_action_function.sql` lines 33-36 — `if auth.uid() is null or not public.is_admin_at_least('staff'::public.admin_role) then raise exception ... using errcode = '42501';`

**Source 2:** `leanshot/src/lib/admin/modules.ts` entries with `minRole: 'superadmin'` (line 180 — `anomaly` entry).

**Apply to:** All SECDEF RPCs in P41 (`add_iframe_allowlist_hostname`, `remove_iframe_allowlist_hostname`, `update_iframe_allowlist_last_used`) gate on `is_admin_at_least('superadmin')` (D-17). The Admin module entry gates on `minRole: 'superadmin'` (RLS surface for `/admin/embeds/allowlist`).

**Pattern S1 dual-layer:** UI hides the module from non-superadmin; SECDEF RPCs re-check server-side. This is the Phase 24 dual-layer pattern reused across the codebase.

---

### Shared: Audit logging

**Source:** `supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql` lines 43-54.
**Apply to:** Both `add_iframe_allowlist_hostname` and `remove_iframe_allowlist_hostname` RPCs.

**Canonical 6-arg signature** (verified in `20270601000029_log_admin_action_function.sql:16-23`):
```sql
perform public.log_admin_action(
  'iframe_allowlist.add' or 'iframe_allowlist.remove', -- p_action_name
  null,                                                 -- p_target_user_id (none)
  'iframe_allowlist',                                   -- p_table_name
  v_id::text,                                           -- p_row_pk
  case INSERT/UPDATE then null else row_to_json(OLD)::jsonb end,  -- p_before
  case DELETE then null else row_to_json(NEW)::jsonb end          -- p_after
);
```

**Retention:** 90d per D-17 — managed by the existing `audit_retention_cron` in `supabase/migrations/20260601000003_audit_retention_cron.sql` (no Phase 41 change needed; new `action_name` values flow into the existing retention sweep).

---

### Shared: Iframe security boundary (escape + sandbox + URL allowlist)

**Source:** `leanshot/src/lib/page-builder/embed-src.ts` lines 22-29 (comment block), lines 86-97 (`parseAndValidateUrl`), lines 135-142 (`escapeHtmlAttr`), lines 159-165 (`commonIframeAttrs`).

**Apply to:** `validateCustomIframeUrl` + `buildCustomIframeIframeHtml` (new helpers in same file). Reuse `escapeHtmlAttr` + `commonIframeAttrs`. NEVER `endsWith`/`includes` on hostname (defeats `evil.com.calendly.com` look-alike).

---

### Shared: CSP snapshot test contract

**Source:** `leanshot/tests/csp/csp-snapshot.test.ts` lines 42-66 + Phase 12 D-12 contract documented in lines 9-20 of that file.

**Apply to:** ANY commit that edits `leanshot/vercel.json` CSP MUST also edit `leanshot/tests/csp/csp-snapshot.txt` in the same commit. Plan-checker BLOCKS otherwise (Phase 12 enforcement carries over).

---

### Shared: Reduced-motion gating

**Source:** `leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx` lines 30, 64-67 — `const reduceMotion = useReducedMotion();` + conditional `'transition-opacity duration-200 ease-out '` class.

**Apply to:** `ConsentGatedEmbed.tsx` (State 1 → State 2 transition), `CustomIframeBlock.tsx` (iframe `onLoad` opacity transition), and any inline-script emitted by `page-render/render.ts` for public pages.

---

### Shared: DSv2 component primitives

**Source:** `leanshot/src/components/ui/` (Card, Skeleton, Button, Input, Modal, Confirm, Toast, Sheet, EmptyState, Badge, Pill, Spinner — verified by UI-SPEC §Design System table).

**Apply to:** All new admin embeds UI files (`AllowlistPage`, `AddHostnameForm`, `AllowlistTable`, `RemoveHostnameConfirm`, `ReferencesSheet`) + `EmbedPlaceholderCard`. NO new design tokens — UI-SPEC §Color/Spacing/Typography is the contract.

---

### Shared: Tailwind v4 unlayered-reset awareness

**Source:** `reference_tailwind_v4_unlayered_reset` (memory).
**Apply to:** Any inline `<style>` emitted by `page-render/render.ts` for embed placeholders. If a bare `* { margin: 0 }` reset is added inside the inline-script-emitted CSS, wrap in `@layer base` (unlayered wins over `@layer utilities`).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `leanshot/middleware.ts` | middleware | request-response (header mutation) | First middleware in this Vite SPA. Use RESEARCH §Pattern 3 verbatim — Vercel Edge Middleware docs cited as canonical. Validate Assumption A1 (middleware augments responses from rewrites to Supabase Edge Fns) at first deploy. |
| `supabase/functions/calendly-oauth-{start,callback}/` | Edge Fns (OAuth) | request-response | No existing OAuth Edge Fn in `supabase/functions/`. Sibling Fns (`page-publish`, `lead-capture`) provide the auth+CORS scaffolding shape; OAuth state-param + redirect-URI exact-match is novel. |

---

## Metadata

**Analog search scope:**
- `leanshot/src/components/admin/pages/blocks/` (12 sibling block components)
- `leanshot/src/lib/page-builder/` (embed-src.ts, block-schema.ts)
- `leanshot/src/components/consent/` + `leanshot/src/lib/consent/`
- `leanshot/src/lib/admin/modules.ts` (full manifest, ~360 lines)
- `leanshot/src/helpdesk/KBArticleView.tsx` + `leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx`
- `leanshot/tests/csp/csp-snapshot.test.ts` + `leanshot/vercel.json`
- `supabase/functions/page-render/render.ts` (renderEmbed* family)
- `supabase/migrations/20260601000001_audit_logs.sql` (audit_logs schema + RLS deny)
- `supabase/migrations/20270601000029_log_admin_action_function.sql` (canonical 6-arg signature)
- `supabase/migrations/20270603000003_p32_04_locale_overrides_audit.sql` (canonical call-site)

**Files scanned:** ~14 source files (Read tool) + 10 file-list / grep enumerations.

**Pattern extraction date:** 2026-05-21
