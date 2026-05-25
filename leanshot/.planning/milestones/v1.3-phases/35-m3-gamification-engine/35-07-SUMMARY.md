---
phase: 35-m3-gamification-engine
plan: "07"
subsystem: og-share-card
tags:
  - gamification
  - og-image
  - vercel-functions
  - share
  - viral-attribution
  - hmac
  - edge-runtime

dependency_graph:
  requires:
    - 35-01  # mint_share_token calls auth.uid() (SECDEF context)
    - 35-06  # LevelUpBurst overlay — integration seam (Share button added here)
  provides:
    - api/og/level-up.tsx (Vercel Edge Fn: 1200x630 PNG OG share card)
    - api/share/level/[token].tsx (Vercel Edge Fn: SSR HTML with OG meta tags + redirect)
    - api/share/level/_token.ts (HMAC sign+verify helper, Web Crypto, Edge-compatible)
    - vercel.json carve-out (/api/og/(.*) + /share/level/(.*) ABOVE /share/(.*))
    - src/lib/gamification/share-token.ts (mintShareToken RPC wrapper + buildShareUrl)
    - src/components/dashboard/share/LevelUpShareModal.tsx (X/LinkedIn/copy + Instagram instructions)
    - supabase/migrations/20270708000019_p35_share_token_secret.sql (SECDEF mint_share_token RPC)
    - e2e specs (3 Playwright files, 13 tests, all auto-skip without LEANSHOT_TEST_BASE_URL)
  affects:
    - leanshot/src/components/dashboard/burst/LevelUpBurst.tsx (additive: Share button + modal)
    - leanshot/vercel.json (2 carve-out lines inserted at lines 19-20)

tech_stack:
  added:
    - "@vercel/og ^0.11.1 (server-side only; does NOT enter SPA bundle — Research §Pattern 8)"
  patterns:
    - "Web Crypto HMAC-SHA256 sign+verify (Edge-runtime compatible; no Node crypto)"
    - "REVIEW-F-3 replace-chain base64url in Postgres (mirrors Vercel btoa().replace chain exactly)"
    - "Vercel rewrite carve-out: specific routes ordered ABOVE catch-all SPA fallback (Research A1)"
    - "2s meta-refresh redirect for human visitors; social bots read OG meta tags and exit"
    - "?v=<unix_ts> cache-bust appended to share URL (Pitfall 9 — Twitter caches by URL)"
    - "Viral attribution via ?ref=share in redirect target (Phase 19 _aff cookie setter)"

key_files:
  created:
    - leanshot/api/og/level-up.tsx
    - leanshot/api/share/level/[token].tsx
    - leanshot/api/share/level/_token.ts
    - leanshot/src/lib/gamification/share-token.ts
    - leanshot/src/lib/gamification/__tests__/share-token.test.ts
    - leanshot/tests/vercel-rewrite.test.ts
    - leanshot/e2e/35-og-share-card.spec.ts
    - leanshot/e2e/35-share-attribution.spec.ts
    - leanshot/e2e/35-og-cache-bust.spec.ts
    - supabase/migrations/20270708000019_p35_share_token_secret.sql
  modified:
    - leanshot/package.json (@vercel/og ^0.11.1 added; canvas-confetti ^1.9.4 untouched)
    - leanshot/package-lock.json
    - leanshot/vercel.json (lines 19-20: /api/og/(.*) + /share/level/(.*) carve-outs inserted ABOVE /share/(.*))
    - leanshot/src/components/dashboard/burst/LevelUpBurst.tsx (additive: Share button + LevelUpShareModal wired)

decisions:
  - "vercel.json carve-outs inserted at lines 19-20 (above /share/(.*) at line 21) — order confirmed by 4-assertion Vitest test in tests/vercel-rewrite.test.ts"
  - "Modal.tsx uses open prop (not isOpen) — LevelUpShareModal matches the existing interface"
  - "REVIEW-F-3: Postgres replace-chain (not translate) used in mint_share_token — translate would replace = with _ rather than stripping it, causing silent HMAC mismatch at Vercel verifier"
  - "LevelUpShareModal placed outside the burst overlay motion.div so framer-motion AnimatePresence doesn't conflict with Modal z-index"
  - "tests/vercel-rewrite.test.ts placed under tests/ (not test/) to match vitest.config.ts include pattern: tests/**/*.test.ts"
  - "Playwright ?level= fallback in OG tests (no token needed for smoke) — full round-trip canary needs LEANSHOT_TEST_SHARE_TOKEN from Plan 35-10"
  - "SSR share page: 410 Gone for invalid/expired tokens (prevents CDN from caching dead links)"

metrics:
  duration: "~10 minutes"
  completed: "2026-05-21T12:58:00Z"
  tasks_completed: 4
  files_created: 10
  files_modified: 4
---

# Phase 35 Plan 07: OG Share-Card Vercel Function + SSR Share Page Summary

**One-liner:** HMAC-signed level-up OG share cards via two Vercel Edge Functions (@vercel/og PNG + SSR HTML), with a vercel.json rewrite carve-out that prevents the SPA fallback from swallowing social bot requests, and viral attribution via ?ref=share.

## vercel.json Carve-out Line Numbers

The two carve-out lines were inserted at **lines 19-20** of `leanshot/vercel.json`:

```json
// Line 18: { "source": "/admin/affiliates", "destination": "/index.html" },
// Line 19: { "source": "/api/og/(.*)", "destination": "/api/og/$1" },        ← NEW
// Line 20: { "source": "/share/level/(.*)", "destination": "/api/share/level/$1" },  ← NEW
// Line 21: { "source": "/share/(.*)", "destination": "/index.html" },
```

Order confirmed by `tests/vercel-rewrite.test.ts` (4 assertions pass).

## Rewrite-Order Test Result

`npx vitest run tests/vercel-rewrite.test.ts` — 4 assertions pass:
- `/api/og/(.*)` exists in rewrites
- `/share/level/(.*)` exists in rewrites
- `/share/level/(.*)` is ABOVE `/share/(.*)`
- `/api/og/(.*)` is ABOVE `/share/(.*)`

## REVIEW-F-3 base64url Reconciliation

`mint_share_token` SQL uses a replace-chain (NOT `translate`) to produce base64url:

```sql
v_body_b64 := replace(replace(replace(replace(
  encode(v_body_json::bytea, 'base64'), E'\n', ''), '=', ''), '+', '-'), '/', '_');
v_sig := replace(replace(replace(replace(
  encode(hmac(v_body_b64, v_secret, 'sha256'), 'base64'), E'\n', ''), '=', ''), '+', '-'), '/', '_');
```

This byte-matches the Vercel verifier's:
```ts
btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
```

Both strip `=` padding entirely. `translate('+/=\n', '-_')` would replace `=` with `_` (the 4th-arg placeholder position is only 2 chars), producing a different string and silently breaking HMAC verification.

## Operator Handoff Items for Plan 35-10

### 1. Vault secret setup (run ONCE after migration apply)

```sql
-- Run via Supabase dashboard SQL editor or supabase db query --linked:
SELECT vault.create_secret(
  '<your-HMAC-SHA256-secret-here>',
  'share_token_secret',
  'Phase 35 share-token signing'
);
```

Generate a strong secret: `openssl rand -hex 32`

### 2. Vercel env var setup (must match vault secret above)

```bash
echo "<same-HMAC-SHA256-secret-here>" | vercel env add SHARE_TOKEN_SECRET production
# Also add for preview if you want preview URLs to work:
echo "<same-HMAC-SHA256-secret-here>" | vercel env add SHARE_TOKEN_SECRET preview
```

Verify: `vercel env ls production | grep SHARE_TOKEN_SECRET`

### 3. LEANSHOT_APP_URL env var (optional override)

The SSR share page defaults to `https://app.leanshot.app` for the redirect target. If the production URL differs, set:

```bash
echo "https://app.leanshot.app" | vercel env add LEANSHOT_APP_URL production
```

## Playwright Spec Names + Required Env Vars

| Spec file | Tests | Required env vars |
|-----------|-------|-------------------|
| `e2e/35-og-share-card.spec.ts` | 7 (incl. F-3 round-trip canary) | `LEANSHOT_TEST_BASE_URL` (required), `LEANSHOT_TEST_SHARE_TOKEN` (for round-trip test) |
| `e2e/35-share-attribution.spec.ts` | 3 | `LEANSHOT_TEST_BASE_URL` (required), `LEANSHOT_TEST_SHARE_TOKEN` (optional) |
| `e2e/35-og-cache-bust.spec.ts` | 3 | `LEANSHOT_TEST_BASE_URL` (required) |

All 13 tests auto-skip when `LEANSHOT_TEST_BASE_URL` is absent. Plan 35-10 deploys to Vercel preview, mints a token via `mint_share_token(5)` RPC, and supplies both env vars.

**HUMAN-UAT gates (Plan 35-10):**
- Twitter Card Validator: `https://cards-dev.twitter.com/validator` — no automation possible
- LinkedIn Post Inspector: `https://www.linkedin.com/post-inspector/`
- Instagram mobile DM preview: iOS/Android device required

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 8b02c6c | @vercel/og install + HMAC helper + mint_share_token RPC + share-token client |
| 2 | 51f99f0 | OG image + SSR share page Vercel Functions + vercel.json carve-out |
| 3 | 519df9e | LevelUpShareModal + Share CTA integration in LevelUpBurst |
| 4 | 790c0ca | Playwright e2e specs (13 tests, auto-skip) |

## Deviations from Plan

### Auto-fixed Issues (Rule 2 — Missing Critical)

**1. [Rule 2 - Missing Critical] Modal uses `open` prop, not `isOpen`**
- **Found during:** Task 3 (LevelUpShareModal creation)
- **Issue:** Plan template uses `isOpen` but `src/components/ui/Modal.tsx` exports `ModalProps` with `open: boolean`
- **Fix:** LevelUpShareModal.tsx uses `open` prop matching the existing interface
- **Files modified:** `leanshot/src/components/dashboard/share/LevelUpShareModal.tsx`
- **Commits:** 519df9e

**2. [Rule 1 - Bug] `tests/` vs `test/` directory for Vitest spec**
- **Found during:** Task 2 (vercel-rewrite spec placement)
- **Issue:** Plan says `leanshot/test/vercel-rewrite.spec.ts` but vitest.config.ts includes `tests/**/*.test.ts` (not `test/`), and `test/` directory doesn't exist
- **Fix:** Created `tests/vercel-rewrite.test.ts` (matches vitest include pattern; `.test.ts` suffix per project convention)
- **Files modified:** `leanshot/tests/vercel-rewrite.test.ts`
- **Commits:** 51f99f0

**3. [Rule 3 - Blocker] `api/` directory did not exist**
- **Found during:** Task 1 (creating helper file)
- **Issue:** `leanshot/api/` directory needed for Vercel Functions didn't exist
- **Fix:** Created directory tree with `mkdir -p` — standard Vercel project structure for Edge Functions
- **Commits:** 8b02c6c

## Threat Flags

None — all trust boundaries are covered by the plan's `<threat_model>` (T-35-07-01 through T-35-07-10).

## Self-Check: PASSED

Files exist:
- leanshot/api/og/level-up.tsx ✓
- leanshot/api/share/level/[token].tsx ✓
- leanshot/api/share/level/_token.ts ✓
- leanshot/src/lib/gamification/share-token.ts ✓
- leanshot/src/lib/gamification/__tests__/share-token.test.ts ✓
- leanshot/tests/vercel-rewrite.test.ts ✓
- leanshot/e2e/35-og-share-card.spec.ts ✓
- leanshot/e2e/35-share-attribution.spec.ts ✓
- leanshot/e2e/35-og-cache-bust.spec.ts ✓
- supabase/migrations/20270708000019_p35_share_token_secret.sql ✓
- leanshot/src/components/dashboard/share/LevelUpShareModal.tsx ✓

Commits exist:
- 8b02c6c ✓ (Task 1)
- 51f99f0 ✓ (Task 2)
- 519df9e ✓ (Task 3)
- 790c0ca ✓ (Task 4)

Tests:
- tests/vercel-rewrite.test.ts: 4/4 passing ✓
- src/lib/gamification/__tests__/share-token.test.ts: 3/3 passing ✓
- e2e/35-*.spec.ts: 13/13 auto-skip (correct without LEANSHOT_TEST_BASE_URL) ✓

TypeScript: clean ✓
