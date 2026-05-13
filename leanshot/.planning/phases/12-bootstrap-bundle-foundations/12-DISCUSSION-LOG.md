# Phase 12: Bootstrap & Bundle Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 12-bootstrap-bundle-foundations
**Areas discussed:** Firewall module boundary + breadth, Phase 12 scope split (code vs accounts), Per-chunk ceiling values, CSP posture

---

## Area Selection

User picked all 4 surfaced gray areas. (Hash-hyphen fix verification, clinic-ad-free Playwright gate scope, and Resend domain choice were all pre-decided upstream by ROADMAP success criteria + memory references — not re-asked.)

---

## Area 1a — Firewall module boundary

| Option | Description | Selected |
|--------|-------------|----------|
| `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` | Matches SUMMARY "native bridge layer" naming + path used in ROADMAP Phases 16/18/20 SCs. Capacitor-grouped. | ✓ |
| `src/lib/health/* ↔ src/lib/ads/*` | Domain-grouped per PITFALLS.md Pitfall 1. Conflicts with how Phases 16/18/20 already reference `src/lib/native/*`. | |
| Both layers (adapters under native/, domain code in top-level) | Two-layer; firewall blocks crosswise at either layer. More files, clearer boundary, pays off for web-only ad code. | |

**User's choice:** `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts`
**Notes:** Picks the option that aligns with the rest of v1.2 planning (Phases 16/18/20 already reference this path). Locked as D-01.

---

## Area 1b — Firewall breadth (the "second tunnel")

| Option | Description | Selected |
|--------|-------------|----------|
| Analytics (PostHog wrappers) — `src/lib/analytics/*` + `src/lib/posthog*` cannot import `native/health.ts` | Closes the analytics-distinctId leak path flagged in PITFALLS #1. | ✓ |
| Affiliate — `src/lib/affiliate/*` + `src/lib/native/affiliate*.ts` cannot import `native/health.ts` | Affiliate-attribute Edge Function payloads can reach advertiser-visible metadata. | ✓ |
| Stripe metadata helpers — any file calling Stripe metadata cannot import `native/health.ts` | Stripe metadata fields readable by Connect partners; pitfall doc flags this. | ✓ |
| Generic ad-eligible bag — `src/lib/ads/*`, `src/lib/marketing/*`, `*.ad-eligible.ts` | Forward-looks: future ad-related code lands in named buckets and gets the block by convention. | ✓ |

**User's choice:** ALL FOUR (full spectrum).
**Notes:** Consistent with `feedback_aggressive_foundations.md` preference. Locked as D-02. Documented as intentionally maximalist so future contributors don't silently relax it.

---

## Area 2 — Phase 12 scope split (code vs accounts)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship code-only Phase 12 now; capture credentials as each vendor approves | Phase 12 closes on (a) hash-hyphen verified, (b) firewall + fixture, (c) clinic-ad-free e2e, (d) Resend domain, (e) Apple/Play/Stripe Connect provisioned. AdMob+AdSense → Phase 20 entry. Unblocks Phase 13 immediately. | ✓ |
| Hold Phase 12 closed until EVERY vendor approved | Cleanest seam but AdSense often requires live deployed app → circular dependency with Phase 13/14. Could block design rollout for weeks. | |
| Split into 12.0 (code gates) + 12.1 (vendor backlog) | Formalizes the split with two manifests. Same shipping outcome as option 1 with more bureaucracy. | |

**User's choice:** Ship code-only Phase 12; credentials trickle through Phases 14/16/20.
**Notes:** Locked as D-05. Avoids AdSense circular dependency. Credential capture pattern locked as D-06 (Vercel env + Supabase Function secrets, named conventions, PROJECT.md update each capture).

---

## Area 3 — Per-chunk ceiling values for not-yet-built chunks

| Option | Description | Selected |
|--------|-------------|----------|
| Declare names + research-derived rough caps now, tighten per phase | Phase 12 wires names + initial caps based on official SDK sizes. wave-0 skip protects until chunks land. Each owning phase tightens on close. Bundle bloat surfaces EARLY. | ✓ |
| Declare names only, no numbers | Phase 12 wires named slots + wave-0 skip; constants = `# TBD set in Phase NN`. Cost: 5 separate moments where a forgotten ceiling = silent regression. | |
| Skip per-chunk ceilings entirely | Only index ceiling enforced in Phase 12. Loses cross-cutting concern #3 promise. | |

**User's choice:** Declare names + research-derived rough caps now, tighten per phase.
**Notes:** Locked as D-07/D-08/D-09. Rough caps: stripe-elements ≤30 kB, adsense-glue ≤8 kB, page-builder-runtime ≤25 kB, web-push ≤3 kB, capacitor-bridge ≤15 kB. Researcher MUST validate against current vendor docs.

---

## Area 4 — CSP posture for v1.2

| Option | Description | Selected |
|--------|-------------|----------|
| Tight CSP — each owning phase widens with its SDK | Phase 12 verifies current CSP + adds CI snapshot test. Each later phase widens. Pro: minimal attack surface. Con: 5 reactive moments. | ✓ |
| Preemptive widen — Phase 12 adds every v1.2 origin up front | No reactive breakage but prematurely opens origins. Aesthetics over substance. | |
| Hybrid — snapshot test + runbook checklist | Phase 12 lands snapshot test + a runbook entry. Same end state as option 1 with explicit process. | |

**User's choice:** Tight CSP, per-phase widening (with the CI snapshot test from Option 1 making "reactive moment" loud, not silent).
**Notes:** Locked as D-10/D-11/D-12. Snapshot lives at `tests/csp/csp-snapshot.txt`. Plan-checker contract: any SDK-landing plan MUST include CSP delta + snapshot update.

---

## Claude's Discretion

- Exact rough-cap numbers in D-07 — researcher MUST validate against current vendor docs (Stripe.js, dnd-kit, @capacitor/core, web-push). If divergence >20%, planner adjusts.
- Exact ESLint rule syntax for `no-restricted-imports` — planner picks between `paths: [...]` / `patterns: [...]` / `import-x/no-restricted-paths` shapes based on which works best with existing config.
- CSP snapshot test framework — Vitest unit test vs Playwright header-fetch vs shell diff. Planner picks based on existing test infrastructure.

## Deferred Ideas

(See CONTEXT.md `<deferred>` section for the full list — repeated here for audit completeness.)

- Runtime firewall guard (`src/lib/ads/firewall.ts`) → Phase 18/20
- Privacy Manifest (`PrivacyInfo.xcprivacy`) → Phase 16
- AdMob + AdSense publisher credentials → Phase 20 entry conditions
- Resend tracking-pixel CSP origins → Phase 22
- DMARC policy tightening (`quarantine` → `reject`) → Phase 22 (after 30-day reports)
- Per-chunk ceiling numeric tightening → each owning phase (14/15/16/17/20)
- React Compiler-era hooks rules → out of scope (cosmetic)
- knip / ts-unused-exports CI gate → Phase 23 (v1.1 Tech Debt Sweep)
