/**
 * PostHog session-recording URL deny-list (single source of truth).
 *
 * This regex is consumed by the global PostHog init in src/lib/analytics.ts
 * (re-exported via `DISABLE_RECORDING_URL_REGEX`) as the
 * `session_recording.maskAllInputs` / `disable_session_recording_on_url`
 * predicate. Any pathname matched here will NEVER produce a session recording.
 *
 * Path-segment coverage:
 * - /clinic        — Phase 25 HIPAA-17 (clinic operator surface; per-patient PHI in DOM)
 * - /patient       — Phase 25 HIPAA-17 (patient detail views)
 * - /admin/users   — Phase 25 HIPAA-17 (admin user lookup includes email + auth events)
 * - /dose-log      — Phase 25 HIPAA-17 (medication dose history; pharmacology PHI)
 * - /share         — Phase 25 HIPAA-17 (read-share links can render PHI in URL token)
 * - /auth          — Phase 25 HIPAA-17 (auth flows include tokens in URL fragments)
 * - /admin/rag     — Phase 50 D-34 (admin RAG curation: topics/sources/queue/telemetry/cost)
 * - /research      — Phase 50 D-34 (public Research hub; defensive — chunk URLs may leak topic context)
 *
 * Boundary safety:
 * - `(\/|$)` ensures `/research-tool` does NOT match (only `/research` and `/research/...`).
 * - `i` flag tolerates URL-casing variations from server-side rewrites.
 *
 * HIPAA-17 traceability: this constant is the enforcement seam. Edits MUST
 * carry phase + decision ID in the commit message so the audit log can
 * reconstruct the path-deny lineage.
 */
export const DISABLE_RECORDING_URL_REGEX =
  /\/(clinic|patient|admin\/users|admin\/rag|dose-log|share|auth|research)(\/|$)/i;
