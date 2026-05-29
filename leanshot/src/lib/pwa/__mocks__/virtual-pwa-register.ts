// Test-only stub for vite-plugin-pwa's virtual:pwa-register module.
// register.test.ts overrides registerSW via vi.mock; this file exists so the
// import resolves under vitest (where the VitePWA plugin isn't loaded).
export function registerSW(_opts?: unknown): () => Promise<void> {
  return async () => undefined;
}
