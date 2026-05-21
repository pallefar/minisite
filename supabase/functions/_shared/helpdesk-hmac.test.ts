/**
 * Phase 37 Plan 37-02 Task 4 — RED test file for helpdesk-hmac.ts.
 *
 * Reply-token contract (CONTEXT D-19):
 *   token = base64url(HMAC-SHA256(secret, `${ticket_id}:${user_id}`))
 *   Reply-To: reply+<token>@app.leanshot.app
 *
 * The verify path MUST be constant-time so a tampered token can't be
 * brute-forced via response-timing oracles (T-37-02-01).
 *
 * Per [[reference_deno_test_discovery]]: file named `<name>.test.ts`.
 */
import { assertEquals, assertFalse } from 'jsr:@std/assert@^1';
import { generateReplyToken, verifyReplyToken } from './helpdesk-hmac.ts';

const SECRET = 'a'.repeat(64); // 32-byte hex string
const TICKET = '11111111-1111-1111-1111-111111111111';
const USER   = '22222222-2222-2222-2222-222222222222';

Deno.test('generateReplyToken is deterministic for same inputs', async () => {
  const a = await generateReplyToken(SECRET, TICKET, USER);
  const b = await generateReplyToken(SECRET, TICKET, USER);
  assertEquals(a, b);
});

Deno.test('generateReplyToken is base64url (no +, /, =)', async () => {
  const t = await generateReplyToken(SECRET, TICKET, USER);
  assertFalse(t.includes('+') || t.includes('/') || t.includes('='), `unexpected base64 char in: ${t}`);
});

Deno.test('verifyReplyToken accepts a freshly-generated token', async () => {
  const t = await generateReplyToken(SECRET, TICKET, USER);
  assertEquals(await verifyReplyToken(t, SECRET, TICKET, USER), true);
});

Deno.test('verifyReplyToken rejects single-byte tamper', async () => {
  const t = await generateReplyToken(SECRET, TICKET, USER);
  // Flip the first character to a different alphabetic character so the
  // resulting string is still well-formed base64url but cryptographically wrong.
  const tampered = (t[0] === 'A' ? 'B' : 'A') + t.slice(1);
  assertEquals(await verifyReplyToken(tampered, SECRET, TICKET, USER), false);
});

Deno.test('verifyReplyToken rejects wrong ticket id', async () => {
  const t = await generateReplyToken(SECRET, TICKET, USER);
  const wrongTicket = '11111111-1111-1111-1111-111111111112';
  assertEquals(await verifyReplyToken(t, SECRET, wrongTicket, USER), false);
});

Deno.test('verifyReplyToken rejects wrong user id', async () => {
  const t = await generateReplyToken(SECRET, TICKET, USER);
  const wrongUser = '22222222-2222-2222-2222-222222222223';
  assertEquals(await verifyReplyToken(t, SECRET, TICKET, wrongUser), false);
});

Deno.test('verifyReplyToken returns false on garbage input (no throw)', async () => {
  assertEquals(await verifyReplyToken('not-a-real-token', SECRET, TICKET, USER), false);
  assertEquals(await verifyReplyToken('', SECRET, TICKET, USER), false);
});
