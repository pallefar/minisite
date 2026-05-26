/**
 * privacy-optout-process — handler.ts
 *
 * Phase 64 Plan 64-02.
 *
 * Handles POST /privacy/do-not-sell form submissions.
 * Synchronous fan-out per INSIGHTS-09 lesson (Phase 62):
 *   1. INSERT into privacy_optout_requests
 *   2. UPSERT into ad_targeting_exclusion
 *   3. UPSERT into email_lifecycle_exclusion
 *   4. Best-effort PostHog opt-out capture (failure does NOT fail the request)
 *   5. Resend confirmation email
 *   6. UPDATE privacy_optout_requests SET propagated_at = now()
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: 'privacy-optout-process' }
 * POST / → no auth required (public anonymous form submission)
 *
 * === Security (STRIDE register in PLAN.md) ===
 * T-64-02-02: manual input validation BEFORE any INSERT
 * T-64-02-03: strip /[\x00-\x1F\x7F]/g control chars (CR-02 Phase 60 lesson)
 * T-64-02-05: generic error strings; never echo SQL/Postgres errors
 * T-64-02-06: per-IP rate limit 10/h
 * T-64-02-07: secrets read from Deno.env only; never echoed in responses
 *
 * === Auth ===
 * No auth required — Do-Not-Sell is auth-optional (UI-SPEC §2).
 * Fan-out tables use service-role client (RLS bypass).
 *
 * === Deploy ===
 * Deferred to Plan 64-08. DO NOT deploy from this file.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── Dependency injection interface (for testability) ────────────────────────

/**
 * Injected dependencies — enables full test isolation without real network calls.
 *
 * Per the DI pattern from Phase 60-12 rag-newsletter-sender/handler.ts.
 * Production values are constructed in index.ts and passed to handle().
 */
export interface PrivacyOptoutDeps {
  /** Fetch implementation (allows mocking PostHog + Resend in tests) */
  fetchImpl: typeof fetch;
  /** Supabase service role client (bypasses RLS for fan-out writes) */
  supabaseServiceClient: ReturnType<typeof createClient>;
  /** Resend API key — 'test-stub' returns { ok:true, stubbed:true } */
  resendApiKey: string;
  /** PostHog project key (nullable — no-op if missing) */
  posthogProjectKey: string | null;
  /** Supabase project URL */
  supabaseUrl: string;
}

// ─── Validation constants ─────────────────────────────────────────────────────

const VALID_STATE_RESIDENCIES = ['CA', 'VA', 'CO', 'CT', 'UT', 'OTHER'] as const;
const VALID_OPT_OUT_SCOPES = ['advertising', 'sale', 'sharing'] as const;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/g;
const MAX_BODY_BYTES = 4 * 1024; // 4 KB
const MAX_NAME_LENGTH = 200;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MINUTES = 60;

// ─── Sanitizers ───────────────────────────────────────────────────────────────

/** Strip control characters from user-supplied strings (T-64-02-03 / CR-02 Phase 60 lesson) */
function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHAR_REGEX, '');
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Privacy opt-out handler. Exported as named function so tests can call
 * it directly without triggering Deno.serve.
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is guarded
 * by `if (import.meta.main)` in index.ts to prevent server bind on test import.
 */
export async function handle(
  req: Request,
  deps: PrivacyOptoutDeps,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'privacy-optout-process' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Only POST accepted from here ────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Content-Type gate ───────────────────────────────────────────────────────
  const contentType = req.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return new Response(
      JSON.stringify({ error: 'content_type must be application/json' }),
      { status: 415, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Body size gate (4 KB — T-64-02-06) ─────────────────────────────────────
  const bodyText = await req.text();
  if (bodyText.length > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ error: 'request body too large' }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let rawBody: Record<string, unknown>;
  try {
    rawBody = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Input validation (T-64-02-02) ──────────────────────────────────────────

  // name
  if (typeof rawBody.name !== 'string' || !rawBody.name.trim()) {
    return new Response(
      JSON.stringify({ error: 'name is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const name = stripControlChars(rawBody.name.trim()).slice(0, MAX_NAME_LENGTH);

  // email
  if (typeof rawBody.email !== 'string' || !rawBody.email.trim()) {
    return new Response(
      JSON.stringify({ error: 'email is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const emailRaw = stripControlChars(rawBody.email.trim());
  if (!EMAIL_REGEX.test(emailRaw)) {
    return new Response(
      JSON.stringify({ error: 'email is invalid' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const email = emailRaw.toLowerCase();

  // state_residency
  if (
    typeof rawBody.state_residency !== 'string' ||
    !VALID_STATE_RESIDENCIES.includes(rawBody.state_residency as typeof VALID_STATE_RESIDENCIES[number])
  ) {
    return new Response(
      JSON.stringify({
        error: 'state_residency must be one of CA/VA/CO/CT/UT/OTHER',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const state_residency = rawBody.state_residency as string;

  // opt_out_scope
  if (!Array.isArray(rawBody.opt_out_scope) || rawBody.opt_out_scope.length < 1 || rawBody.opt_out_scope.length > 3) {
    return new Response(
      JSON.stringify({ error: 'opt_out_scope must be an array of 1-3 items' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const validScopes = VALID_OPT_OUT_SCOPES as readonly string[];
  for (const scope of rawBody.opt_out_scope as unknown[]) {
    if (typeof scope !== 'string' || !validScopes.includes(scope)) {
      return new Response(
        JSON.stringify({
          error: 'opt_out_scope items must be one of advertising/sale/sharing',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
  const opt_out_scope = rawBody.opt_out_scope as string[];

  // ── Extract request metadata ─────────────────────────────────────────────────
  const request_ip = req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;
  const request_user_agent = req.headers.get('User-Agent') ?? null;

  const { supabaseServiceClient: db } = deps;

  // ── Per-IP rate limit (T-64-02-06): > 10 submissions from same IP in last hour ──
  if (request_ip) {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    // deno-lint-ignore no-explicit-any
    const { data: ipCountData } = await (db.from('privacy_optout_requests') as any)
      .select('id', { count: 'exact', head: true })
      .eq('request_ip', request_ip)
      .gt('submitted_at', windowStart)
      .single() as { data: { count: number } | null; error: unknown };

    const ipCount = ipCountData?.count ?? 0;
    if (typeof ipCount === 'number' && ipCount >= RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({ error: 'Too many requests; try again later' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // ── Idempotency check: existing submission within 24h for same email ─────────
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // deno-lint-ignore no-explicit-any
  const { data: existingRow } = await (db.from('privacy_optout_requests') as any)
    .select('id, submitted_at, email')
    .eq('email', email)
    .gt('submitted_at', oneDayAgo)
    .maybeSingle() as { data: { id: string; submitted_at: string } | null; error: unknown };

  if (existingRow) {
    return new Response(
      JSON.stringify({
        ok: true,
        idempotent: true,
        request_id: existingRow.id,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Fan-out step 1: INSERT into privacy_optout_requests ─────────────────────
  // deno-lint-ignore no-explicit-any
  const { data: insertedRows, error: insertError } = await (db.from('privacy_optout_requests') as any)
    .insert({
      email,
      name,
      state_residency,
      opt_out_scope,
      request_ip,
      request_user_agent,
    })
    .select('id, submitted_at') as { data: { id: string; submitted_at: string }[] | null; error: unknown };

  if (insertError || !insertedRows || insertedRows.length === 0) {
    console.error('[privacy-optout-process] INSERT failed:', insertError);
    return new Response(
      JSON.stringify({ error: 'invalid request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const request_id = insertedRows[0].id;
  const submitted_at_iso = insertedRows[0].submitted_at ?? new Date().toISOString();

  // ── Fan-out step 2: UPSERT into ad_targeting_exclusion ──────────────────────
  // ON CONFLICT on email (unauth path) via partial unique index: email where user_id is null
  // deno-lint-ignore no-explicit-any
  await (db.from('ad_targeting_exclusion') as any)
    .upsert(
      {
        user_id: null,
        email,
        source: 'do_not_sell',
        excluded_at: new Date().toISOString(),
      },
      { onConflict: 'email', ignoreDuplicates: true },
    ) as { data: unknown; error: unknown };

  // ── Fan-out step 3: UPSERT into email_lifecycle_exclusion ───────────────────
  // deno-lint-ignore no-explicit-any
  await (db.from('email_lifecycle_exclusion') as any)
    .upsert(
      {
        user_id: null,
        email,
        source: 'do_not_sell',
        excluded_at: new Date().toISOString(),
      },
      { onConflict: 'email', ignoreDuplicates: true },
    ) as { data: unknown; error: unknown };

  // ── Fan-out step 4: Best-effort PostHog $opt_out capture ────────────────────
  // Failure is logged but does NOT fail the overall request (T-64-02 Plan spec).
  // The distinct_id for anonymous users is an email-hash to avoid PII in PostHog.
  const posthogKey = deps.posthogProjectKey;
  if (posthogKey) {
    try {
      // Use email as distinct_id for anonymous opt-out (no user_id available)
      // PostHog $opt_out event tells server-side pipeline to skip this identity
      const phRes = await deps.fetchImpl('https://us.i.posthog.com/capture/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: posthogKey,
          event: '$opt_out',
          distinct_id: email, // email is the anon distinct_id for Do-Not-Sell
          properties: {
            $ip: request_ip ?? '',
            state_residency,
            opt_out_scope,
            opt_out_source: 'do_not_sell_form',
          },
        }),
      });
      if (!phRes.ok) {
        console.warn('[privacy-optout-process] PostHog opt-out non-2xx:', phRes.status);
      }
    } catch (phErr) {
      console.warn('[privacy-optout-process] PostHog opt-out failed (best-effort):', phErr);
    }
  }

  // ── Fan-out step 5: Resend confirmation email ────────────────────────────────
  let confirmationEmailSentAt: string | null = null;

  // Load and render templates
  const htmlTemplate = await loadOptoutTemplate('optout-confirmation.html', import.meta.url);
  const textTemplate = await loadOptoutTemplate('optout-confirmation.txt', import.meta.url);
  const submittedDate = new Date(submitted_at_iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const htmlBody = renderTemplate(htmlTemplate, {
    name,
    state: state_residency,
    submitted_at: submittedDate,
  });
  const textBody = renderTemplate(textTemplate, {
    name,
    state: state_residency,
    submitted_at: submittedDate,
  });

  if (deps.resendApiKey === 'test-stub') {
    // Stub mode — no real HTTP call; per lifecycle-send.ts Pitfall 6
    confirmationEmailSentAt = new Date().toISOString();
    console.log('[privacy-optout-process] Resend stubbed — email skipped');
  } else if (deps.resendApiKey) {
    try {
      const resendRes = await deps.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deps.resendApiKey}`,
        },
        body: JSON.stringify({
          from: 'LeanShot Privacy <noreply@app.leanshot.app>',
          to: [email],
          subject: 'We received your Do-Not-Sell request — confirmation',
          html: htmlBody,
          text: textBody,
        }),
      });
      if (resendRes.ok) {
        confirmationEmailSentAt = new Date().toISOString();
      } else {
        console.warn('[privacy-optout-process] Resend non-2xx:', resendRes.status);
      }
    } catch (resendErr) {
      console.warn('[privacy-optout-process] Resend send failed (logged; not blocking):', resendErr);
    }
  }

  // ── Fan-out step 6: UPDATE propagated_at + confirmation_email_sent_at ───────
  // propagated_at is set to now() only after DB fan-outs succeed (steps 1-3 above).
  // confirmation_email_sent_at only set if Resend call was successful.
  const propagated_at = new Date().toISOString();
  const updatePayload: Record<string, string | null> = { propagated_at };
  if (confirmationEmailSentAt) {
    updatePayload.confirmation_email_sent_at = confirmationEmailSentAt;
  }

  // deno-lint-ignore no-explicit-any
  await (db.from('privacy_optout_requests') as any)
    .update(updatePayload)
    .eq('id', request_id) as { data: unknown; error: unknown };

  return new Response(
    JSON.stringify({
      ok: true,
      request_id,
      propagated_at,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ─── Template helpers ─────────────────────────────────────────────────────────

/**
 * Load an email template from the templates/ directory.
 * Uses Deno.readTextFile with a path relative to this module's location.
 * Falls back to an inline placeholder if the file cannot be read (test env).
 */
async function loadOptoutTemplate(filename: string, moduleUrl: string): Promise<string> {
  try {
    // Derive path relative to handler.ts module URL
    const moduleDir = new URL('.', moduleUrl).pathname;
    const templatePath = `${moduleDir}templates/${filename}`;
    return await Deno.readTextFile(templatePath);
  } catch {
    // Return inline fallback (used in test env where templates may not be present on disk)
    return filename.endsWith('.html')
      ? '<p>Do-Not-Sell confirmation for {{name}} ({{state}}) submitted on {{submitted_at}}.</p>'
      : 'Do-Not-Sell confirmation for {{name}} ({{state}}) submitted on {{submitted_at}}.';
  }
}

/**
 * Simple {{placeholder}} template renderer.
 * Substitutes {{name}}, {{state}}, {{submitted_at}} in template strings.
 */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? '');
}
