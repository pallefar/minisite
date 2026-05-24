// RED stub — implementation lands in next commit.
async function handleDigest(_req: Request): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_implemented' }), { status: 500 });
}

export const __internal = {
  handleDigest,
  setAdminForTest: (_c: unknown): void => {},
  resetAdminForTest: (): void => {},
  setSendEmailForTest: (_fn: unknown): void => {},
  resetSendEmailForTest: (): void => {},
};
