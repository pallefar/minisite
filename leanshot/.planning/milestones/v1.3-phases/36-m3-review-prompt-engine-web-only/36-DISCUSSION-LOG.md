# Phase 36 — Discussion Log

**Date:** 2026-05-19
**Phase:** 36 — M3 Review Prompt Engine (Web Only — scope expanded mid-discussion to include v1.4 native scaffolding)
**Mode:** discuss (default; batched)

---

## Gray-area selection (initial)

**Q:** Which gray areas?
**A:** ALL 4 — Trigger rule semantics + V13-3 lint · Cooldown rules · NPS rating UI · External CTA list + redirect UX

## Mid-discussion scope expansion

User raised: "around reviews in phase 36 I also mean on apps to trigger the appstore reviews"

→ Surfaced ROADMAP-label-"Web Only" vs user-intent tension. Three paths offered:
  - (A) Scaffolding now; native fires in v1.4
  - (B) Pull native into v1.3 (lift mobile dependency — big scope)
  - (C) PWA-only path (marginal reach)

**User selected: A — scaffolding now, native fires in v1.4.**

Added **Area 5: Native review scaffolding** as the 5th decision area for this phase.

---

## Area 1: Trigger rule semantics + V13-3 BLOCKER lint

**Q1:** Admissible trigger events? → **Positive-engagement only (activation, level-up, streak milestones, challenge complete)** → D-01
**Q2:** Rule-builder composition shape? → **Single-condition rules only** → D-02
**Q3:** V13-3 lint mechanism? → **ESLint AST rule** → D-03

Follow-on: D-04 (lightweight grep backup with comment-strip per [[reference_grep_gate_comment_strip]]).

---

## Area 2: Cooldown rules + suppression

**Q1:** Per-trigger vs global cooldown? → **Hybrid: per-rule 30d min + global 60d/5-lifetime ceiling** → D-05
**Q2:** Detractor suppression (1-2★)? → **Suppress 90d after 1-2★ rating** → D-06
**Q3:** Cooldown reset triggers? → **Never reset (5-lifetime cap is absolute)** → D-07

Follow-on: D-08 (multi-device cooldown state via review_prompt_history keyed on user_id).

---

## Area 3: NPS rating UI + feedback-form shape

**Q1:** Rating scale + surface? → **5-star scale, modal sheet (mobile-first)** → D-09
**Q2:** Non-promoter feedback form fields? → **Single open-text 'What could we do better?'** → D-10
**Q3:** Promoter post-rating flow? → **Immediate external-CTA opt-in modal** → D-11

Follow-on: D-12 (dismiss = explicit close = cooldown counts).

---

## Area 4: External CTA list + redirect UX

**Q1:** External CTAs in v1.3? (multi) → **ALL 4 selected — Trustpilot + G2 + Capterra + Apple/Google (Apple/Google scaffolded-only per D-13)** → D-13
**Q2:** Per-cohort CTA targeting? → **Auto-target by primary_org_id** → D-14
**Q3:** Attribution tracking? → **Redirect-out-only** → D-15

Follow-on: D-16 (Trustpilot/G2/Capterra profile claim is HUMAN-UAT pre-req before P36 ships).

---

## Area 5: Native review scaffolding (architecture lock-in for v1.4)

**Q1:** Which trigger events fire native? → **Same positive-engagement whitelist as web NPS** → D-17
**Q2:** OS-cap respect + cooldown alignment? → **Server-side cooldown matches OS caps (3x/365d) + cross-platform respect** → D-18
**Q3:** Integration seam? → **Shared `useNativeReviewTrigger()` hook + Capacitor plugin web no-op shim** → D-20

Follow-on: D-19 (web NPS 5-lifetime quota separate from native 3-per-platform); D-21 (V13-3 lint covers shim too).

---

## V13-3 BLOCKER cross-cutting

D-03 + D-04 + D-21 form the V13-3 enforcement triangle:
- AST rule = primary detection
- Grep backup = secondary safety
- Shim coverage = forward-compat for v1.4 wiring

Plan-checker should verify all three exist before P36 ships.

## Out-of-scope items raised

- Live native fire on iOS/Android — deferred to v1.4 (scaffolding ships in v1.3)
- Multi-clause AND/OR rule composition — deferred to v1.4 polish
- External-review completion API polling — deferred (click-out-only in v1.3)
- 0-10 NPS scale — considered + rejected (5★ per ROADMAP)
- Cap reset triggers — considered + rejected (never reset)
- PWA-only review path — considered + rejected (Capacitor in v1.4 cleaner)
