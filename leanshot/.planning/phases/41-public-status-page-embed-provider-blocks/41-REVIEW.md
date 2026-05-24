---
phase: 41
status: clean
fixed_at: 2026-05-24
depth: standard
reviewed_at: 2026-05-24
files_reviewed: 28
files_reviewed_list:
  - leanshot/middleware.ts
  - leanshot/vercel.json
  - leanshot/src/lib/consent/consent-event.ts
  - leanshot/src/components/consent/consent-config.ts
  - leanshot/src/lib/page-builder/block-schema.ts
  - leanshot/src/lib/page-builder/embed-src.ts
  - leanshot/src/lib/admin/iframe-allowlist.ts
  - leanshot/src/lib/admin/modules.ts
  - leanshot/src/components/admin/pages/blocks/ConsentGatedEmbed.tsx
  - leanshot/src/components/admin/pages/blocks/EmbedPlaceholderCard.tsx
  - leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx
  - leanshot/src/components/admin/pages/blocks/CalendlyBlock.tsx
  - leanshot/src/components/admin/pages/blocks/YouTubeBlock.tsx
  - leanshot/src/components/admin/pages/blocks/TallyBlock.tsx
  - leanshot/src/components/admin/pages/blocks/blocks.test.tsx
  - leanshot/src/components/admin/pages/editor/CalendlyPreviewPopup.tsx
  - leanshot/src/components/admin/pages/editor/property-configs.ts
  - leanshot/src/components/admin/embeds/AllowlistPage.tsx
  - leanshot/src/components/admin/embeds/AddHostnameForm.tsx
  - leanshot/src/components/admin/embeds/AllowlistTable.tsx
  - leanshot/src/components/admin/embeds/RemoveHostnameConfirm.tsx
  - leanshot/src/components/admin/embeds/ReferencesSheet.tsx
  - leanshot/src/helpdesk/KBArticleView.tsx
  - leanshot/src/admin/modules/helpdesk/KBEditorPage.tsx
  - leanshot/tests/csp/csp-snapshot.txt
  - leanshot/tests/integration/csp-middleware.test.ts
  - leanshot/tests/smoke/status-page.smoke.test.ts
  - supabase/migrations/20271101000001_p41_iframe_allowlist.sql
  - supabase/migrations/20271101000002_p41_iframe_allowlist_rpcs.sql
  - supabase/functions/calendly-oauth-start/index.ts
  - supabase/functions/calendly-oauth-callback/index.ts
  - supabase/functions/page-render/render.ts
  - supabase/functions/page-render/index.ts
findings:
  critical: 3
  warning: 6
  info: 5
  total: 14
---

# Phase 41: Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Files Reviewed:** 28 (+ 5 supporting reads — render.ts / config.toml / KBEditorPage / blocks.test / property-configs)
**Status:** issues_found

## Summary

Phase 41 ships the Public Status Page bridge (Better Stack) and 4 consent-gated embed blocks (Calendly / YouTube / Tally / Custom-iframe). The CSP allowlist plumbing, hostname allowlist RLS posture, SECDEF RPC gates, and consent-event contract are sound. The defense-in-depth around `validateCustomIframeUrl` (exact hostname match) and the FIXED-sandbox literal on Custom-iframe both hold.

However, **the Calendly inline-preview OAuth flow ships in a broken-and-XSS-vulnerable state**:

1. Neither `calendly-oauth-start` nor `calendly-oauth-callback` is registered with `verify_jwt = false` in `supabase/config.toml`. The Supabase gateway will 401 every popup navigation before the function body runs — making the entire EMBED-08 popup-OAuth flow non-functional.
2. The callback Fn inlines a reflected URL-parameter (`?error=...`) into a `<script>` tag via `JSON.stringify`, which does NOT escape `</script>`. This is HTML/JS injection on the LeanShot app origin.
3. The embed placeholder card's "Manage cookie preferences" link has a dead-code fallback — the synchronous-dispatch path always marks the sentinel as handled, so the `CookieConsent.show()` fallback is unreachable; clicking the link with the Phase 22 banner absent is a no-op.

Several smaller correctness defects round out the list (token-expiry not enforced, popup-blocked detection dead branch, audit-log phantom rows on no-op deletes, reference-count display lying about cardinality).

## Critical Issues

### CR-01: HTML/JS injection via reflected `error` query param in Calendly OAuth callback

**File:** `supabase/functions/calendly-oauth-callback/index.ts:146-175` (`buildPostMessageHtml`) + `:219-237` (calendlyError handling)

**Issue:** The callback Fn reads the `error` query string parameter unconditionally (`url.searchParams.get('error') ?? ''`, line 223) and passes it into the HTML response body via:

```ts
return `<script>
  window.opener.postMessage(${JSON.stringify(payload)}, ${JSON.stringify(leanshotOrigin)});
</script>`;
```

`JSON.stringify` does NOT escape `<`, `>`, or `/`. A request to `https://app.leanshot.app/api/calendly/oauth-callback?error=</script><script>alert(document.cookie)</script>` produces:

```html
<script>
  window.opener.postMessage({"type":"calendly-oauth-result","error":"</script><script>alert(document.cookie)</script>"}, ...);
</script>
```

The HTML parser sees the inner `</script>` and ends the script element — the injected `<script>` then runs in the LeanShot origin context, with full DOM/cookie access. This is exploitable by any attacker who can get a victim to load that URL (or via Calendly's redirect if Calendly ever passes an attacker-influenced `error` value, which they DO when OAuth state validation fails).

The comment on line 152-154 ("payload + origin are NEVER attacker-controlled") is wrong — `calendlyError` is reflected from the request URL.

**Fix:** Either (a) emit the payload via a `<script type="application/json" id="payload">` element and parse it client-side, or (b) escape the JSON for HTML-script context. Minimum fix:

```ts
function jsonForScript(v: unknown): string {
  // Escape characters that can break out of an HTML <script> block.
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
}

return `<script>
  window.opener.postMessage(${jsonForScript(payload)}, ${jsonForScript(leanshotOrigin)});
</script>`;
```

Also add a non-empty whitelist on `calendlyError` (Calendly's documented OAuth error codes: `access_denied`, `invalid_request`, `unauthorized_client`, ...) and reflect a generic code otherwise.

---

### CR-02: Calendly OAuth Edge Fns missing `verify_jwt = false` in `supabase/config.toml` — flow is dead-on-arrival

**File:** `supabase/functions/calendly-oauth-start/index.ts` (whole file) + `supabase/functions/calendly-oauth-callback/index.ts` (whole file) + missing entries in `supabase/config.toml`

**Issue:** The popup-OAuth flow opens `window.open('/api/calendly/oauth-start', 'calendly_oauth', ...)` (`CalendlyPreviewPopup.tsx:110-114`). Vercel rewrites that to `https://<project>.supabase.co/functions/v1/calendly-oauth-start`. The browser navigation does NOT carry a Supabase JWT in any header — the SDK stores the session in `localStorage`, not as a cookie the browser auto-attaches to cross-origin fetches.

`config.toml` has explicit `verify_jwt = false` entries for every public-fetch Fn (`page-render`, `lead-capture`, `share`, `sitemap`, `affiliate-attribute`, etc.) but **no `[functions.calendly-oauth-start]` or `[functions.calendly-oauth-callback]` block at all**. Default Supabase behavior is `verify_jwt = true`, so the gateway 401s every popup navigation **before** the Fn body runs — meaning the in-body `if (!jwt) return jsonError(401, ...)` defensive check (`calendly-oauth-start/index.ts:156`) is unreachable in production.

Same problem for the callback: the OAuth redirect from `auth.calendly.com` carries no LeanShot JWT, so the gateway 401s before `handleCallback` runs.

**Net effect:** clicking "Connect Calendly" produces a popup that immediately shows a Supabase 401 JSON page; the entire EMBED-08 surface is non-functional.

**Fix:** Add to `supabase/config.toml`:

```toml
# Phase 41 Plan 41-04 EMBED-08 — Calendly OAuth popup-start. Public navigation;
# in-Fn handler validates the user's JWT explicitly when forwarded via custom header
# OR via signed-state pre-roll. verify_jwt MUST be false.
[functions.calendly-oauth-start]
verify_jwt = false

# Phase 41 Plan 41-04 EMBED-08 — Calendly OAuth callback. Calendly's redirect
# carries no LeanShot JWT; verify_jwt MUST be false.
[functions.calendly-oauth-callback]
verify_jwt = false
```

AND change `handleStart` to receive the user identity another way (e.g., signed handoff token minted by an in-app server fetch BEFORE opening the popup, then validated by start Fn). The current `jwtFromReq(req)` will not work for a popup navigation regardless of `verify_jwt`.

---

### CR-03: Phase 22 fallback to open the consent banner is unreachable

**File:** `leanshot/src/components/admin/pages/blocks/EmbedPlaceholderCard.tsx:62-84` (`defaultOpenBanner`)

**Issue:** The "Manage cookie preferences →" link uses this handler:

```ts
let handled = false;
const sentinel = (): void => { handled = true; };
window.addEventListener('leanshot:open-consent-banner', sentinel, { once: true });
window.dispatchEvent(new CustomEvent('leanshot:open-consent-banner'));
window.removeEventListener('leanshot:open-consent-banner', sentinel);
if (!handled) {
  void fallbackShowBanner();
}
```

`dispatchEvent` invokes all listeners synchronously, so `sentinel` ALWAYS fires before the next line — `handled` is always `true`, and the `fallbackShowBanner()` direct-call to `CookieConsent.show()` is dead code.

When this surface renders on a page where Phase 22's banner module hasn't registered its `leanshot:open-consent-banner` listener yet (KB-article surface inside the helpdesk widget; any consumer page whose consent-defer chunk hasn't loaded), clicking the link does nothing. There is no way for the user to grant consent → no way to view the embed → permanent placeholder.

**Fix:** Remove the sentinel pattern; just always run both paths in sequence (idempotent if banner already visible):

```ts
function defaultOpenBanner(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('leanshot:open-consent-banner'));
  // Always attempt the direct call too — CookieConsent.show() is idempotent
  // when the banner is already on screen. Covers the case where the Phase 22
  // event listener hasn't registered yet.
  void fallbackShowBanner();
}
```

Alternative: register a real listener inside Phase 22's `initCookieConsent()` and drop the fallback entirely; current code path advertises a fallback that never runs.

---

## Warnings

### WR-01: Calendly token TTL stored but never enforced

**File:** `leanshot/src/components/admin/pages/editor/CalendlyPreviewPopup.tsx:95-97`

**Issue:** `setToken({ token: data.token, expiresAt: Date.now() + ttlMs })` stores the absolute expiry, but no code path checks `expiresAt` anywhere — the token sits in component state until disconnect/unmount regardless of how long ago it was minted. If `expires_in` is 3600s, the token is treated as fresh 24h later.

**Fix:** Add `useEffect` with `setTimeout(handleDisconnect, expiresAt - Date.now())` while in state `d3`, OR gate every consumer of `token.token` on `Date.now() < token.expiresAt`. Surface state `d1` (un-connected) when expired.

---

### WR-02: Popup-blocked detection's `typeof popup.closed === 'undefined'` branch is dead

**File:** `leanshot/src/components/admin/pages/editor/CalendlyPreviewPopup.tsx:116`

**Issue:** `window.open` returns either `null` (popup blocked) or a `Window` object. `Window.closed` is always a defined boolean. The expression `typeof popup.closed === 'undefined'` can never be true; it is leftover from a legacy IE-era pattern. The OR-chain is harmless but misleading.

Additionally, the popup-blocked detection ONLY catches the null-return case. Some browsers return a Window whose `closed` is immediately `true` (Edge with strict popup policy). The `popup.closed` check IS evaluated — good — but the popup-just-closed-by-user case is unhandled (state stays `d2` forever; user must click Cancel).

**Fix:** (a) Drop the `typeof` clause. (b) Add a `setInterval(() => { if (popup.closed) { setState('d2-error'); clearInterval(id); } }, 500)` watch while in state `d2` to detect user-closed-popup.

---

### WR-03: `remove_iframe_allowlist_hostname` writes phantom audit-log rows on no-op delete

**File:** `supabase/migrations/20271101000002_p41_iframe_allowlist_rpcs.sql:78-112`

**Issue:** When called with a non-existent `p_id`:
- `select hostname into v_hostname` returns nothing → `v_hostname` stays NULL
- `delete from public.iframe_allowlist where id = p_id` deletes zero rows (no error)
- `perform public.log_admin_action(..., 'iframe_allowlist.remove', ..., jsonb_build_object('hostname', NULL), ...)` writes a successful audit row pointing at a row that never existed

The audit trail records a "remove" event that didn't happen. Forensics on a hostile-superadmin scenario become harder.

**Fix:** Wrap delete+log in a `FOUND`-guard:

```sql
delete from public.iframe_allowlist where id = p_id;
if not found then
  raise exception 'hostname not found' using errcode = 'P0002';
end if;

perform public.log_admin_action(...);
```

OR check `v_hostname IS NOT NULL` before logging.

---

### WR-04: Reference-count column always renders "1 page" — UI lies about cardinality

**File:** `leanshot/src/components/admin/embeds/AllowlistPage.tsx:131` + `AllowlistTable.tsx:159,200-202`

**Issue:** `AllowlistPage.refetch` synthesizes `reference_count: r.last_used_at === null ? 0 : 1`. The table then renders `${refCount} ${refCount === 1 ? 'page' : 'pages'}` — but `refCount` can ONLY be `0` or `1` for the entire v1.3 lifetime. The pluralization branch is unreachable, and worse, the count is misleading: a hostname used on 50 pages shows "1 page".

Operations risk: a superadmin reading the table sees "1 page" and may remove a hostname that's actually referenced 30 times.

**Fix:** Either:
- Hide the count entirely until v1.4 reference scanning lands (show "Unused" or "In use" — no number), OR
- Make `reference_count` truthful — even an approximate scan over `landing_page_revisions.blocks` JSONB.

`ReferencesSheet.tsx` already acknowledges this gap ("Reference scanning ships in v1.4") but the table column still emits a fake number — fix the table to match the sheet's honesty.

---

### WR-05: `EmbedPlaceholderCard` interactive button claims a 44×44 target but doesn't get one

**File:** `leanshot/src/components/admin/pages/blocks/EmbedPlaceholderCard.tsx:108-114`

**Issue:** Per UI-SPEC §Spacing Scale Exceptions, every interactive control must have a 44×44 hit area. The "Manage cookie preferences →" button has `min-h-[44px] min-w-[44px]` BUT also `inline-flex items-center justify-start self-start` — the text content alone is wider than 44px, but the button is still aligned `justify-start` which means the touchable area in the visual sense ends at the text width. This is technically WCAG-compliant (target size measured by the bounding box), but the visual padding-around-text is zero — adjacent click targets can collide.

Lower-priority: the icon-only buttons rendered by lucide-react in `PROVIDER_ICON` are wrapped only in a `<div className="flex items-center">` — they're not interactive, so no aria-label needed; this is fine.

**Fix:** Add horizontal padding to expand the visual touch surface:

```tsx
className="inline-flex items-center justify-start min-h-[44px] px-3 -mx-3 text-[13px] font-semibold text-[var(--color-primary)] hover:underline self-start"
```

---

### WR-06: `AllowlistTable` button-inside-th hostname column lacks proper sort-button label

**File:** `leanshot/src/components/admin/embeds/AllowlistTable.tsx:116-148`

**Issue:** Each sortable column header wraps the column label in a `<button>` with no `aria-label` and no `aria-sort` attribute on the `<th>`. Screen readers announce only "Hostname, button" — no indication that activating it sorts the table, or what the current sort direction is. UI-SPEC §Accessibility requires "Tab + Enter + Escape" keyboard nav on the table, which works mechanically, but the announce contract is incomplete.

**Fix:** Add `aria-sort` to each sortable `<th>`:

```tsx
<th
  scope="col"
  aria-sort={sortKey === 'hostname' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
  ...
>
  <button aria-label={`Sort by hostname, currently ${sortKey === 'hostname' ? sortDir : 'unsorted'}`} ...>
```

Apply the same to `added_at` and `last_used_at` columns.

---

## Info

### IN-01: `JSON.stringify` of the response `title` interpolated raw into `<title>`

**File:** `supabase/functions/calendly-oauth-callback/index.ts:159` (inside `buildPostMessageHtml`)

**Issue:** `<title>${title}</title>` — `title` is server-controlled (only literal strings `'Calendly connected'` / `'Calendly connection failed'`), so not currently exploitable. But the function signature accepts arbitrary `title?: string`, and a future caller could pass user-derived data.

**Fix:** HTML-escape `title` even though all current callers pass static strings. Defense-in-depth pattern matches the rest of the codebase (`escapeHtml` / `escapeAttr` in `embed-src.ts:144`).

---

### IN-02: `CustomIframeBlock` re-fetches allowlist on every mount with no shared cache

**File:** `leanshot/src/components/admin/pages/blocks/CustomIframeBlock.tsx:104-120`

**Issue:** Each `<CustomIframeBlock>` instance fires `listHostnames(supabase)` on mount. A page with N Custom-iframe blocks runs N parallel queries against the same table. The middleware-side cache is 60s (already implemented) but the client-side React surface has no cache at all.

**Fix:** Hoist the fetch into a parent (PageEditor / page-render result) and pass `allowlist` down as a prop. Alternatively, share a module-level promise:

```ts
let allowlistPromise: Promise<AllowlistRow[]> | null = null;
function getAllowlist(): Promise<AllowlistRow[]> {
  if (!allowlistPromise) allowlistPromise = listHostnames(supabase);
  return allowlistPromise;
}
```

Not perf-critical, but reduces unnecessary load.

---

### IN-03: `AddHostnameForm` does not validate hostname format beyond syntactic rejects

**File:** `leanshot/src/components/admin/embeds/AddHostnameForm.tsx:26-40`

**Issue:** Validation rejects protocols/paths/wildcards/leading-dots, but accepts arbitrary strings like `"abc def"`, `"localhost"`, `""123.456.789.999"`, or punycode IDN domains without normalization. The downstream `validateCustomIframeUrl` compares `parsed.hostname` (URL-normalized lowercase ASCII) against the raw `hostname` from the table — a row stored as `EXAMPLE.com` would never match because URL ctor normalizes to `example.com`.

**Fix:** Lowercase + validate via `new URL('https://' + value).hostname === value.toLowerCase()` round-trip. Reject anything that doesn't round-trip cleanly. Persist lowercased.

---

### IN-04: `AllowlistTable` ChevronUp/Down icons render below the click target with `align-text-bottom`

**File:** `leanshot/src/components/admin/embeds/AllowlistTable.tsx:96-100`

**Issue:** Cosmetic — the sort indicator chevron uses `align-text-bottom` while the parent `<button>` has no flex alignment. The chevron renders slightly off-baseline. Visible in screenshots but not blocking.

**Fix:** Drop `align-text-bottom` and rely on the parent `inline-flex items-center` already on the button.

---

### IN-05: `subscribeToConsentChange` handler dispatches with no detail when consent emitter mis-fires

**File:** `leanshot/src/lib/consent/consent-event.ts:58-63`

**Issue:** The listener cast assumes `event.detail` is always `ConsentChangeDetail`. If a third-party (or test harness) fires the same event with no detail, `detail` is `undefined` and the handler receives `undefined` — which then crashes inside `ConsentGatedEmbed`'s `readAllAccepted` (the categories iteration is fine because it reads from props, not detail). Currently no crash, but the contract is brittle.

**Fix:** Narrow with a runtime check before invoking:

```ts
if (!detail || typeof detail !== 'object' || !('categories' in detail)) return;
handler(detail);
```

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Fixes Applied

**Fixed at:** 2026-05-24
**Scope:** Critical (3) + Warning (6) — default. Info findings NOT in scope, except IN-04 which was bundled with WR-06 (same chevron-rendering lines).

| Finding | Status | Commit | Notes |
|---------|--------|--------|-------|
| CR-01 | fixed | `aa60db3d` | `jsonForScript()` escapes `<`, `>`, `&`, U+2028, U+2029 before interpolating into `<script>`. `sanitizeCalendlyOAuthError()` whitelists raw `?error=` to RFC 6749 codes. Title also HTML-escaped (IN-01 defense-in-depth, bundled). U+2028/U+2029 regexes use `String.fromCharCode` to keep source ASCII-only. |
| CR-02 | partial | `2e19cbd2` | `[functions.calendly-oauth-start]` + `[functions.calendly-oauth-callback]` added with `verify_jwt = false`. **Known issue documented in commit body + toml comments:** `handleStart()` still calls `jwtFromReq(req)` which a popup navigation cannot satisfy; full fix needs a signed-handoff token minted by an in-app fetch BEFORE `window.open()`. Toml change is a prerequisite for that follow-up. Carry into next phase. |
| CR-03 | fixed (logic, human-verify) | `ce7ac816` | Removed dead-code sentinel pattern in `defaultOpenBanner()`. Now unconditionally dispatches the event AND calls `CookieConsent.show()` (idempotent). Requires runtime verification on a surface where Phase 22 listener is NOT registered (KB-article inside helpdesk widget) to confirm the fallback actually opens the banner. |
| WR-01 | fixed | `172d3731` | `useEffect` watches `(state, token)`; schedules `setTimeout(disconnect, expiresAt - Date.now())` while in `d3`. Synchronous disconnect on already-expired remount. |
| WR-02 | fixed | `172d3731` | (a) Dropped dead `typeof popup.closed === 'undefined'` clause. (b) Added 500ms `setInterval` watch while in `d2` that flips to `d2-error` when `popup.closed` — covers user-dismissed-popup. Functional `setState` avoids clobbering concurrent `d3` transition. |
| WR-03 | fixed | `f7179d7e` | `remove_iframe_allowlist_hostname` now raises `P0002 'hostname not found'` when `v_hostname IS NULL` after the SELECT. Edited in-place safely: Phase 41 close-out 41-06 was AUTOMATED-EXTRACT — `supabase db push` was deferred to milestone UAT and migration has not been applied to remote. |
| WR-04 | fixed | `755206db` | Replaced fake `reference_count: number` with binary `in_use: boolean` across `AllowlistPage` → `AllowlistTable` → `RemoveHostnameConfirm`. Badge renders 'Unused' / 'In use' (no number). RemoveHostnameConfirm warning copy adds '(Exact reference count ships in v1.4.)' for honesty parity with `ReferencesSheet`. |
| WR-05 | fixed | `ce7ac816` | Added `px-3 -mx-3` to 'Manage cookie preferences' button — expands touch surface without shifting visual layout. Bundled with CR-03 in same file commit. |
| WR-06 | fixed | `755206db` | Added `aria-sort` to each sortable `<th>` + `aria-label='Sort by {label}, currently {asc|desc|unsorted}'` on the inner button. References-column badge also gets descriptive aria-label. |
| IN-04 | fixed (bundled, OUT-OF-SCOPE) | `755206db` | Dropped `align-text-bottom` from ChevronUp/Down — tightly coupled with WR-06 chevron rendering. Flagged here for traceability; not part of the default review-fix scope. |
| IN-01 | fixed (bundled, OUT-OF-SCOPE) | `aa60db3d` | `<title>` now HTML-escaped via `escapeHtml()` — bundled with CR-01 because the new escape helpers live in the same file. |

**Tests:** 79 tests pass across Phase 41 surfaces (`src/components/admin/embeds/`, `src/components/admin/pages/blocks/`, `src/components/admin/pages/editor/`). `npx tsc -p tsconfig.app.json --noEmit` clean. `deno check` clean on Calendly OAuth callback.

**Not in scope (Info findings deliberately NOT fixed):**
- IN-02: `CustomIframeBlock` per-mount allowlist fetch (perf, not correctness)
- IN-03: `AddHostnameForm` hostname-format normalization (defense-in-depth)
- IN-05: `subscribeToConsentChange` runtime-narrowing on `event.detail`

_Fixed: 2026-05-24_
_Fixer: Claude (gsd-code-fixer)_
_Scope: Critical + Warning_
