# Phase 37 — Discussion Log

**Date:** 2026-05-19
**Phase:** 37 — M6 Helpdesk Core
**Mode:** discuss (default; batched)

Audit / retrospective use only — downstream agents read `37-CONTEXT.md`.

---

## Gray-area selection

**Q:** Which gray areas?
**A:** ALL 4 — PHI routing · AI assist scope · Widget surface + KB-first UX · Inbound email + reply-threading

---

## Area 1: PHI routing for helpdesk

**Q1:** Which ticket categories carry PHI? → **Clinician-side tickets only (any ticket from a clinic role)** → D-01
**Q2:** Email routing decision for ticket events? → **Honor ticket.phi flag end-to-end** → D-02
**Q3:** Claude AI assist on PHI tickets — which credential? → **BAA-allowlist (P25 D-13) for ANY ticket flagged phi=true** → D-03

Follow-on: D-04 (attachments inherit phi); D-05 (PHI access auditing via P25 log_phi_access RPC).

---

## Area 2: AI assist scope + auto-action policy

**Q1:** Which AI actions auto-fire? → **Auto-tag + auto-route; draft requires agent send** → D-06 + D-08
**Q2:** Confidence thresholds + sentiment-alert? → **0.75 / -0.6** → D-06 + D-10

Follow-on: D-07 (below-0.75 = suggestion only); D-09 (macro suggestion from Claude classification); D-11 (admin tuning UI = v1.4); D-12 (PII scrub-before-Claude rejected; BAA credential handles it).

---

## Area 3: Widget surface + KB-first UX

**Q1:** Where does the widget appear? → **Every authenticated screen + marketing pages with auth-aware fallback** → D-13
**Q2:** KB-first gate strictness? → **Typeahead immediate + always-visible Still-need-help button** → D-14
**Q3:** Anonymous user submission policy? → **support@ email only** → D-15

Follow-on: D-16 (helpdesk-widget chunk 25 kB gz lazy-loaded); D-17 (PHI-route widget behavior — planner picks).

---

## Area 4: Inbound email + reply-threading

**Q1:** Address pattern? → **support@ (new) + reply+<HMAC>@ on app.leanshot.app** → D-18
**Q2:** HMAC shape + lifetime? → **Per-ticket non-expiring HMAC over (ticket_id, user_id, secret); secret rotation invalidates** → D-19
**Q3:** Attachment handling? → **Up to 10MB, ClamAV-scanned, Supabase storage RLS** → D-20

Follow-on: D-21 (unknown email → auto-reply signup CTA, no ticket created); D-22 (HMAC fail → bounce auto-reply, not silent drop).

---

## Cross-cutting theme

PHI flag (D-01..D-05) is the load-bearing HIPAA decision. Every email send + Claude call must reference ticket.phi. Plan-checker enforcement called out in CONTEXT.md `<specifics>`.

## Out-of-scope items raised

- AI auto-SEND for high-confidence routine tickets — considered + rejected (HELP-04 verbatim); deferred to v1.4 consideration.
- Admin sentiment-threshold UI — deferred to v1.4.
- Mobile native helpdesk, voice channel, Typesense, ES KB content, macro version-history, per-org widget branding — all deferred.
