# Phase 46: M4 Courses / Classroom - Discussion Log

> **Audit trail only.** Decisions in 46-CONTEXT.md.

**Date:** 2026-05-23
**Phase:** 46-M4 Courses / Classroom
**Areas discussed:** Schema + free-preview, Mux video + captions + DRM, Progress + completion threshold, Certificates + Phase 39 dependency

---

## Schema + Free-Preview

| Q | Selected |
|---|---|
| Hierarchy | course → module → lesson (3-level) |
| Free-preview | First lesson of each course free (lead-magnet) |
| Admin reorder | dnd-kit (reuse Phase 15 / Phase 31) |
| Required/optional | All lessons required (simplest) |

## Mux Video + Captions + DRM

| Q | Selected |
|---|---|
| Max length | 30 min / 2 GB |
| Captions | Yes, default-on (English; ~$0.04/min) |
| Playback security | Mux signed playback URLs (JWT time-limited) |
| Thumbnails | Auto at 1s mark (mirrors Phase 44 D-07) |

## Progress + Completion + Anti-Skip

| Q | Selected |
|---|---|
| Granularity | Per-lesson binary + last-watched-timestamp |
| Sync cadence | Every 15s (Mux Player onTimeUpdate debounced) |
| Completion threshold | 100% required (D-04 alignment) |
| Anti-skip | Yes — ≥95% Mux playback required |

## Certificates + Phase 39 Dependency

| Q | Selected |
|---|---|
| Generation timing | On-completion server-side Edge Fn |
| Verification URL | Public `/verify/<cert_id>` with HMAC-signed token |
| PDF template | Single fixed jsPDF template, brand-themed |
| Phase 39 dep | Stub: ship single-template landing pages; PAGEAB-06 retrofit later |

## Claude's Discretion

- `qrcode` lib (D-15) — researcher confirms what's already shipped
- Resource-download gate — reuse `tier-gate.ts` pattern (D-16)
- Mux signing key + cert HMAC secret — Wave 0 vendor pre-flight
- QR code on cert PDF (verification UX) — confirm dep
- Course list page = fixed index (not PageBuilder)

## Deferred Ideas

- Phase 39 PAGEAB-06 retrofit
- Spanish auto-captions (Phase 32)
- Full Mux DRM
- Cohort-based / drip courses
- Course completion leaderboards
- Admin re-issue cert UI / custom template editor / custom thumbnail upload
- Lesson chapters / per-segment progress
- Group enrollments / team licenses
- Course drafts + scheduled publish
- Course completion email (would trigger notification CHECK widening)
