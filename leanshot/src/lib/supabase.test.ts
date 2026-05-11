/**
 * Unit tests for the browser-side Supabase client singleton.
 *
 * Test surface (Plan 04-02 Task 1 <behavior>):
 *   1. `supabase` is the result of `createClient(...)` (auth client present).
 *   2. Missing env vars → console.error with `[leanshot]` prefix; module
 *      still exports a non-throwing client (fail-soft per CLAUDE.md
 *      "AI outage = degraded coach UX, not full-app outage").
 *   3. `supabase.auth.signInAnonymously` is a callable function — proves
 *      the SDK shape used by AIChatPanel (D-02) is wired through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('supabase singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('exports a client with a non-null auth surface', async () => {
    const { supabase } = await import('./supabase');
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
  });

  it('logs [leanshot]-prefixed error when env vars are missing, but still exports a non-throwing client', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = await import('./supabase');
    expect(errSpy).toHaveBeenCalled();
    const firstCallArg = String(errSpy.mock.calls[0]?.[0] ?? '');
    expect(firstCallArg).toContain('[leanshot]');
    expect(firstCallArg).toMatch(/VITE_SUPABASE_URL/);
    // Client is exported and accessing `.auth` does not throw.
    expect(() => supabase.auth).not.toThrow();
  });

  it('exposes `auth.signInAnonymously` as a callable (D-02 anonymous-auth wire)', async () => {
    const { supabase } = await import('./supabase');
    expect(typeof supabase.auth.signInAnonymously).toBe('function');
  });
});
