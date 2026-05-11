/**
 * Tests for `callAIChat` — Phase 4 Plan 04-02 Task 2 <behavior>.
 *
 * Covered behaviors:
 *   1. fetch is called with POST to /functions/v1/ai-chat with Bearer
 *      auth, apikey, Accept: text/event-stream, body containing the
 *      messages + mode.
 *   2. 429 → RateLimitedError.
 *   3. 502 / non-2xx → AIUnavailableError('upstream').
 *   4. No active session → signInAnonymously is called before fetch.
 *   5. SSE frames in Moonshot/OpenAI shape are parsed into onText
 *      callbacks (`choices[0].delta.content`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase singleton BEFORE importing `ai.ts` so it picks up
// the mock surface.
vi.mock('@/lib/supabase', () => {
  const auth = {
    getSession: vi.fn(),
    signInAnonymously: vi.fn(),
  };
  return { supabase: { auth } };
});

import { supabase } from '@/lib/supabase';
import { AIUnavailableError, RateLimitedError, callAIChat } from './ai';

function sseResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('callAIChat', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-xyz',
          // Other fields the type wants — cast through unknown.
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(supabase.auth.signInAnonymously).mockResolvedValue({
      data: {
        session: { access_token: 'anon-jwt' },
        user: null,
      },
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('Test 1: calls fetch with POST + Bearer + apikey + Accept: text/event-stream', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchSpy);

    await callAIChat({
      messages: [{ role: 'user', content: 'hi' }],
      mode: 'coach',
      onText: () => {},
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/ai-chat$/);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-xyz');
    expect(headers['apikey']).toBe('anon-test-key');
    expect(headers['Accept']).toBe('text/event-stream');
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.mode).toBe('coach');
  });

  it('Test 2: throws RateLimitedError on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"rate-limited"}', { status: 429 })),
    );
    await expect(
      callAIChat({ messages: [{ role: 'user', content: 'hi' }], onText: () => {} }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('Test 3: throws AIUnavailableError(kind: upstream) on 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"moonshot-5xx"}', { status: 502 })),
    );
    await expect(
      callAIChat({ messages: [{ role: 'user', content: 'hi' }], onText: () => {} }),
    ).rejects.toMatchObject({ name: 'AIUnavailableError', kind: 'upstream' });
  });

  it('Test 4: calls signInAnonymously before fetch when no session exists', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const callOrder: string[] = [];
    vi.mocked(supabase.auth.signInAnonymously).mockImplementation(async () => {
      callOrder.push('signInAnonymously');
      return {
        data: { session: { access_token: 'anon-jwt' }, user: null },
        error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });
    const fetchSpy = vi.fn().mockImplementation(async () => {
      callOrder.push('fetch');
      return sseResponse(['data: [DONE]\n\n']);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await callAIChat({
      messages: [{ role: 'user', content: 'hi' }],
      onText: () => {},
    });
    expect(callOrder).toEqual(['signInAnonymously', 'fetch']);
    // The fetch uses the anonymous JWT.
    const init = fetchSpy.mock.calls[0][1];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer anon-jwt');
  });

  it('Test 5: parses Moonshot SSE frames into onText callbacks', async () => {
    const frames = [
      'data: ' +
        JSON.stringify({
          choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }],
        }) +
        '\n\n',
      'data: ' +
        JSON.stringify({
          choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }],
        }) +
        '\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(frames)));
    const deltas: string[] = [];
    await callAIChat({
      messages: [{ role: 'user', content: 'hi' }],
      onText: (d) => deltas.push(d),
    });
    expect(deltas.join('')).toBe('Hello');
  });

  it('Test 5b: a single-frame canned stream calls onText once with the content', async () => {
    const frame =
      'data: ' +
      JSON.stringify({
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
      }) +
      '\n\ndata: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([frame])));
    const deltas: string[] = [];
    await callAIChat({
      messages: [{ role: 'user', content: 'hi' }],
      onText: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(['hi']);
  });
});
