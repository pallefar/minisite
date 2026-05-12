# Phase 8: Doctor Read-Share - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md.

**Date:** 2026-05-12
**Phase:** 08-doctor-read-share
**Areas discussed:** Doctor-view delivery architecture · Revocation enforcement primitive (SC#3) · Recipient-binding mechanism (SC#6) · Audit log architecture for SHARE-05

---

## Doctor-view delivery architecture

| Option | Selected |
|---|---|
| Same SPA + `/share/<token>` hash route | ✓ |
| Separate `share.leanshot.app` subdomain | |
| Separate tiny `share-app` standalone SPA | |

**Notes:** Reuses 22.55 kB index + lazy chart/DoctorReport chunks. Doctor route doesn't touch the patient's Zustand store — own snapshot fetched via Edge Function. Subdomain isolation deferred to Phase 9-10 if B2B forces it. Matches Phase 2's pattern; lowest dev cost.

---

## Revocation enforcement (SC#3 4-failure-mode drill)

| Option | Selected |
|---|---|
| DB-row-checked per request via Edge Function | ✓ |
| Short JWT TTL (60s) + DB refresh | |
| Vercel KV / Redis blacklist + JWT | |
| JWT-only with short TTL — NOT acceptable | |

**Notes:** Every share-route request hits Edge Function → validates JWT + queries `shares.revoked_at IS NULL AND expires_at > now()`. ~50-150ms latency. Postgres is single source of truth. JWT carries opaque `share_id` (SC#3 (c)). Cache-Control: private, no-store on every response (SC#3 (b)). Forwarded-link block via D-03 cookie.

---

## Recipient binding (SC#6)

| Option | Selected |
|---|---|
| 6-digit code single-use → HttpOnly cookie | ✓ |
| Bind to UA family + IP family on first code entry | |
| Per-session JS canvas + font fingerprint | |
| 6-digit code re-entered on every request | |

**Notes:** Edge Function POST `/share/redeem` validates code → marks consumed → sets HttpOnly+Secure+SameSite=Strict cookie. Subsequent requests check cookie hash matches `shares.recipient_session_hash`. Doctor enters code once; cookie persists for share lifetime. Code is single-use — forwarded link after entry has no cookie + can't re-enter consumed code. Brute-force: rate-limit 5 code attempts/min/share-row.

---

## Audit log architecture for SHARE-05

| Option | Selected |
|---|---|
| Extend Phase 7 `audit_logs` (add `actor_type`+`share_id`) | ✓ |
| New `share_audit_logs` table joined to `shares` | |
| PostHog events only (no DB rows) | |

**Notes:** New columns on `audit_logs`: `actor_type` (enum 'user'/'share_recipient'/'system'), `share_id` (nullable FK to `shares`). Share Edge Function writes rows directly via SECURITY DEFINER `log_share_view(share_id, ua_family, ip_family)` RPC (NOT via the table-write trigger; the `app.suppress_audit` GUC doesn't apply). Settings "Active shares" tab queries with RLS filter (`user_id=patient_id`). Reuses 13mo retention + skeleton-exclusion cron.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` §Claude's Discretion:
- `shares` table column choices beyond load-bearing ones (label, code_consumed_at, etc.)
- Edge Function endpoint shape (POST /share/redeem, GET /share/snapshot)
- Snapshot SQL view (Postgres view structurally excludes `ai_messages`)
- Print mode reuse of `DoctorReport.tsx` (Phase 3 PK-04 disclaimer survives)
- "Active shares" tab UX details

## Deferred Ideas

Captured in CONTEXT.md `<deferred>`:
- Doctor accounts (SHARE-V2-01)
- Doctor annotations (SHARE-V2-02)
- Realtime push for revocation
- Plan 07-02c cleanup (NOT folded into Phase 8 — separate work)
- Patient-notification email on doctor view (v2)
