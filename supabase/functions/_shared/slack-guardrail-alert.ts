/**
 * slack-guardrail-alert.ts — Vault-fetched Slack webhook helper for Phase 60 guardrails.
 *
 * Phase 60 Plan 60-02. AI-SPEC §6 + §7 Slack channel routing.
 *
 * Fetches the Slack webhook URL from `vault.decrypted_secrets` at call-time
 * (never hardcoded; never from VITE_* env). Vendor-gated no-op when vault
 * row is absent — mirrors `_shared/posthog-server.ts` missing-key behavior.
 *
 * NEVER throws back to caller: Slack delivery is best-effort. The guardrail
 * block has ALREADY fired before this helper is called. An outage or timeout
 * in Slack MUST NOT block the guardrail consumer from returning a Response.
 *
 * Security:
 *   - Webhook URL cached per-isolate after first vault fetch (repeated trips
 *     in the same isolate do not re-query vault).
 *   - Static grep gate in 60-02 Task 5 enforces no plaintext hooks.slack.com
 *     in any source file under supabase/functions/ (test stubs excluded).
 *   - Payload type pins severity/title/text/fields/trace_id — no free-form
 *     passthrough that could leak PHI.
 *
 * AI-SPEC §7 channel routing table (lines 960-970):
 *   pharma02  → #alerts-pharma02  (P1 — pages on-call)
 *   regulatory→ #alerts-regulatory (P1 — regulatory counsel)
 *   rag       → #alerts-rag       (P2/P3 — corpus/threshold investigation)
 *   cost      → #alerts-cost      (P2 — auto-pause)
 *   research  → #alerts-research  (P3 — k-anonymity / Phase 62 owner)
 *
 * [[reference_supabase_pg_cron_vault_service_role_pattern]]:
 *   vault lookup via `select decrypted_secret from vault.decrypted_secrets
 *   where name='slack_guardrail_webhook'` using service-role admin client.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ──────────────────────────────────────────────────────────────────────────────
// Module-level lazy singletons (no side-effects at import time)
// ──────────────────────────────────────────────────────────────────────────────

let _vaultAdmin: SupabaseClient | null = null;
let _vaultEnvWarned = false;   // one-time warn for missing SUPABASE_URL / key
let _vaultRowWarned = false;   // one-time warn for absent vault row
let _cachedWebhook: string | null = null;
let _webhookFetched = false;   // track whether we've attempted a fetch (even if null result)

// ──────────────────────────────────────────────────────────────────────────────
// Exported types (AI-SPEC §7)
// ──────────────────────────────────────────────────────────────────────────────

/** Pinned exactly to AI-SPEC §7 channel routing table (lines 960-970). */
export type GuardrailAlertChannel =
  | 'pharma02'
  | 'regulatory'
  | 'rag'
  | 'cost'
  | 'research';

/** Alert severity maps to Slack attachment color. */
export type GuardrailAlertSeverity = 'P1' | 'P2' | 'P3';

/** Payload passed by guardrail consumers to `sendSlackGuardrailAlert`. */
export interface GuardrailAlertPayload {
  severity: GuardrailAlertSeverity;
  title: string;
  text: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  trace_id?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal channel + severity maps
// ──────────────────────────────────────────────────────────────────────────────

const CHANNEL_MAP: Record<GuardrailAlertChannel, string> = {
  pharma02: '#alerts-pharma02',
  regulatory: '#alerts-regulatory',
  rag: '#alerts-rag',
  cost: '#alerts-cost',
  research: '#alerts-research',
};

const SEVERITY_COLOR: Record<GuardrailAlertSeverity, string> = {
  P1: '#FF0000',
  P2: '#FFA500',
  P3: '#FFFF00',
};

// ──────────────────────────────────────────────────────────────────────────────
// Lazy admin singleton (mirror of getMirrorAdmin in posthog-server.ts)
// ──────────────────────────────────────────────────────────────────────────────

function getVaultAdmin(): SupabaseClient | null {
  if (_vaultAdmin) return _vaultAdmin;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    if (!_vaultEnvWarned) {
      console.warn(
        '[slack-guardrail-alert] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — Slack alerts disabled.',
      );
      _vaultEnvWarned = true;
    }
    return null;
  }
  _vaultAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _vaultAdmin;
}

// ──────────────────────────────────────────────────────────────────────────────
// Vault webhook URL fetch (cached per-isolate)
// ──────────────────────────────────────────────────────────────────────────────

async function fetchWebhookUrl(): Promise<string | null> {
  // Return cached value if we've already attempted a fetch
  if (_webhookFetched) return _cachedWebhook;

  // Env-var fast-path (Phase 60.5 operator setup 2026-05-26): if
  // SLACK_GUARDRAIL_WEBHOOK_URL is set as a Supabase secret, prefer it
  // over the vault lookup. Keeps the vault path as the production-canonical
  // form per [[reference_supabase_pg_cron_vault_service_role_pattern]] but
  // unblocks Phase 60 Wave 1 without requiring an SQL insert into vault.secrets.
  const envWebhook = Deno.env.get('SLACK_GUARDRAIL_WEBHOOK_URL');
  if (envWebhook && envWebhook.startsWith('https://hooks.slack.com/services/')) {
    _cachedWebhook = envWebhook;
    _webhookFetched = true;
    return _cachedWebhook;
  }

  const admin = getVaultAdmin();
  if (!admin) {
    _webhookFetched = true;
    return null;
  }

  try {
    const { data, error } = await (admin
      .from('vault.decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', 'slack_guardrail_webhook')
      .maybeSingle() as unknown as Promise<{
        data: { decrypted_secret: string } | null;
        error: { message?: string } | null;
      }>);

    if (error) {
      console.warn(`[slack-guardrail-alert] vault query failed: ${error.message ?? 'unknown'}`);
      _webhookFetched = true;
      return null;
    }

    if (!data?.decrypted_secret) {
      if (!_vaultRowWarned) {
        console.warn(
          "[slack-guardrail-alert] vault row 'slack_guardrail_webhook' not found — Slack alerts disabled.",
        );
        _vaultRowWarned = true;
      }
      _webhookFetched = true;
      return null;
    }

    _cachedWebhook = data.decrypted_secret;
    _webhookFetched = true;
    return _cachedWebhook;
  } catch (err) {
    console.warn('[slack-guardrail-alert] vault fetch threw:', err);
    _webhookFetched = true;
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Test seams (@internal — NOT part of the public API)
// ──────────────────────────────────────────────────────────────────────────────

/** @internal Set a test vault admin client (bypasses env-var guards). */
export function setVaultAdminForTest(client: unknown): void {
  _vaultAdmin = client as SupabaseClient;
}

/** @internal Reset vault admin singleton and one-time-warn flags. */
export function resetVaultAdminForTest(): void {
  _vaultAdmin = null;
  _vaultEnvWarned = false;
  _vaultRowWarned = false;
}

/** @internal Reset cached webhook URL so next call re-fetches. */
export function resetCachedWebhookForTest(): void {
  _cachedWebhook = null;
  _webhookFetched = false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Send a guardrail alert to the appropriate Slack channel.
 *
 * Fetches the webhook URL from `vault.decrypted_secrets WHERE name='slack_guardrail_webhook'`
 * via service-role admin client. Caches the URL per-isolate.
 *
 * NEVER throws. HTTP failures are logged via `console.warn`.
 * Slack delivery is best-effort; the guardrail block has already fired.
 *
 * @param channel - AI-SPEC §7 channel key ('pharma02' | 'regulatory' | 'rag' | 'cost' | 'research')
 * @param payload - Alert payload with severity, title, text, optional fields + trace_id
 */
export async function sendSlackGuardrailAlert(
  channel: GuardrailAlertChannel,
  payload: GuardrailAlertPayload,
): Promise<void> {
  const url = await fetchWebhookUrl();
  if (!url) return;

  const fields = [
    ...(payload.fields ?? []),
    ...(payload.trace_id
      ? [{ title: 'trace_id', value: payload.trace_id, short: true }]
      : []),
  ];

  const body = {
    channel: CHANNEL_MAP[channel],
    attachments: [
      {
        color: SEVERITY_COLOR[payload.severity],
        title: payload.title,
        text: payload.text,
        fields,
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      let responseText = '';
      try {
        responseText = await res.text();
      } catch {
        // ignore
      }
      console.warn(
        `[slack-guardrail-alert] send failed status=${res.status} body=${responseText.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.warn('[slack-guardrail-alert] send failed:', err);
  }
}
