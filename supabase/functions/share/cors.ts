/**
 * CORS headers for the `share` Edge Function.
 *
 * **Critical deviation from `ai-chat/cors.ts`** (08-02-PLAN.md
 * "critical_deviations_from_ai_chat", Pitfalls 3 + 4, ME-4):
 *
 *   `ai-chat` uses `Access-Control-Allow-Origin: *` because JWT IS the auth
 *   gate. The share function uses HttpOnly cookies — the browser refuses to
 *   include credentialed cookies on a request whose response has ACAO=`*`.
 *   The browser also forbids the `*` + `credentials: include` combo at the
 *   spec level. Therefore the share function MUST echo the request `Origin`
 *   header back IF it matches a server-side allow-list, otherwise return the
 *   sentinel `'null'` to lock the browser out.
 *
 * **Allow-list sourcing (ME-4):** the production Vercel domain is NOT hard-
 * coded in this file. It is read at cold-start from the `SHARE_ALLOWED_ORIGINS`
 * Deno env var (comma-separated). Per Task 3 checkpoint, the orchestrator
 * fetches the real domain via `vercel ls` and sets the secret via
 * `supabase secrets set SHARE_ALLOWED_ORIGINS=...`.
 *
 * **Vercel preview pattern:** `*.vercel.app` URLs aren't enumerated in the
 * env var because there are too many; instead we accept them via a regex
 * fallback. Production custom domains MUST be in the env var to be allowed.
 *
 * **Cache-Control: private, no-store** (ME-1, Pitfall 7, T-08-T2) lives in
 * `BASE_RESPONSE_HEADERS` so every response — including 4xx / 5xx / 429 —
 * carries it. The grep gate in the plan asserts ≥5 occurrences across files.
 */

// ── Allow-list resolution ────────────────────────────────────────────────────
const ENV_LIST = (Deno.env.get('SHARE_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const ALLOWED_ORIGINS = new Set<string>([
  ...ENV_LIST,
  // Local dev fallback — patient running `npm run dev` against the deployed
  // function. The function itself runs on supabase.co, so the SPA dev origin
  // counts as cross-origin.
  'http://localhost:5173',
]);

// Vercel preview deploys are *.vercel.app — enumeration is impractical so
// we pattern-match. Production custom domains (e.g. leanshot.com) MUST come
// in through SHARE_ALLOWED_ORIGINS — they will NOT match this pattern.
const VERCEL_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin: string): boolean {
  if (origin === '') return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (VERCEL_PREVIEW_PATTERN.test(origin)) return true;
  return false;
}

/**
 * Build CORS headers for this request. Echoes the request `Origin` only if
 * it's on the allow-list; otherwise emits the sentinel `'null'` to deny.
 *
 * `Access-Control-Allow-Credentials: true` is REQUIRED to make HttpOnly
 * cookies travel cross-origin. `Vary: Origin, Cookie` forces any cache
 * layer to key by both (defense vs. T-08-T2 CDN poisoning).
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = isAllowedOrigin(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin, Cookie',
  };
}

/**
 * Base response headers. Cache-Control: private, no-store on every response
 * (ME-1, Pitfall 7) — including 4xx / 5xx — so an upstream CDN or proxy
 * never caches a snapshot or an error containing leaked state.
 */
export const BASE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};

// Exposed for unit tests — lets the test suite assert allow-list semantics
// without spawning a full Deno.serve request.
export const __internals = {
  isAllowedOrigin,
  VERCEL_PREVIEW_PATTERN,
  ALLOWED_ORIGINS,
};
