/**
 * Phase 47 Plan 10 (EVENT-01 / 02 / 03) — Events domain types.
 *
 * Shared TypeScript types for the consumer Events surface
 * (EventsTab / EventCard / EventDetailSheet / RsvpPills / JoinMeetingButton)
 * AND the typed RPC wrapper (lib/events/rsvp-client.ts).
 *
 * Forked-shape mirrors `src/lib/community/community-types.ts`:
 *   - pure types, no runtime code, no imports;
 *   - mapped 1:1 to the `events` and `event_rsvps` table column sets shipped
 *     by Phase 47 Plans 47-01..47-03 (see 47-RESEARCH.md schema sections);
 *   - the `EventReminderKind` discriminator matches the `event_reminders`
 *     `kind` enum delivered by 47-04 (fanout) for any future consumer
 *     surfacing of reminder state (not used directly by this plan).
 *
 * Pure types, no runtime, no imports.
 */

// ─── RSVP status ─────────────────────────────────────────────────────────────

/**
 * Mirrors the `event_rsvps.status` text-CHECK constraint shipped by 47-02.
 * 'waitlist' is server-assigned only — the consumer UI calls
 * `createRsvp(event_id, 'going' | 'maybe' | 'not_going')` and the SECDEF RPC
 * promotes to 'waitlist' atomically when capacity is exceeded.
 */
export type RsvpStatus = 'going' | 'maybe' | 'not_going' | 'waitlist';

// ─── Reminder kinds ──────────────────────────────────────────────────────────

/**
 * Mirrors the `event_reminders.kind` enum shipped by 47-04 (fanout). Surfaced
 * here for forward-compat (e.g. a future "reminders inbox" component) — not
 * consumed by this plan's components.
 */
export type EventReminderKind = '1d' | '1h' | 'promotion';

// ─── Event ───────────────────────────────────────────────────────────────────

/**
 * Mirrors the `events` table column set (Phase 47 Plan 47-01 migration).
 * Field types mirror Postgres-to-JSON shapes (timestamptz → ISO string).
 */
export interface Event {
  id: string;
  space_id: string;
  title: string;
  description: string | null;
  start_at: string; // ISO timestamptz
  end_at: string;   // ISO timestamptz
  capacity: number;
  cover_url: string | null;
  zoom_managed: boolean;
  attach_to_module_id: string | null;
  recording_mux_asset_id: string | null;
  recording_playback_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── EventRsvp ───────────────────────────────────────────────────────────────

/**
 * Mirrors the `event_rsvps` table column set (Phase 47 Plan 47-02).
 * `waitlist_position` is non-null only when `status === 'waitlist'`.
 */
export interface EventRsvp {
  id: string;
  event_id: string;
  user_id: string;
  status: RsvpStatus;
  waitlist_position: number | null;
  created_at: string;
  updated_at: string;
}
