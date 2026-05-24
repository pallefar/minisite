/**
 * Shared fixtures helpers for Phase 47 events / RSVP / waitlist RLS test suites.
 *
 * REQUIRES: 47-01 supabase db push --linked (events / event_rsvps / event_waitlist /
 *           event_reminder_sent / event_join_audit schema + RLS — Wave 0 Plan 47-01),
 *           47-04 event-covers storage bucket migration (cover_url FK target),
 *           tests/rls/fixtures-community.ts already deployed.
 *
 * Design:
 *   - Mirrors `tests/rls/fixtures-community.ts` (admin client + getUserAccessToken
 *     helper); slug-prefixed seeding keeps cross-suite isolation.
 *   - Uses admin client (service_role) for seeding — never supabase-js GoTrueClient
 *     signInWithPassword (avoids ES256 flake per reference_rls_fixture_gotrueclient_flake).
 *   - Each test file MUST declare a file-scoped `TEST_SLUG_PREFIX` per
 *     feedback_rls_per_file_slug_prefix precedent; pass it through to the
 *     createEventFixture / createRsvpFixture helpers so titles namespace by file.
 *
 * NOTE — Wave 0 RED scaffold:
 *   The signatures + JSDoc are final; bodies throw `Error('TODO …')`. Wave 1
 *   executors implementing 47-01 RLS proof / 47-02 RSVP RPC will replace the
 *   throws with real seeding logic. The signatures must remain stable so
 *   sibling tests can import them in the same wave.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// Re-export the shared admin/anon factories + SHOULD_RUN guard so event tests
// can `import { buildAdmin, SHOULD_RUN } from './fixtures-events'` without
// double-importing fixtures-community.
export {
  buildAdmin,
  buildAnonClient,
  SHOULD_RUN,
  createOrgScopedUser,
  type TestUser,
} from './fixtures-community';

// ---------------------------------------------------------------------------
// createEventFixture — seed an `events` row with sensible defaults.
// ---------------------------------------------------------------------------

export interface CreateEventFixtureOpts {
  /** Slug prefix from the calling test file (per-file isolation). */
  slugPrefix: string;
  /** community_spaces.id this event belongs to (RLS visibility scope). */
  space_id: string;
  /** Optional org_id for org-scoped events (RLS cross-tenant proof). */
  org_id?: string | null;
  /** RSVP capacity; null = unlimited. */
  capacity?: number | null;
  /** ISO timestamp when the event starts (defaults to +24h). */
  event_at_utc?: string;
  /** Duration in minutes (defaults to 60). */
  duration_minutes?: number;
  /** Tier gate ('free' | 'pro' | etc); defaults to 'free'. */
  required_tier?: string;
  /** Optional title override (slug-prefixed automatically). */
  title?: string;
  /** PHI flag for fan-out routing test (defaults to false). */
  phi?: boolean;
}

export interface EventFixture {
  id: string;
  space_id: string;
  title: string;
  event_at_utc: string;
  capacity: number | null;
}

/**
 * createEventFixture — inserts an `events` row using the admin client.
 *
 * @throws Error('TODO …') — Wave 0 RED scaffold; Wave 1 (47-01 / 47-02) implements.
 */
export async function createEventFixture(
  _admin: SupabaseClient,
  _opts: CreateEventFixtureOpts,
): Promise<EventFixture> {
  throw new Error(
    'TODO: createEventFixture — Wave 0 scaffold; Wave 1 (47-01 / 47-02) implements the seed.',
  );
}

// ---------------------------------------------------------------------------
// createRsvpFixture — seed an `event_rsvps` row.
// ---------------------------------------------------------------------------

export interface CreateRsvpFixtureOpts {
  /** events.id this RSVP belongs to. */
  event_id: string;
  /** auth.users.id of the RSVPing user. */
  user_id: string;
  /** RSVP status ('going' | 'waitlist' | 'maybe' | 'not_going'). */
  status: 'going' | 'waitlist' | 'maybe' | 'not_going';
  /** Optional waitlist position override (for FIFO test seeding). */
  waitlist_position?: number;
}

export interface RsvpFixture {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  waitlist_position: number | null;
}

/**
 * createRsvpFixture — inserts an `event_rsvps` row using the admin client.
 *
 * @throws Error('TODO …') — Wave 0 RED scaffold; Wave 1 (47-02) implements.
 */
export async function createRsvpFixture(
  _admin: SupabaseClient,
  _opts: CreateRsvpFixtureOpts,
): Promise<RsvpFixture> {
  throw new Error(
    'TODO: createRsvpFixture — Wave 0 scaffold; Wave 1 (47-02) implements the seed.',
  );
}
