/**
 * Tests for the rag_* event registry additions (Phase 50 Plan 50-03 Task 4).
 *
 * Complements src/lib/analytics/events.test.ts (Phase 24 invariants).
 *
 * Scope:
 * - 13 rag_* events registered (D-35).
 * - All rag_* events flagged phi:false.
 * - The 4 user-facing impression/click/pageview events are server_only:true
 *   (D-34 ITP/uBlock resilience).
 * - rag_chunk_reviewed schema accepts all 6 reject reasons.
 * - rag_topic_created schema enforces mode enum (curated | open-web).
 * - Additive-only sanity check (D-10 from P24): every Phase 24 event name
 *   is still present in EVENTS. This is a belt-and-suspenders test alongside
 *   the AST-based ESLint rule (eslint-rules/additive-only-events.cjs) which
 *   blocks at commit time.
 */
import { describe, expect, it } from 'vitest';
import { EVENTS } from '../events';

// Pinned snapshot of Phase 24 + Phase 32 event names that MUST always be present.
// If a future plan needs to deprecate one of these, the deprecation goes
// through the additive-only ESLint rule's escape hatch (version bump + adapter).
const PRIOR_EVENT_NAMES_PINNED = [
  'signup_started',
  'signup_completed',
  'activation_first_log',
  'payment_initiated',
  'payment_completed',
  'refund_issued',
  'admin_action',
  'feature_flag_evaluated',
  'i18n_missing_key',
] as const;

const RAG_EVENT_NAMES_EXPECTED = [
  'rag_topic_created',
  'rag_topic_edited',
  'rag_topic_deleted',
  'rag_scrape_run',
  'rag_chunk_reviewed',
  'rag_chunk_published',
  'rag_chunk_retracted',
  'rag_tip_impression',
  'rag_tip_clicked',
  'rag_citation_clicked',
  'rag_newsletter_subscribed',
  'rag_newsletter_unsubscribed',
  'rag_hub_pageview',
] as const;

const RAG_SERVER_ONLY_EXPECTED = [
  'rag_tip_impression',
  'rag_tip_clicked',
  'rag_citation_clicked',
  'rag_hub_pageview',
] as const;

describe('events.ts — Phase 50 rag_* additions', () => {
  it('13 rag_* events registered', () => {
    const ragNames = Object.keys(EVENTS).filter((n) => n.startsWith('rag_'));
    expect(ragNames).toHaveLength(13);
    // exact set check (catches typo / missing addition)
    expect(ragNames.sort()).toEqual([...RAG_EVENT_NAMES_EXPECTED].sort());
  });

  it('all rag_* events flagged phi:false', () => {
    for (const name of RAG_EVENT_NAMES_EXPECTED) {
      const def = EVENTS[name];
      expect(def.phi, `${name} phi flag`).toBe(false);
    }
  });

  it('rag_tip_impression rag_tip_clicked rag_citation_clicked rag_hub_pageview are server_only', () => {
    for (const name of RAG_SERVER_ONLY_EXPECTED) {
      const def = EVENTS[name];
      expect(def.server_only, `${name} should be server_only:true`).toBe(true);
    }
  });

  it('non-server-only rag_* events do NOT carry server_only flag', () => {
    const browserEmittable = RAG_EVENT_NAMES_EXPECTED.filter(
      (n) => !(RAG_SERVER_ONLY_EXPECTED as readonly string[]).includes(n),
    );
    for (const name of browserEmittable) {
      const def = EVENTS[name];
      expect(def.server_only, `${name} should not be server_only`).toBeUndefined();
    }
  });

  it('rag_chunk_reviewed schema accepts all 6 reject reasons', () => {
    const def = EVENTS['rag_chunk_reviewed'];
    const reasons = [
      'off-topic',
      'factually-wrong',
      'off-label',
      'low-quality',
      'duplicate',
      'safety-concern',
    ] as const;
    for (const reject_reason of reasons) {
      const parsed = def.payload.parse({
        chunk_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        source_tier: 'A',
        action: 'rejected',
        reject_reason,
        queue_age_hours: 1.5,
      });
      expect(parsed.reject_reason).toBe(reject_reason);
    }
  });

  it('rag_chunk_reviewed reject_reason is OPTIONAL (approved/edited paths)', () => {
    const def = EVENTS['rag_chunk_reviewed'];
    const parsed = def.payload.parse({
      chunk_id: '178b7308-9b47-44a2-a429-fefda1b04173',
      source_tier: 'B',
      action: 'approved',
      queue_age_hours: 0,
    });
    expect(parsed.reject_reason).toBeUndefined();
  });

  it('rag_topic_created schema enforces mode enum curated|open-web', () => {
    const def = EVENTS['rag_topic_created'];
    expect(() =>
      def.payload.parse({
        topic_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        tag: 'glp-1',
        mode: 'invalid-mode',
        cadence: 'daily',
      }),
    ).toThrow();
    expect(() =>
      def.payload.parse({
        topic_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        tag: 'glp-1',
        mode: 'curated',
        cadence: 'daily',
      }),
    ).not.toThrow();
    expect(() =>
      def.payload.parse({
        topic_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        tag: 'glp-1',
        mode: 'open-web',
        cadence: 'weekly',
      }),
    ).not.toThrow();
  });

  it('rag_scrape_run schema enforces non-negative numeric invariants', () => {
    const def = EVENTS['rag_scrape_run'];
    expect(() =>
      def.payload.parse({
        topic_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        source_count: -1, // BAD
        chunks_found: 0,
        duration_ms: 100,
        status: 'ok',
        cost_usd: 0,
      }),
    ).toThrow();
    expect(() =>
      def.payload.parse({
        topic_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        source_count: 0,
        chunks_found: 0,
        duration_ms: 100,
        status: 'ok',
        cost_usd: -0.01, // BAD
      }),
    ).toThrow();
  });

  it('rag_newsletter_unsubscribed `via` enforces 1click|settings', () => {
    const def = EVENTS['rag_newsletter_unsubscribed'];
    expect(() => def.payload.parse({ via: '1click' })).not.toThrow();
    expect(() => def.payload.parse({ via: 'settings' })).not.toThrow();
    expect(() => def.payload.parse({ via: 'spam-button' })).toThrow();
  });

  it('rag_citation_clicked surface enforces coach|tip|news|hub union', () => {
    const def = EVENTS['rag_citation_clicked'];
    const surfaces = ['coach', 'tip', 'news', 'hub'] as const;
    for (const surface of surfaces) {
      expect(() =>
        def.payload.parse({
          chunk_id: '178b7308-9b47-44a2-a429-fefda1b04173',
          source_tier: 'A',
          topic_tag: 'glp-1',
          surface,
        }),
      ).not.toThrow();
    }
    expect(() =>
      def.payload.parse({
        chunk_id: '178b7308-9b47-44a2-a429-fefda1b04173',
        source_tier: 'A',
        topic_tag: 'glp-1',
        surface: 'sidebar',
      }),
    ).toThrow();
  });

  it('additive-only: no Phase 24 / Phase 32 events removed', () => {
    for (const name of PRIOR_EVENT_NAMES_PINNED) {
      expect(
        EVENTS,
        `Phase 24/32 event ${name} is missing — additive-only invariant violated`,
      ).toHaveProperty(name);
    }
  });
});
