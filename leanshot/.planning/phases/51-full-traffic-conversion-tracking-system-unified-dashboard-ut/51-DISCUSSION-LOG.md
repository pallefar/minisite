# Phase 51: Full Traffic + Conversion Tracking System + Unified Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 51-full-traffic-conversion-tracking-system-unified-dashboard
**Areas discussed:** Channel taxonomy + attribution model, Funnel shape + conversion definition, Dashboard surface granularity, Attribution storage + cross-channel rollup

---

## Channel taxonomy + attribution model

### Q1 — How granular should the channel taxonomy be in v1.3?

| Option | Description | Selected |
|--------|-------------|----------|
| Full UTM granularity + operator-configurable channel groups | Raw UTM verbatim + `channel_groups` admin table seeded with 8 defaults; rule-based grouping editable without code deploy | ✓ |
| Fixed 7-channel enum | Lock 7 channels in code; every tweak needs deploy + migration | |
| Fixed 5-channel enum (MVP) | Direct/Organic/Paid/Referral/Affiliate; loses paid-social vs organic-social comparison | |

**Notes:** Captured as D-01.

### Q2 — Which attribution model(s) does Phase 51 ship?

| Option | Description | Selected |
|--------|-------------|----------|
| Both first-touch AND last-touch | Per-user columns for each; dashboard toggle; multi-touch deferred to v1.4 | ✓ |
| Last-touch only | Orphans PAYWALL-07 which already implies first-touch | |
| Multi-touch linear from day one | New `traffic_touchpoints` table; ~10x storage; premature pre-PMF | |

**Notes:** Captured as D-02. Multi-touch deferred to v1.4.

### Q3 — When utm absent, how aggressively classify channel from `document.referrer`?

| Option | Description | Selected |
|--------|-------------|----------|
| Curated `referrer_channel_rules` admin table seeded ~80 domains | Operator-editable via admin UI; unmatched → Direct | ✓ |
| Hardcoded TS classifier function | Every fix needs deploy; contradicts configurable-channel-groups | |
| Don't classify — only utm counts | Organic Google traffic misclassified as Direct; SEO blind spot | |

**Notes:** Captured as D-03.

### Q4 — Anonymous visitors — track + attribute pre-signup?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — `lt_anon_id` cookie + PostHog `alias()` stitch on signup | Enables full visit→signup funnel; PHI-safe | ✓ |
| No — only post-signup tracking | Loses visit→signup conversion rate; dashboard mis-named | |
| Yes but don't stitch | Independent anon + identified streams; funnel breaks at signup | |

**Notes:** Captured as D-04.

---

## Funnel shape + conversion definition

### Q1 — Canonical funnel shape for Traffic dashboard?

| Option | Description | Selected |
|--------|-------------|----------|
| Three parallel funnels keyed by audience | Consumer / Clinic-org / Affiliate; each tab filters by audience | ✓ |
| Single locked 4-stage consumer funnel | Ignores ~30% of v1.3 strategic value (B2B clinic acquisition) | |
| Operator-configurable funnel builder UI | PostHog Funnels already does this; scope creep | |

**Notes:** Captured as D-05.

### Q2 — Which conversion event is the 'north star' for CAC rollup joining P33 ad_spend_facts?

| Option | Description | Selected |
|--------|-------------|----------|
| Activation event (P34 ONBOARD) | Faster feedback loop (days vs trial-length); leading indicator of paid retention | ✓ |
| Paid subscription started | Strict 'we got money' but ~14-day trial means ad-spend feels broken during trial | |
| Signup (account created) | Fastest feedback but rewards spammy traffic; bad north star | |

**Notes:** Captured as D-06. Creates Phase 51 → Phase 34 dependency (called out at write-context time; ROADMAP `Depends on:` updated to `Phase 33, Phase 34, ...`).

### Q3 — Attribution window from first/last touch to conversion?

| Option | Description | Selected |
|--------|-------------|----------|
| 30-day default, per-channel-group override | `channel_groups.attribution_window_days`; aligns with P33 D-09 per-network override; cookie TTL 90d | ✓ |
| Fixed 30-day for all | Conflicts with P33 D-09 (Meta=7d, Google=30d, TikTok=7d); two different windows for paid CAC | |
| Per-channel-group AND per-funnel-stage override | Overkill; signup→activation already days, activation→paid within trial | |

**Notes:** Captured as D-07. Per-funnel-stage override deferred to v1.4.

### Q4 — How does Phase 51 hook into TAXO-05 funnel-anomaly-cron for alerting?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend TAXO-05 cron with per-channel funnel-stage alerts | Zero new infra; writes to existing admin_notifications | ✓ |
| Standalone traffic-anomaly-cron | Splits anomaly-detection across 2 crons; worse operator UX | |
| No alerts in Phase 51 — dashboard only | 50% drop in organic-signup goes unnoticed for days; conflicts with aggressive-foundations | |

**Notes:** Captured as D-08.

---

## Dashboard surface granularity

### Q1 — How does the Traffic dashboard sit alongside the existing growth/cac module (P33)?

| Option | Description | Selected |
|--------|-------------|----------|
| New growth/traffic module + share 'Growth' nav group with growth/cac | Two sibling ADMIN_MODULES entries under shared nav; clean separation; deep-link between | ✓ |
| Extend growth/cac with more tabs | 7-tab monster; conflicts with P33 D-16 scope | |
| One module per concern | Four new modules; operator context-switches a lot | |

**Notes:** Captured as D-09.

### Q2 — Real-time tab — how 'real-time' is real-time?

| Option | Description | Selected |
|--------|-------------|----------|
| 5-min refresh from events_mirror direct query | TanStack-Query poll; cheap; no realtime-subscription complexity | ✓ |
| supabase-realtime live-pushed events | Live ticking counter; higher complexity; defer | |
| Drop real-time tab entirely | Saves a plan but operators lose 'is the launch tweet driving spike?' visibility | |

**Notes:** Captured as D-10. supabase-realtime deferred to v1.4.

### Q3 — Landing Pages tab — what does it surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Top N landing pages × conversion rate per audience-funnel, with page-variant breakdown | Joins PAGEAB page_variant_id; closes page-A/B feedback loop | ✓ |
| Top N landing pages + conversion rate, no variant breakdown | Half-completes the page-builder story | |
| No Landing Pages tab — collapse into Channels tab | Cross-cut 'best landing pages overall' hard to answer | |

**Notes:** Captured as D-11.

### Q4 — Dashboard scope axis — platform-wide only, or per-clinic-org view too?

| Option | Description | Selected |
|--------|-------------|----------|
| Platform-wide only in v1.3 | Smaller scope; defers per-clinic to v1.4 | |
| Platform-wide AND per-clinic view (per_org dimension on all matviews) | Big scope add: org_id propagation through anonymous→identified stitch; +2-3 plans | ✓ |
| Per-clinic ONLY | Contradicts user's 'to the site' framing | |

**Notes:** Captured as D-12. BIG SCOPE ADD. Requires P28/P29 multi-tenant prereqs (shipped).

---

## Attribution storage + cross-channel rollup

### Q1 — Where does per-user attribution data persist?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `user_traffic_attribution` SQL table + PostHog person-properties mirror | SQL authoritative (matview-joinable + RLS-scopeable); PostHog mirror for product-analytics filtering | ✓ |
| SQL table only | Operators lose PostHog cohort filtering by traffic source | |
| PostHog person properties only | Matviews can't join attribution without PostHog REST round-trips (rate-limited) | |

**Notes:** Captured as D-13.

### Q2 — Cross-channel rollup matview shape — one mega-matview or family?

| Option | Description | Selected |
|--------|-------------|----------|
| Family of 4 focused matviews refreshed by single sequenced cron | (a) channel_rollup (b) funnel_rollup (c) landing_page_rollup (d) realtime_v regular view; piggy-backs on P33 matview-refresh | ✓ |
| Single mega-matview `traffic_unified_rollup` | Cartesian explosion; full-refresh expensive at >100k events/day | |
| No matviews — query events_mirror live | Cheapest to build; CAC dashboard slow within 3 months | |

**Notes:** Captured as D-14.

### Q3 — Joining paid ad-spend (P33 ad_spend_facts) to attribution by what key?

| Option | Description | Selected |
|--------|-------------|----------|
| By (channel_group, day) aggregate — spend÷activations gives per-channel-group CAC | Simple, sound; per-campaign/creative CAC stays in P33 growth/cac | ✓ |
| By utm→ad_account_id mapping table | More accurate per-campaign but duplicates P33's surface | |
| By click_id parameter (fbclid/gclid/ttclid) | Most accurate; significant work per network; defer to v1.4 | |

**Notes:** Captured as D-15. Click-ID deferred to v1.4.

### Q4 — Retention/cohort axis — do channel rollups include downstream retention?

| Option | Description | Selected |
|--------|-------------|----------|
| Stop at conversion; D30 retained only for paid stage | Minimum signal for churn-prone channel detection | |
| Full cohort retention curves per channel (D1/D7/D14/D30/D60) | 5-7 wider matview; 2-3x refresh; richer LTV-quality answers | ✓ |
| Stop at conversion; no retention metric | Conflicts with P33 D-13 CAC alert which assumes target_ltv_usd | |

**Notes:** Captured as D-16. BIG SCOPE ADD. +1 plan for retention-computation helper.

---

## Claude's Discretion

- Edge Fn / RPC file layout (paths under `supabase/functions/` and migration timestamp window `20270704*`).
- Migration timestamp coordination pre-check vs Phase 33's `20270703*` reservation.
- `user_traffic_attribution` partition strategy — start un-partitioned; defer partitioning to v1.4 when row count exceeds 1M.
- RLS posture choices (`is_admin()` + `_is_org_clinician()` SECDEF; 51-deny test required).
- Bundle ceiling respect (admin-shell 30 kB chunk per P24); no new client charting library; reuse BaseChart.
- PHI containment via ESLint zone rules; `user_traffic_attribution` is non-PHI by construction.

## Deferred Ideas

- Multi-touch attribution (linear / position-based / data-driven) → v1.4
- Per-funnel-stage attribution window override → v1.4
- Operator-configurable funnel builder UI → out of scope (PostHog covers)
- supabase-realtime live-pushed Real-time tab → v1.4
- Per-campaign / per-creative CAC in `growth/traffic` → stays in P33 `growth/cac`
- Click-ID exact-match attribution → v1.4
- Cross-device user-stitch beyond PostHog default → defer indefinitely
- Anonymous bot/spam filtering beyond naive UA regex → v1.4
- Per-clinic-org `traffic_landing_page_rollup` for /share/clinic-X subpaths beyond minimal D-12 coverage → v1.4 B2B feature
- CSV/PDF export from dashboard → defer unless user requests at plan-phase
