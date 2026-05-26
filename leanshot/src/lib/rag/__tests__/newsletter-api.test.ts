/**
 * Phase 60 Plan 60-12 Task 1 — newsletter-api.ts vitest tests.
 *
 * Tests:
 *  1. getNewsletterSubscription returns synthetic default (opted_in=false) when no row
 *  2. getNewsletterSubscription returns row when present
 *  3. setNewsletterOptIn(optedIn=true) UPSERTs with opted_in_at=now and opted_out_at=null
 *  4. setNewsletterOptIn(optedIn=false) UPSERTs with opted_out_at=now and PRESERVES topic_tags
 *  5. client wrapper never reads/writes unsubscribe_token field
 *  6. locale keys present per UI-SPEC §Copywriting Contract
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/newsletter-api.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

// ─── Import after mock setup ──────────────────────────────────────────────────

import {
  getNewsletterSubscription,
  setNewsletterOptIn,
  type NewsletterSubscription,
} from '../newsletter-api';

// ─── Helper: fluent builder for chained Supabase calls ───────────────────────

function buildChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
  // upsert returns a chain with select and single
  chain.upsert.mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(result),
    }),
  });
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('newsletter-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Returns synthetic default when no row exists
  it('getNewsletterSubscription returns synthetic default (opted_in=false) when no row', async () => {
    const chain = buildChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getNewsletterSubscription('user-123');

    expect(result.user_id).toBe('user-123');
    expect(result.opted_in).toBe(false);
    expect(result.topic_tags).toEqual([]);
    expect(result.email).toBe('');
    expect(result.last_sent_at).toBeNull();
    expect(result.opted_in_at).toBeNull();
    expect(result.opted_out_at).toBeNull();
  });

  // Test 2: Returns row when present
  it('getNewsletterSubscription returns row when present', async () => {
    const existing: NewsletterSubscription = {
      user_id: 'user-456',
      opted_in: true,
      topic_tags: ['glp-1', 'peptide-research'],
      email: 'user@example.com',
      last_sent_at: '2026-05-01T09:00:00Z',
      opted_in_at: '2026-04-01T10:00:00Z',
      opted_out_at: null,
    };
    const chain = buildChain({ data: existing, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getNewsletterSubscription('user-456');

    expect(result).toEqual(existing);
    expect(result.opted_in).toBe(true);
    expect(result.topic_tags).toEqual(['glp-1', 'peptide-research']);
  });

  // Test 3: setNewsletterOptIn(optedIn=true) UPSERTs with opted_in_at=now and opted_out_at=null
  it('setNewsletterOptIn(optedIn=true) sets opted_in_at and clears opted_out_at', async () => {
    const returnedRow: NewsletterSubscription = {
      user_id: 'user-789',
      opted_in: true,
      topic_tags: ['glp-1', 'peptide-research'],
      email: 'test@example.com',
      last_sent_at: null,
      opted_in_at: '2026-05-26T10:00:00Z',
      opted_out_at: null,
    };

    let capturedUpsertPayload: unknown = null;
    const selectChain = {
      single: vi.fn().mockResolvedValue({ data: returnedRow, error: null }),
    };
    const upsertChain = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    const fromChain = {
      upsert: vi.fn().mockImplementation((payload: unknown) => {
        capturedUpsertPayload = payload;
        return upsertChain;
      }),
    };
    mockFrom.mockReturnValue(fromChain);

    const result = await setNewsletterOptIn({
      userId: 'user-789',
      optedIn: true,
      topicTags: ['glp-1', 'peptide-research'],
    });

    expect(result.opted_in).toBe(true);
    expect(result.opted_out_at).toBeNull();
    expect(result.opted_in_at).toBeTruthy();

    // Assert shape of upsert payload
    const payload = capturedUpsertPayload as Record<string, unknown>;
    expect(payload.opted_in).toBe(true);
    expect(payload.opted_in_at).toBeTruthy();
    expect(payload.opted_out_at).toBeNull();
    expect(payload.topic_tags).toEqual(['glp-1', 'peptide-research']);
  });

  // Test 4: setNewsletterOptIn(optedIn=false) sets opted_out_at and DOES NOT include topic_tags
  it('setNewsletterOptIn(optedIn=false) sets opted_out_at and PRESERVES topic_tags (does not pass them)', async () => {
    const returnedRow: NewsletterSubscription = {
      user_id: 'user-789',
      opted_in: false,
      topic_tags: ['glp-1'], // preserved by server
      email: 'test@example.com',
      last_sent_at: null,
      opted_in_at: '2026-05-01T10:00:00Z',
      opted_out_at: '2026-05-26T10:00:00Z',
    };

    let capturedUpsertPayload: unknown = null;
    const selectChain = {
      single: vi.fn().mockResolvedValue({ data: returnedRow, error: null }),
    };
    const upsertChain = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    const fromChain = {
      upsert: vi.fn().mockImplementation((payload: unknown) => {
        capturedUpsertPayload = payload;
        return upsertChain;
      }),
    };
    mockFrom.mockReturnValue(fromChain);

    const result = await setNewsletterOptIn({
      userId: 'user-789',
      optedIn: false,
      // NO topicTags provided — should preserve existing
    });

    expect(result.opted_in).toBe(false);
    expect(result.opted_out_at).toBeTruthy();

    // Assert payload does NOT include topic_tags (server preserves existing)
    const payload = capturedUpsertPayload as Record<string, unknown>;
    expect(payload.opted_in).toBe(false);
    expect(payload.opted_out_at).toBeTruthy();
    expect('topic_tags' in payload).toBe(false);
  });

  // Test 5: client wrapper never reads/writes unsubscribe_token field
  it('newsletter-api.ts does not reference unsubscribe_token', () => {
    const srcPath = resolve(__dirname, '../newsletter-api.ts');
    const src = readFileSync(srcPath, 'utf-8');
    expect(src).not.toMatch(/unsubscribe_token/);
  });

  // Test 6: locale keys present per UI-SPEC §Copywriting Contract
  it('en/rag.json contains all newsletter copy keys per UI-SPEC §Copywriting Contract', () => {
    const localePath = resolve(
      __dirname,
      '../../../../public/locales/en/rag.json',
    );
    const locale = JSON.parse(readFileSync(localePath, 'utf-8')) as Record<string, unknown>;
    const newsletter = locale['newsletter'] as Record<string, unknown>;

    expect(newsletter).toBeDefined();
    const requiredKeys = [
      'section_heading',
      'toggle_label',
      'toggle_sublabel',
      'save_cta',
      'onboarding_label',
      'subject_format',
      'header',
      'intro_placeholder',
      'section_heading_topic',
      'read_full_cta',
      'footer_unsubscribe',
      'footer_disclaimer',
      'unsubscribe_success',
      'resubscribe_cta',
    ];

    for (const key of requiredKeys) {
      expect(newsletter[key], `Missing key: newsletter.${key}`).toBeDefined();
      expect(typeof newsletter[key]).toBe('string');
    }
  });
});
