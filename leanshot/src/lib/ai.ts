/**
 * Browser-side AI proxy wrapper.
 *
 * Phase 4 D-01 + D-02 + D-05: replaces the v1 in-browser Anthropic fetch
 * (with BYO API key) with a streaming call to our `ai-chat` Edge
 * Function (which fans out to Moonshot Kimi K2 server-side). The browser
 * never sees the Moonshot API key. Anonymous Supabase auth provisions
 * a JWT on first send (D-02); subsequent sends reuse the cached session.
 *
 * Contract change vs Phase 1:
 *   - Old `callAnthropic(opts): Promise<string>` returned the full reply.
 *   - New `callAIChat(opts): Promise<void>` yields deltas via `opts.onText`
 *     and resolves when the stream is complete. Callers wire the typing-
 *     effect UX through a per-delta store action (`updateLastAssistant`).
 *
 * SSE delta shape: OpenAI canonical (Moonshot is OpenAI-compatible per
 * RESEARCH §14 F4). Parser extracts `choices[0].delta.content` from each
 * `data: <json>\n\n` frame; `data: [DONE]\n\n` is the terminator.
 */
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { supabase } from '@/lib/supabase';

const PROXY_PATH = '/functions/v1/ai-chat';

export interface ProxyMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallAIChatOpts {
  messages: ProxyMessage[];
  mode?: 'coach' | 'macro-estimator';
  /**
   * Raw context string the browser builds (e.g. user weight + dose +
   * recent symptoms). The Edge Function wraps it in a `<user_data>`
   * fence on the first user message (AI-04 structural separation).
   * NEVER concatenate this into the conversation content client-side —
   * pass it through this field so the server-side fence is the single
   * trust boundary.
   */
  userContext?: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export class RateLimitedError extends Error {
  constructor() {
    super('AI rate limit exceeded');
    this.name = 'RateLimitedError';
  }
}

export class AIUnavailableError extends Error {
  constructor(
    public kind: 'signin' | 'upstream' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

async function ensureSession(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.access_token) {
    return sessionData.session.access_token;
  }
  // No session — provision an anonymous one (Phase 4 D-02).
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session?.access_token) {
    throw new AIUnavailableError('signin', error?.message ?? 'anonymous sign-in failed');
  }
  return data.session.access_token;
}

function resolveProxyUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL ?? '';
  return `${base.replace(/\/$/, '')}${PROXY_PATH}`;
}

function resolveAnonKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
}

export async function callAIChat(opts: CallAIChatOpts): Promise<void> {
  const { messages, mode = 'coach', userContext, onText, signal } = opts;

  // 1. Ensure anonymous (or real) session → JWT.
  let jwt: string;
  try {
    jwt = await ensureSession();
  } catch (e) {
    if (e instanceof AIUnavailableError) throw e;
    throw new AIUnavailableError('signin', e instanceof Error ? e.message : 'unknown');
  }

  // 2. POST to the proxy with Bearer JWT + apikey + Accept: text/event-stream.
  let resp: Response;
  try {
    resp = await fetch(resolveProxyUrl(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'apikey': resolveAnonKey(),
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ messages, mode, userContext }),
      signal,
    });
  } catch (e) {
    throw new AIUnavailableError('network', e instanceof Error ? e.message : 'fetch failed');
  }

  if (resp.status === 429) {
    throw new RateLimitedError();
  }
  if (!resp.ok) {
    throw new AIUnavailableError('upstream', `proxy ${resp.status}`);
  }
  if (!resp.body) {
    throw new AIUnavailableError('upstream', 'empty body');
  }

  // 3. Consume SSE frames. OpenAI delta shape per RESEARCH §14 F4.
  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      if (event.data === '[DONE]') return;
      try {
        const json = JSON.parse(event.data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const text = json.choices?.[0]?.delta?.content;
        if (text) onText(text);
      } catch {
        // Skip malformed frame — never crash the whole stream on one
        // bad chunk (defense in depth).
      }
    },
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}
