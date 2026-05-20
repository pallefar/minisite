/**
 * Phase 34 Plan 34-03 — record-activation Edge Function (STUB for RED gate).
 * Real implementation lands in the GREEN commit.
 */
// deno-lint-ignore no-unused-vars
async function handleRecordActivation(_req: Request): Promise<Response> {
  return new Response(JSON.stringify({ stub: true }), { status: 500 });
}
function setAdminForTest(_c: unknown): void {}
function resetAdminForTest(): void {}
function setCaptureSpyForTest(_fn: (a: unknown) => void): void {}
function setShutdownSpyForTest(_fn: () => void): void {}

export const __internal = {
  handleRecordActivation,
  setAdminForTest,
  resetAdminForTest,
  setCaptureSpyForTest,
  setShutdownSpyForTest,
};
