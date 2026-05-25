---
phase: 56-ad-network
plan: 04
type: execute
wave: 2
depends_on: [56-02]
files_modified:
  - leanshot/src/lib/ads/cspGenerator.ts
  - leanshot/src/lib/ads/cspGenerator.test.ts
  - leanshot/middleware.ts
autonomous: true
requirements: [AD-09]
must_haves:
  truths:
    - "CSP generator appends approved ad-network hosts to script-src and connect-src"
    - "CSP generator NEVER appends a host that is on the GLP-1 advertiser block-list"
    - "Edge Middleware fetches the allowlist (60s cache, parallel to the existing iframe_allowlist fetch) and augments the CSP at request time"
    - "On fetch error the middleware serves the unaugmented CSP (fail-safe, no ad hosts) — same posture as the iframe_allowlist path"
    - "CSP assembly stays in Edge Middleware, NOT vercel.json (no env interpolation)"
  artifacts:
    - path: "leanshot/src/lib/ads/cspGenerator.ts"
      provides: "Pure CSP directive augmentation excluding block-listed hosts"
      exports: ["appendAdNetworkHosts", "filterBlocklisted"]
    - path: "leanshot/middleware.ts"
      provides: "Ad-network allowlist fetch + script-src/connect-src augmentation"
      contains: "ad_csp_allowlist"
  key_links:
    - from: "leanshot/middleware.ts"
      to: "ad_csp_allowlist / ad_advertiser_blocklist"
      via: "Supabase REST fetch (60s cache)"
      pattern: "ad_csp_allowlist"
    - from: "leanshot/middleware.ts"
      to: "leanshot/src/lib/ads/cspGenerator.ts"
      via: "appendAdNetworkHosts call on the CSP string"
      pattern: "appendAdNetworkHosts"
---

<objective>
Generate the ad-network CSP allowlist FROM the GLP-1 advertiser block-list (AD-09): a pure `cspGenerator.ts` that appends approved ad-network hosts to `script-src` + `connect-src` while excluding any host on the block-list, wired into `middleware.ts` as a new request-time augmentation (60s cache, parallel to the existing `appendFrameSrcHosts` / iframe_allowlist pattern).

Purpose: AdSense + ad-network domains must be allowed in CSP for serving to work, but competing GLP-1 brand domains must NEVER appear in the allowlist. The generator derives the allowlist by excluding block-listed hosts. CSP stays in Edge Middleware because vercel.json does not interpolate env (project memory). Fully verifiable now via unit tests on the pure generator + middleware grep — no live ad fill needed.
Output: cspGenerator.ts + test + middleware.ts augmentation.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/56-ad-network/56-RESEARCH.md
@.planning/phases/56-ad-network/56-02-SUMMARY.md
@leanshot/middleware.ts

<interfaces>
<!-- Verified from codebase (middleware.ts). Mirror the existing iframe_allowlist augmentation exactly. -->

Existing pattern in middleware.ts:
```
const CACHE_TTL_MS = 60_000;
let cache: { hosts: string[]; expiresAt: number } | null = null;       // iframe cache — add a SEPARATE cache for ad hosts
async function fetchAllowlistHosts(supabaseUrl, anonKey) {              // GET ${supabaseUrl}/rest/v1/iframe_allowlist?select=hostname
  const url = `${supabaseUrl}/rest/v1/iframe_allowlist?select=hostname`;
  ...
}
function appendFrameSrcHosts(csp, hosts) {                              // csp.replace(/frame-src ([^;]+);/, ...) — anchored on ; terminator
  return csp.replace(/frame-src ([^;]+);/, (_m, dirs) => `frame-src ${dirs.trim()} ${formatted};`);
}
// In middleware(): if (!cache || expired) { hosts = await fetchAllowlistHosts(...); cache = {...} } csp = appendFrameSrcHosts(csp, cache.hosts);
// Fail-safe: any fetch error → serve unaugmented CSP (warns, does not throw).
process.env.SUPABASE_URL, anonKey already read in middleware.
```

Tables (from 56-02-SUMMARY.md):
- ad_csp_allowlist: hostname text, directive text in ('script-src','connect-src'), enabled bool.
- ad_advertiser_blocklist: hostname text (GLP-1 brands, default-blocked).

Fetch with the same REST shape: ${supabaseUrl}/rest/v1/ad_csp_allowlist?select=hostname,directive&enabled=eq.true and ${supabaseUrl}/rest/v1/ad_advertiser_blocklist?select=hostname.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure CSP generator (block-list-derived allowlist) (AD-09)</name>
  <files>leanshot/src/lib/ads/cspGenerator.ts, leanshot/src/lib/ads/cspGenerator.test.ts</files>
  <behavior>
    - filterBlocklisted(allowHosts, blockHosts) returns allowHosts minus any host present in blockHosts (case-insensitive hostname match).
    - appendAdNetworkHosts(csp, scriptHosts, connectHosts) appends https://<host> entries to the existing script-src and connect-src directives, anchored on the ';' terminator (mirror appendFrameSrcHosts); other directives untouched.
    - Given a blocklisted GLP-1 host (e.g. wegovy.com) accidentally present in the allow set, the final CSP NEVER contains it (filter applied before append) — explicit test.
    - Empty host lists leave the CSP unchanged.
  </behavior>
  <action>Create src/lib/ads/cspGenerator.ts with pure functions: filterBlocklisted(allow: {hostname:string,directive:string}[], block: string[]): typeof allow (drops any whose hostname is in the lowercased block set) and appendAdNetworkHosts(csp: string, scriptHosts: string[], connectHosts: string[]): string (regex-replace script-src and connect-src directives, anchored on ';', appending https://<host> tokens — reuse the exact replace style from middleware.ts appendFrameSrcHosts). MUST NOT import native/health (file is under src/lib/ads/). Write the test (RED) covering: blocklist filtering removes GLP-1 hosts, append targets only script-src/connect-src, empty lists are no-ops, a blocklisted host never survives into the CSP.</action>
  <verify>
    <automated>cd leanshot && npx vitest run src/lib/ads/cspGenerator.test.ts --config vite.config.ts</automated>
  </verify>
  <done>Generator excludes block-listed hosts and appends approved hosts to script-src/connect-src only; the GLP-1-host-never-survives test passes; tests green.</done>
</task>

<task type="auto">
  <name>Task 2: Wire ad-network allowlist into Edge Middleware</name>
  <files>leanshot/middleware.ts</files>
  <action>Add a new request-time augmentation parallel to the existing iframe_allowlist fetch. Add a SEPARATE module-level cache (e.g. adCspCache) with the same 60s CACHE_TTL_MS. Add fetchAdCspHosts(supabaseUrl, anonKey) that GETs ${supabaseUrl}/rest/v1/ad_csp_allowlist?select=hostname,directive&enabled=eq.true AND ${supabaseUrl}/rest/v1/ad_advertiser_blocklist?select=hostname, then runs filterBlocklisted (from cspGenerator.ts) and splits into scriptHosts/connectHosts by directive. In middleware(), after the existing appendFrameSrcHosts augmentation, refresh the ad cache if expired and call appendAdNetworkHosts(csp, scriptHosts, connectHosts) from cspGenerator.ts. Fail-safe: wrap in try/catch — on any error, warn and serve the CSP WITHOUT ad-network hosts (mirror the iframe_allowlist fail-safe). Do NOT move any CSP logic to vercel.json (no env interpolation — project memory). Import filterBlocklisted + appendAdNetworkHosts from the cspGenerator module.</action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && grep -q "ad_csp_allowlist" leanshot/middleware.ts && grep -q "appendAdNetworkHosts" leanshot/middleware.ts && grep -q "ad_advertiser_blocklist" leanshot/middleware.ts && cd leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -i "middleware" || echo "tsc-clean-for-middleware"</automated>
  </verify>
  <done>Middleware fetches allowlist + blocklist (60s cache), augments script-src/connect-src via cspGenerator, fail-safe on error; no CSP logic in vercel.json; tsc clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| DB allowlist → CSP header | admin-controlled host list crosses into the security header |
| block-list → allowlist derivation | competitor domains must be structurally excluded |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-56-11 | Repudiation | CSP allowlist | mitigate | filterBlocklisted applied BEFORE append — block-listed GLP-1 hosts can never enter the CSP; unit-tested |
| T-56-12 | Tampering | middleware fetch | mitigate | fail-safe: fetch error serves CSP without ad hosts (no permissive fallback) |
| T-56-13 | Information Disclosure | allowlist REST fetch | accept | reads only hostname/directive columns via anon key; same surface as existing iframe_allowlist |
</threat_model>

<verification>
- Task verify commands (cspGenerator vitest + middleware grep + tsc).
- `cd leanshot && bash scripts/check-no-health-in-ad-context.sh src` — cspGenerator under src/lib/ads/ imports no health.
</verification>

<success_criteria>
The CSP allowlist is generated by excluding block-listed GLP-1 hosts and appending approved ad-network hosts to script-src/connect-src at request time in Edge Middleware, fail-safe on error, with the block-list-exclusion guarantee proven by unit test.
</success_criteria>

<output>
Create `.planning/phases/56-ad-network/56-04-SUMMARY.md` when done. Record the exact REST query strings used and note that real ad-host CSP behavior is observable only once allowlist rows exist (seeded in 56-02).
</output>
