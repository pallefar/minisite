/**
 * Phase 9 Plan 09-05 — minimal parallel-execution stub.
 *
 * Plan 09-02 owns the real implementation (Pitfall #2 setAuth-before-subscribe
 * pattern for `org:<id>` and `user:<id>` private Realtime channels). This stub
 * exists only so Plan 09-05's component graph compiles inside its own worktree
 * branch — the orchestrator's merge resolver replaces this file with Plan
 * 09-02's real implementation.
 *
 * See `.planning/phases/09-clinic-b2b-foundations/09-02-PLAN.md` Task 1
 * `<action>` block for the canonical subscribe-helper pattern.
 */

export interface RealtimeChannelLike {
  unsubscribe: () => void | Promise<void>;
}

export async function subscribeToOrgChannel(
  _orgId: string,
  _onChange: (payload: unknown) => void,
): Promise<RealtimeChannelLike> {
  // Stub — Plan 09-02 ships the real channel.
  return { unsubscribe: () => {} };
}

export async function subscribeToUserChannel(
  _userId: string,
  _onChange: (payload: unknown) => void,
): Promise<RealtimeChannelLike> {
  // Stub — Plan 09-02 ships the real channel.
  return { unsubscribe: () => {} };
}
