/**
 * Phase 37 Plan 37-05 Task 2 — RED skeleton.
 * Returns 500 on every request so tests fail meaningfully.
 * Real implementation follows in the GREEN commit.
 */
import { corsHeaders } from './cors.ts';

export interface HandlerOptions { /* matches GREEN signature */ }

export async function handler(_req: Request, _opts: HandlerOptions = {}): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_implemented' }), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export const __internal = {
  setAdminForTest(_client: unknown): void {},
  resetAdminForTest(): void {},
  setSendEmailForTest(_fn: unknown): void {},
  resetSendEmailForTest(): void {},
};
