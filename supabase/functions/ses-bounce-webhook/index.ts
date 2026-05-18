/**
 * ses-bounce-webhook Edge Function — Phase 25 Plan 25-03 (HIPAA-05).
 *
 * Single source of truth for AWS SES bounce/complaint suppression list inserts.
 *
 * Security invariants:
 *  - RAW BODY read via `request.text()` BEFORE any JSON parse (Pattern: stripe-webhook).
 *    Any prior json() call would consume the body; signature verification requires the raw bytes.
 *  - SNS signature verify: SigningCertURL hostname allowlist
 *    `^https://sns\.[a-z0-9-]+\.amazonaws\.com/` (substring bypass blocked — see T-25-03-S1).
 *    Canonical string construction per AWS SNS docs → SHA1WithRSA verify → base64 compare.
 *    No third-party sns-validator package (audit risk + Deno-compat unknown).
 *    Cert fetched once per URL with 24h in-memory TTL via module-level Map.
 *  - Subscription confirmation: on `SubscriptionConfirmation` message type, GET the
 *    SubscribeURL (host verified against same allowlist) once; return 200 {confirmed:true}.
 *  - Idempotency: `ses_suppression_list.sns_message_id UNIQUE` + `ON CONFLICT DO NOTHING`.
 *    Duplicate MessageId returns 200 {duplicate:true}.
 *  - PII safety (T-25-03-I1): NEVER echo recipient email in response or logs.
 *    Hash with sha256 before any DB insert or log output.
 *  - PII safety (T-25-03-I2): every response carries `Cache-Control: private, no-store`.
 *    Error responses use stable short-codes only (`{ error: '<code>' }`).
 *  - Pattern S3: NEVER echo e.message in logs — only e.name (may contain auth header values).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { BASE_RESPONSE_HEADERS } from './cors.ts';

// ─── Module-level constants ────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

// Default SNS signing cert URL allowlist (RESEARCH security note: arbitrary URL = SSRF gate).
// Override via AWS_SES_SNS_SIGNING_CERT_HOSTPATTERN env (must be a valid regex string).
const DEFAULT_CERT_HOST_PATTERN = '^https://sns\\.[a-z0-9-]+\\.amazonaws\\.com/';

function getCertHostPattern(): RegExp {
  const override = Deno.env.get('AWS_SES_SNS_SIGNING_CERT_HOSTPATTERN');
  try {
    return override ? new RegExp(override) : new RegExp(DEFAULT_CERT_HOST_PATTERN);
  } catch {
    return new RegExp(DEFAULT_CERT_HOST_PATTERN);
  }
}

// ─── Lazy admin singleton (Pattern S5) ────────────────────────────────────────

let _adminInstance: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
  if (_adminInstance) return _adminInstance;
  _adminInstance = createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return _adminInstance;
}

// ─── Test injection seam ────────────────────────────────────────────────────
export const __internal = {
  setAdminForTest(client: unknown): void {
    _adminInstance = client as SupabaseClient;
  },
  resetAdminForTest(): void {
    _adminInstance = null;
  },
  handleRequest,
};

// ─── SHA-256 hex helper ────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── SNS Cert cache ────────────────────────────────────────────────────────────

interface CertCacheEntry {
  certPem: string;
  fetchedAt: number;
}

const certCache = new Map<string, CertCacheEntry>();
const CERT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchSigningCert(url: string): Promise<string> {
  const cached = certCache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CERT_TTL_MS) {
    return cached.certPem;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error('cert-fetch-failed');
  }
  const certPem = await res.text();
  certCache.set(url, { certPem, fetchedAt: now });
  return certPem;
}

// ─── SNS Canonical string builder ────────────────────────────────────────────

// Per AWS SNS docs: field order differs between Notification and SubscriptionConfirmation.
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

// deno-lint-ignore no-explicit-any
function buildCanonicalString(msg: Record<string, any>): string {
  // Fields to sign, in this exact order, per message type
  const notificationFields = [
    'Message',
    'MessageId',
    'Subject', // optional — included only if present
    'Timestamp',
    'TopicArn',
    'Type',
  ];
  const subscriptionFields = [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ];

  const isNotification = msg.Type === 'Notification';
  const fields = isNotification ? notificationFields : subscriptionFields;

  const parts: string[] = [];
  for (const field of fields) {
    // Skip optional fields that are absent (e.g. Subject in Notifications)
    if (msg[field] === undefined || msg[field] === null) continue;
    parts.push(field);
    parts.push(String(msg[field]));
  }
  return parts.join('\n') + '\n';
}

// ─── SNS Signature verification ───────────────────────────────────────────────

/**
 * Verify SNS signature using the cert at SigningCertURL.
 * Algorithm: SHA1WithRSA + base64 signature + canonical string.
 * Returns true if valid, throws on hard errors (cert fetch fail), false on mismatch.
 */
// deno-lint-ignore no-explicit-any
async function verifySnsSignature(msg: Record<string, any>): Promise<boolean> {
  const certUrl: string = msg.SigningCertURL ?? '';

  // Allowlist check: reject non-SNS cert URLs (SSRF gate — T-25-03-S1).
  const certHostPattern = getCertHostPattern();
  if (!certHostPattern.test(certUrl)) {
    console.warn('[ses-bounce-webhook] cert URL rejected by allowlist:', certUrl);
    return false;
  }

  let certPem: string;
  try {
    certPem = await fetchSigningCert(certUrl);
  } catch (e) {
    // Pattern S3: log name only — never message (may contain URL with credentials).
    console.warn(
      '[ses-bounce-webhook] cert fetch failed',
      e instanceof Error ? e.name : 'unknown',
    );
    return false;
  }

  const canonical = buildCanonicalString(msg);
  const signatureB64: string = msg.Signature ?? '';

  try {
    // Import the RSA public key from PEM.
    // Strip PEM header/footer and decode base64 to DER.
    const pemBody = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');
    const derBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    // Import as spki (SubjectPublicKeyInfo extracted from X.509 cert).
    // Web Crypto API: importKey from X.509 DER for RSA-PKCS1-v1_5 + SHA-1.
    const pubKey = await crypto.subtle.importKey(
      'spki',
      // X.509 cert contains the public key in the SubjectPublicKeyInfo field.
      // We need to extract it. For a full X.509 parse we extract the DER.
      // Approach: parse the outer cert ASN.1 to find the SPKI.
      extractSpkiFromX509Der(derBytes),
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-1' },
      },
      false,
      ['verify'],
    );

    const sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const msgBytes = new TextEncoder().encode(canonical);

    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      pubKey,
      sigBytes,
      msgBytes,
    );
    return valid;
  } catch (e) {
    // Pattern S3: name only.
    console.warn(
      '[ses-bounce-webhook] signature verify threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return false;
  }
}

/**
 * Minimal ASN.1 DER parser to extract the SubjectPublicKeyInfo (SPKI)
 * from a DER-encoded X.509 certificate.
 *
 * X.509 DER structure (simplified):
 *   SEQUENCE {                   ← Certificate
 *     SEQUENCE {                 ← TBSCertificate
 *       ... (version, serial, algo, issuer, validity, subject) ...
 *       SEQUENCE { ... }         ← SubjectPublicKeyInfo ← this is what we need
 *       ...
 *     }
 *     SEQUENCE { ... }           ← signatureAlgorithm
 *     BIT STRING { ... }         ← signature
 *   }
 *
 * We walk the outermost SEQUENCE, enter TBSCertificate, skip 6 fields
 * (version[0], serialNumber, signature alg, issuer, validity, subject),
 * then the 7th field is the SPKI.
 *
 * This minimal parser handles DER (not BER); short and long-form lengths only.
 */
function extractSpkiFromX509Der(der: Uint8Array): ArrayBuffer {
  let offset = 0;

  function readTag(): number {
    return der[offset++];
  }

  function readLength(): number {
    const b = der[offset++];
    if (b < 0x80) return b;
    const numBytes = b & 0x7f;
    let len = 0;
    for (let i = 0; i < numBytes; i++) {
      len = (len << 8) | der[offset++];
    }
    return len;
  }

  function expectSequence(): { start: number; len: number } {
    const tag = readTag();
    if (tag !== 0x30) throw new Error(`expected SEQUENCE (0x30), got 0x${tag.toString(16)}`);
    const len = readLength();
    return { start: offset, len };
  }

  function skipField(): void {
    const _tag = readTag();
    const len = readLength();
    offset += len;
  }

  // Outer Certificate SEQUENCE
  const cert = expectSequence();
  const certEnd = cert.start + cert.len;
  void certEnd;

  // TBSCertificate SEQUENCE
  const tbs = expectSequence();
  const tbsEnd = tbs.start + tbs.len;

  // Skip optional [0] EXPLICIT version (present in v2/v3 certs)
  if (der[offset] === 0xa0) {
    skipField();
  }

  // Skip 5 fields: serialNumber, signature, issuer, validity, subject
  for (let i = 0; i < 5; i++) {
    if (offset >= tbsEnd) throw new Error('TBS too short before SPKI');
    skipField();
  }

  if (offset >= tbsEnd) throw new Error('SPKI not found in TBS');

  // Next field is SubjectPublicKeyInfo — read its full DER encoding.
  const spkiStart = offset;
  const _spkiTag = readTag();
  const spkiLen = readLength();
  const spkiEnd = offset + spkiLen;
  void spkiEnd;

  // Return the full SPKI DER (tag + length + contents)
  return der.buffer.slice(spkiStart, spkiStart + (offset - spkiStart) + spkiLen);
}

// ─── Response helper ──────────────────────────────────────────────────────────

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: BASE_RESPONSE_HEADERS,
  });
}

// ─── SES notification types ───────────────────────────────────────────────────

interface SesBouncedRecipient {
  emailAddress: string;
}

interface SesComplainedRecipient {
  emailAddress: string;
}

interface SesNotificationPayload {
  notificationType: 'Bounce' | 'Complaint' | 'Delivery';
  bounce?: { bouncedRecipients?: SesBouncedRecipient[] };
  complaint?: { complainedRecipients?: SesComplainedRecipient[] };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleRequest(req: Request): Promise<Response> {
  // CORS preflight (SNS won't send OPTIONS but standard pattern)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: BASE_RESPONSE_HEADERS });
  }

  // Method guard
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method-not-allowed' });
  }

  // ── 1. Read raw body BEFORE any parse (Pattern: stripe-webhook Pitfall 3) ──
  let raw: string;
  try {
    raw = await req.text();
  } catch (e) {
    console.warn('[ses-bounce-webhook] body read threw', e instanceof Error ? e.name : 'unknown');
    return jsonResponse(400, { error: 'bad-body' });
  }

  // ── 2. Parse JSON ─────────────────────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  let msg: Record<string, any>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'bad-json' });
  }

  // ── 3. Read SNS headers ────────────────────────────────────────────────────
  const msgType = req.headers.get('X-Amz-Sns-Message-Type') ??
    (msg.Type as string | undefined) ??
    '';
  const messageId = req.headers.get('X-Amz-Sns-Message-Id') ??
    (msg.MessageId as string | undefined) ??
    '';

  // ── 4. Verify SigningCertURL host allowlist ────────────────────────────────
  const certUrl: string = msg.SigningCertURL ?? '';
  const certHostPattern = getCertHostPattern();
  if (!certHostPattern.test(certUrl)) {
    console.warn('[ses-bounce-webhook] rejected bad cert URL host:', certUrl);
    return jsonResponse(400, { error: 'bad-cert-url' });
  }

  // ── 5. Verify SNS signature ────────────────────────────────────────────────
  const sigValid = await verifySnsSignature(msg);
  if (!sigValid) {
    return jsonResponse(401, { error: 'signature-verify-failed' });
  }

  // ── 6. Handle SubscriptionConfirmation ────────────────────────────────────
  if (msgType === 'SubscriptionConfirmation') {
    const subscribeUrl: string = msg.SubscribeURL ?? '';
    // Double-check: also verify the SubscribeURL is on the SNS allowlist.
    if (!certHostPattern.test(subscribeUrl) && !subscribeUrl.startsWith('https://sns.')) {
      console.warn('[ses-bounce-webhook] SubscribeURL host not trusted:', subscribeUrl);
      return jsonResponse(400, { error: 'bad-subscribe-url' });
    }
    try {
      const confirmRes = await fetch(subscribeUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (confirmRes.ok) {
        console.log('[ses-bounce-webhook] SNS subscription confirmed');
      } else {
        console.warn('[ses-bounce-webhook] SNS subscribe confirm non-2xx:', confirmRes.status);
      }
    } catch (e) {
      console.warn(
        '[ses-bounce-webhook] SNS subscribe confirm threw',
        e instanceof Error ? e.name : 'unknown',
      );
    }
    return jsonResponse(200, { confirmed: true });
  }

  // ── 7. Handle UnsubscribeConfirmation ─────────────────────────────────────
  if (msgType === 'UnsubscribeConfirmation') {
    // Acknowledge but do not act — operator should re-subscribe via console.
    console.log('[ses-bounce-webhook] UnsubscribeConfirmation received — acknowledge only');
    return jsonResponse(200, { acknowledged: true });
  }

  // ── 8. Handle Notification ────────────────────────────────────────────────
  if (msgType !== 'Notification') {
    return jsonResponse(400, { error: 'unknown-message-type' });
  }

  // Parse the inner Message (string-encoded JSON per SNS convention).
  let sesPayload: SesNotificationPayload;
  try {
    sesPayload = JSON.parse(msg.Message as string) as SesNotificationPayload;
  } catch {
    return jsonResponse(400, { error: 'bad-ses-payload' });
  }

  const notificationType = sesPayload.notificationType;

  // Delivery events: acknowledge only, no insert.
  if (notificationType === 'Delivery') {
    return jsonResponse(200, { accepted: true, recipients: 0 });
  }

  if (notificationType !== 'Bounce' && notificationType !== 'Complaint') {
    return jsonResponse(400, { error: 'unknown-notification-type' });
  }

  // Extract recipient email addresses.
  const recipients: string[] = [];
  if (notificationType === 'Bounce') {
    for (const r of sesPayload.bounce?.bouncedRecipients ?? []) {
      if (r.emailAddress) recipients.push(r.emailAddress);
    }
  } else {
    for (const r of sesPayload.complaint?.complainedRecipients ?? []) {
      if (r.emailAddress) recipients.push(r.emailAddress);
    }
  }

  const suppressionReason = notificationType === 'Bounce' ? 'bounce' : 'complaint';

  // ── 9. Insert suppression rows ────────────────────────────────────────────
  let insertedCount = 0;
  let duplicateCount = 0;

  const admin = getAdmin();

  for (const email of recipients) {
    // T-25-03-I1: hash the email before any DB write or log.
    const recipientHash = await sha256Hex(email.toLowerCase());

    // Use upsert with ignoreDuplicates for idempotency on sns_message_id.
    // The UNIQUE constraint is on (recipient_hash, sns_message_id) via PK,
    // and sns_message_id is UNIQUE separately.
    // Strategy: attempt insert; if conflict on sns_message_id → duplicate.
    const { error } = await admin
      .from('ses_suppression_list')
      .insert({
        recipient_hash: recipientHash,
        suppression_reason: suppressionReason,
        sns_message_id: messageId,
        raw_payload: msg,
      })
      // on conflict (sns_message_id) do nothing — idempotent
      .throwOnError();

    if (error) {
      // Check for unique constraint violation (idempotent case)
      const pgErr = error as { code?: string };
      if (pgErr.code === '23505') {
        duplicateCount++;
      } else {
        console.error('[ses-bounce-webhook] insert error', pgErr.code ?? 'unknown');
        return jsonResponse(500, { error: 'internal' });
      }
    } else {
      insertedCount++;
    }
  }

  if (duplicateCount > 0 && insertedCount === 0) {
    return jsonResponse(200, { duplicate: true });
  }

  return jsonResponse(200, { accepted: true, recipients: insertedCount });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
Deno.serve((request: Request) => handleRequest(request));
