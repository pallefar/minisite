/**
 * Anthropic API client wrapper.
 *
 * v1 called the API from the browser without any auth header — it would
 * 401 in production. We add `x-api-key` (sourced from a per-user setting)
 * and `anthropic-dangerous-direct-browser-access: true` (CORS unblock).
 *
 * If no key is present we throw a typed error so the UI can render an
 * "add your key" prompt instead of swallowing the failure.
 */
import { apiKeyStorage } from './storage';

export class MissingAPIKeyError extends Error {
  constructor() {
    super('Anthropic API key not configured');
    this.name = 'MissingAPIKeyError';
  }
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
/** Latest Sonnet at the time of build. */
export const DEFAULT_MODEL = 'claude-sonnet-4-5';

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicResponse {
  content: { type: string; text: string }[];
}

interface CallOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  messages: AnthropicMessageParam[];
}

export async function callAnthropic(opts: CallOptions): Promise<string> {
  const key = apiKeyStorage.get();
  if (!key) throw new MissingAPIKeyError();

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 1000,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Anthropic ${r.status}: ${text || r.statusText}`);
  }
  const data = (await r.json()) as AnthropicResponse;
  return (data.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}
