/**
 * `embed-content-nightly` Edge Function — Phase 38 Plan 38-04 (SKELETON / RED).
 *
 * This is the failing skeleton committed at the RED gate of TDD. The GREEN
 * commit replaces the stubs with the real algorithm.
 */

import { makeLazyAdmin } from '../_shared/lifecycle-utils.ts';

const { admin: _admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleRun(
  _req: Request,
  _opts: { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  // RED stub — returns 501 so every behavioral assertion fails.
  return new Response(JSON.stringify({ error: 'not implemented' }), { status: 501 });
}

Deno.serve((req) => handleRun(req));

export const __internal = {
  handleRun,
  setAdminForTest,
  resetAdminForTest,
};
