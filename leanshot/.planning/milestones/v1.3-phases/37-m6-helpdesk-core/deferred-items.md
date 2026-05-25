# Phase 37 — Deferred Items

**Created:** 2026-05-21
**Pattern:** Phase 28 P0 deferral pattern.

---

## P0 — ClamAV attachment virus scanning

**Item:** Inline ClamAV virus scan of email attachments in `helpdesk-inbound`.

**Severity:** P0 — unscanned attachments are stored in private Supabase Storage (`ticket-attachments` bucket). RLS prevents cross-tenant read, but file content is not virus-scanned before storage.

**Reason for deferral:** Supabase Edge Function sandbox does not expose `clamd` (TCP or Unix socket). `npm:pompelmi` / `npm:clamav-client` both require a running clamd daemon. Provisioning an external HTTP-callable ClamAV microservice (Fly.io or sidecar) is out of scope for v1.3 timeline.

**v1.3 mitigations in place** (planner: these MUST be implemented in Plan 37-03):
1. MIME type allowlist on inbound attachments: `image/(png|jpeg|gif|webp)`, `application/pdf`, `text/plain`, `text/csv`. Reject anything else with a logged warning + auto-reply explaining the restriction.
2. Per-file size cap: 10 MB; per-email count cap: 10 attachments (drop overflow with logged warning).
3. Private storage bucket with two-axis RLS (`user_id` + `org_id`).
4. Edge Fn emits `helpdesk.attachment.scan_deferred` PostHog event per stored attachment so audit trail shows the v1.3 deferral is intentional.
5. `// TODO [DEFERRED v1.4]: ClamAV scan` comment at the attachment processing step in `helpdesk-inbound/index.ts`.

**v1.4 path** (mobile-shell phase or successor):
- Option A: Fly.io ClamAV microservice with HTTP endpoint callable from Edge Fn. Vendor-gated health-check pattern per `[[reference_vendor_gated_send_health_check]]` — code path exists, no-ops with logged warning until external clamd URL is set in Function Secrets.
- Option B: File-hash blocklist as reduced-fidelity fallback (lower priority).

This file does NOT block Phase 37 execution.
