# Phase 34 — Discussion Log

**Date:** 2026-05-18
**Phase:** 34 — M2 Onboarding Overhaul + Activation Event
**Mode:** discuss (default; batched questions)

This is the verbatim record of the discuss-phase session. Audit / retrospective use only — downstream agents read `34-CONTEXT.md`, not this file.

---

## Gray-area selection

**Question:** Which gray areas should we lock down for Phase 34?

**Options presented:** Activation event definition · Anonymous → authenticated merge · Step builder + A/B publish mechanics · First-action surface per goal

**User selected:** ALL 4

(Auth methods, smart defaults, and social proof were intentionally deferred to "Claude's discretion" — they have ROADMAP-locked specs or low decision-load.)

---

## Area 1: Activation event definition

**Q1:** What counts as the activation event — universal threshold or goal-dependent?
- A: **Goal-dependent (per stated goal)** → D-01

**Q2:** Should the activation window be time-bounded?
- A: **Yes — 7 days from signup** → D-02

Follow-on decisions captured by planner: single event name with property-bound shape (D-03), fire-once-per-user (D-04), server-side capture via Phase 24 D-13 path (D-05).

---

## Area 2: Anonymous → authenticated merge

**Q1:** Multi-device race policy — what wins when two devices both have anonymous data?
- A: **Richest-data row wins (deterministic merge)** → D-07

**Q2:** What data carries from anonymous → authenticated? (multi-select)
- A: **All 4 — Preferences + Draft entries + Telemetry/event history + Affiliate attribution** → D-08

**Q3:** TTL on orphan anonymous sessions?
- A: **30 days then purge** → D-09

Follow-on decisions: cookie-keyed table (D-06), PII posture / RLS deny / service-role-only access (D-10).

---

## Area 3: First-action surface per goal (ONBOARD-13)

**Q1:** Which goals does the onboarding ask the user to pick?
- A: **5+ goals (include doctor-monitored, family-supporter)** → expanded in Q1-followup

**Q1-followup:** Which 5–7 goals belong in the catalog?
- A: lose-weight + build-muscle + new-prescription + build-habit (all 4 primary)

**Q1-followup-2:** Additional goals for the catalog?
- A: ALL 4 additional — doctor-monitored + family-supporter + manage-symptoms + track-with-vial-supply

→ 8-goal catalog captured as D-11.

**Q2:** First-action mapping — which action per goal?
- A: **Hybrid: per-goal first-action, but show all 3 cards** → D-12

**Q3:** Can the user change their goal later, and does it re-fire activation?
- A: **Editable in Settings; activation NEVER re-fires** → D-14 + D-15

Claude noted at decision time: family-supporter goal implies caregiver data shape that is out of scope; surfaced as a Deferred Idea + captured the v1.3 ship behavior (waitlist landing card, activation-as-build-habit-proxy).

---

## Area 4: Step builder + A/B publish mechanics

**Q1:** Drag-drop step builder scope — how much WYSIWYG?
- A: **Question-type palette + drag-reorder (MVP)** → D-16

**Q2:** A/B publish semantics — what does "Ship Winner" actually do?
- A: **Write new version + flip flag** → D-17

**Q3:** Who can ship a winner?
- A: **Superadmin only** → D-18

Follow-on decisions: 50/50 default split admin-overridable (D-19); PostHog Experiments not raw flags (D-20).

---

## Deferred / Claude's discretion

Captured in CONTEXT.md `<deferred>` and `### Claude's Discretion` sections respectively.

## Out-of-scope items raised (none from user)

User stayed within phase scope throughout. No scope-creep redirects needed.
