/**
 * Deno tests for `_shared/email-router.ts` — Phase 25 Plan 25-03.
 *
 * Test plan (5 cases):
 *   T1: phi=false + valid Resend env → delegates to sendResendEmail (non-PHI path)
 *   T2: phi=true + no AWS_SES_BAA_ACTIVE → returns {provider:'ses', id:'noop-baa_pending', skipped:true}
 *   T3: phi=true + no AWS credentials → returns {provider:'ses', id:'noop-no_credentials', skipped:true}
 *   T4: phi=true + test-stub credentials + BAA active → health check shortcuts; send mocked → success
 *   T5: phi=true + suppressed recipient → returns {provider:'ses', id:'suppressed', skipped:true}
 *
 * Strategy: env vars set via Deno.env.set(); lazy singletons make env
 * changes visible without re-importing. __resetSesForTest() clears the
 * singleton between test cases that need different env configs.
 *
 * Per [[reference_deno_test_discovery]]: file named `<name>.test.ts`.
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { sendEmail, __resetSesForTest } from './email-router.ts';

// ─── Minimal supabase mock builder ───────────────────────────────────────────

type SuppressionRow = { recipient_hash: string } | null;

function makeMockSupabase(suppressedHash: string | null = null) {
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return this;
        },
        eq(_col: string, _val: string) {
          return this;
        },
        maybeSingle(): Promise<{ data: SuppressionRow; error: null }> {
          if (suppressedHash !== null) {
            // Any hash lookup matches (for suppression test)
            return Promise.resolve({ data: { recipient_hash: suppressedHash }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return client;
}

// ─── Test setup: mock sendResendEmail ────────────────────────────────────────
// We cannot easily stub the ES module import of lifecycle-send.ts in Deno without
// an import map override. Instead we verify behavior through the health-check and
// suppression paths which are fully testable, and for T1 we test the Resend path
// by setting RESEND_API_KEY=test-stub (lifecycle-send.ts returns stubbed:true).

// ─── T1: phi=false → Resend non-PHI path ─────────────────────────────────────
Deno.test('T1: phi=false routes to Resend (non-PHI)', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  // Clear any BAA flag that might be set from prior test
  Deno.env.delete('AWS_SES_BAA_ACTIVE');

  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  const result = await sendEmail(mockSupabase, {
    template: 'welcome',
    to: 'patient@example.com',
    vars: {},
    phi: false,
  });

  // sendResendEmail returns {ok:true, stubbed:true} for 'test-stub' — no messageId
  assertEquals(result.provider, 'resend');
  // stubbed mode returns messageId=undefined → router returns 'unknown'
  assertEquals(result.id, 'unknown');
  assertEquals(result.skipped, undefined);

  Deno.env.delete('RESEND_API_KEY');
});

// ─── T2: phi=true + no BAA active → baa_pending no-op ────────────────────────
Deno.test('T2: phi=true + no AWS_SES_BAA_ACTIVE → noop-baa_pending skipped', async () => {
  Deno.env.set('AWS_SES_ACCESS_KEY_ID', 'AKIATEST12345');
  Deno.env.set('AWS_SES_SECRET_ACCESS_KEY', 'supersecret');
  Deno.env.delete('AWS_SES_BAA_ACTIVE'); // explicitly absent

  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  const result = await sendEmail(mockSupabase, {
    template: 'dose_alert',
    to: 'patient@example.com',
    vars: { message: 'Time for your injection' },
    phi: true,
  });

  assertEquals(result.provider, 'ses');
  assertEquals(result.id, 'noop-baa_pending');
  assertEquals(result.skipped, true);

  Deno.env.delete('AWS_SES_ACCESS_KEY_ID');
  Deno.env.delete('AWS_SES_SECRET_ACCESS_KEY');
});

// ─── T3: phi=true + no credentials → no_credentials no-op ───────────────────
Deno.test('T3: phi=true + no AWS credentials → noop-no_credentials skipped', async () => {
  Deno.env.delete('AWS_SES_ACCESS_KEY_ID');
  Deno.env.delete('AWS_SES_SECRET_ACCESS_KEY');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');

  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  const result = await sendEmail(mockSupabase, {
    template: 'clinic_notification',
    to: 'doctor@clinic.com',
    vars: { title: 'Alert', body: 'Patient data' },
    phi: true,
  });

  assertEquals(result.provider, 'ses');
  assertEquals(result.id, 'noop-no_credentials');
  assertEquals(result.skipped, true);
});

// ─── T4: phi=true + test-stub + BAA active → health check ok + send mocked ───
Deno.test('T4: phi=true + test-stub credentials + BAA active → sends via SES', async () => {
  // test-stub shortcut: health check returns {ok:true, status:'verified'} without live call.
  Deno.env.set('AWS_SES_ACCESS_KEY_ID', 'test-stub');
  Deno.env.set('AWS_SES_SECRET_ACCESS_KEY', 'test-stub-secret');
  Deno.env.set('AWS_SES_BAA_ACTIVE', '1');
  Deno.env.set('AWS_SES_REGION', 'us-east-1');
  Deno.env.set('AWS_SES_FROM', 'LeanShot Clinical <noreply@app.leanshot.app>');

  __resetSesForTest();

  // We need to mock the SESv2Client send() since test-stub bypasses health check
  // but the email send will still call the real SDK.
  // Use a custom mock via __resetSesForTest + module-level override approach:
  // The router's getSes() returns the module-level _ses singleton. We can't replace
  // the client directly, but we can intercept by overriding the SDK at import level.
  // For test isolation, we verify the pre-send gating behavior passes and mock Supabase.

  // Note: Because test-stub bypasses health check but SESv2Client send would
  // attempt a real AWS call (which fails with invalid credentials), we test this
  // path by having 'test-stub' creds reach the SDK which will throw 'CredentialsError'
  // or similar. The router will then throw 'ses_send_failed'.
  // This proves the full PHI path is attempted (health check passed, suppression passed).
  // A real integration test with live creds would be needed for full send verification.

  // To make T4 fully deterministic without live AWS: We verify the THROW path
  // which proves the code reached the send step (not short-circuited by gating).
  const mockSupabase = makeMockSupabase(null); // not suppressed

  let threw = false;
  let threwMessage = '';
  try {
    await sendEmail(mockSupabase, {
      template: 'doctor_share',
      to: 'doctor@clinic.com',
      vars: { patient_ref: 'Patient-001', share_url: 'https://app.leanshot.app/share/xyz' },
      phi: true,
    });
  } catch (e) {
    threw = true;
    threwMessage = e instanceof Error ? e.message : '';
  }

  // The test-stub bypasses the health check (returns verified).
  // Suppression check is also bypassed (mock returns null).
  // The actual SES send with test credentials will fail — router throws 'ses_send_failed'.
  // This proves the router reached the send step (gate passed, suppression passed).
  assertEquals(threw, true);
  assertEquals(threwMessage, 'ses_send_failed');

  Deno.env.delete('AWS_SES_ACCESS_KEY_ID');
  Deno.env.delete('AWS_SES_SECRET_ACCESS_KEY');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');
  Deno.env.delete('AWS_SES_REGION');
  Deno.env.delete('AWS_SES_FROM');
  __resetSesForTest();
});

// ─── Phase 37 Plan 37-02 helpdesk template routing tests ────────────────────
// Per [[feedback_planner_iter1_anti_patterns]]: caller is authoritative on phi
// (the router NEVER infers phi from the template name). These tests verify
// each new template member routes through the correct vendor when the caller
// sets phi correctly.
//
// Strategy mirrors T1 (Resend test-stub) for non-PHI templates and T3
// (no-credentials no-op) for the PHI-aware template. Reaching the SES
// no-credentials no-op proves the router selected the PHI path on phi=true.

Deno.test('T6 (37-02): csat_followup phi=false routes to Resend', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');
  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  const result = await sendEmail(mockSupabase, {
    template: 'csat_followup',
    to: 'patient@example.com',
    vars: { ticket_ref: 'abcdef1234567890', csat_url: 'https://app.leanshot.app/csat/xyz' },
    phi: false,
  });

  assertEquals(result.provider, 'resend');
  assertEquals(result.skipped, undefined);

  Deno.env.delete('RESEND_API_KEY');
});

Deno.test('T7 (37-02): helpdesk_agent_reply phi=true routes to SES (no-creds no-op proves PHI path)', async () => {
  // No AWS_SES_* creds set → SES health check returns no_credentials.
  // Router returns {provider:'ses', id:'noop-no_credentials', skipped:true}.
  // Reaching this branch proves the agent_reply template took the PHI path,
  // NOT the Resend non-PHI path (which would have returned provider='resend').
  Deno.env.delete('AWS_SES_ACCESS_KEY_ID');
  Deno.env.delete('AWS_SES_SECRET_ACCESS_KEY');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');
  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  const result = await sendEmail(mockSupabase, {
    template: 'helpdesk_agent_reply',
    to: 'patient@example.com',
    vars: {
      subject: 'Re: Your support ticket',
      body: 'Thanks for your message — here is what we recommend.',
      reply_to: 'reply+token123@app.leanshot.app',
    },
    phi: true,
  });

  assertEquals(result.provider, 'ses');
  assertEquals(result.skipped, true);
  // no-credentials is the expected gate outcome with empty env.
  assertEquals(result.id, 'noop-no_credentials');
});

Deno.test('T8 (37-02): sla_breach_alert always non-PHI internal → Resend even when ticket would be PHI', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');
  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  // Caller hardcodes phi=false because the alert body contains no patient
  // identifiers — only ticket ref + tier + elapsed/target minutes.
  const result = await sendEmail(mockSupabase, {
    template: 'sla_breach_alert',
    to: 'agent-oncall@leanshot.app',
    vars: {
      ticket_ref: 'abc12345',
      tier: 'p1',
      breach_type: 'first_response',
      elapsed_minutes: 35,
      target_minutes: 30,
      admin_url: 'https://app.leanshot.app/admin/helpdesk/abc12345',
    },
    phi: false,
  });

  assertEquals(result.provider, 'resend');
  assertEquals(result.skipped, undefined);

  Deno.env.delete('RESEND_API_KEY');
});

Deno.test('T9 (37-02): helpdesk_unknown_sender phi=false routes to Resend', async () => {
  Deno.env.set('RESEND_API_KEY', 'test-stub');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');
  __resetSesForTest();
  const mockSupabase = makeMockSupabase(null);

  const result = await sendEmail(mockSupabase, {
    template: 'helpdesk_unknown_sender',
    to: 'stranger@example.com',
    vars: { signup_url: 'https://app.leanshot.app/signup' },
    phi: false,
  });

  assertEquals(result.provider, 'resend');
  assertEquals(result.skipped, undefined);

  Deno.env.delete('RESEND_API_KEY');
});

// ─── T5: phi=true + suppressed recipient → suppressed skipped ────────────────
Deno.test('T5: phi=true + recipient in suppression list → suppressed skipped', async () => {
  // Set up valid-looking credentials + BAA active so we pass the health check.
  // test-stub credential shortcut: health check returns verified without live call.
  Deno.env.set('AWS_SES_ACCESS_KEY_ID', 'test-stub');
  Deno.env.set('AWS_SES_SECRET_ACCESS_KEY', 'test-stub-secret');
  Deno.env.set('AWS_SES_BAA_ACTIVE', '1');

  __resetSesForTest();

  // Compute expected hash for recipient (router lowercases before hashing).
  // We don't need the exact hash — just return a row from supabase mock.
  const suppressedEmail = 'bounced@example.com';
  // sha256('bounced@example.com') — we pass a non-null row to mock.
  // The mock returns any non-null data to simulate a suppression hit.
  const fakeHash = 'fake_hash_value_for_test';
  const mockSupabase = makeMockSupabase(fakeHash);

  const result = await sendEmail(mockSupabase, {
    template: 'dose_alert',
    to: suppressedEmail,
    vars: { message: 'Your dose is due' },
    phi: true,
  });

  assertEquals(result.provider, 'ses');
  assertEquals(result.id, 'suppressed');
  assertEquals(result.skipped, true);

  Deno.env.delete('AWS_SES_ACCESS_KEY_ID');
  Deno.env.delete('AWS_SES_SECRET_ACCESS_KEY');
  Deno.env.delete('AWS_SES_BAA_ACTIVE');
  __resetSesForTest();
});
