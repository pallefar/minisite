---
phase: 51
status: clean
depth: standard
reviewed_at: 2026-05-24
fixed_at: 2026-05-24
files_reviewed: 27
critical: 4
warning: 14
info: 6
fixed: 18
skipped: 0
info_deferred: 6
---

# Phase 51 — Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Status:** issues_found

## Summary

Reviewed 15 SQL migrations, 3 Edge Functions (1 modified, 2 new), Vercel Edge
Middleware additions, the 5-tab admin module + Taxonomy admin sub-page, and
the 2 close-out test files for Phase 51 (Full Traffic + Conversion Tracking +
Unified Dashboard + UTM).

Headline concerns:

- **PHI leakage gap in the traffic recorder** — the `referrer` field is
  written verbatim to `user_traffic_attribution.first_touch_referrer` /
  `last_touch_referrer` without any PHI-path redaction. Only `landingPath`
  is redacted (`redactPath`). A clinic-share or patient-portal referrer URL
  containing `/patient/<phi>` will be persisted in plaintext to a non-PHI
  table, defeating the table's PHI-safety claim and ESLint zone rule.
- **Cross-channel double counting in `traffic_channel_rollup` matview** —
  the join `utat.user_id::text = em.distinct_id OR utat.user_id = em.user_id`
  fans events_mirror activations out across every utat row sharing a user_id
  (multi-anon-device users). The activation/paid columns are inflated by the
  number of attribution rows per user.
- **`compute_channel_stage_rate` reads RLS-locked matview** — the funnel
  matview was `revoke all on traffic_funnel_rollup from public, anon,
  authenticated`. The SECDEF RPC has `set search_path` and `security definer`
  but `set search_path` only fixes resolution; the RPC owner needs SELECT
  privilege on the matview. Migration 12 revokes from `public, anon,
  authenticated` (not `service_role` or the migration-running owner), so this
  likely works in practice via owner-implicit grant — but is fragile and
  undocumented. Worth verifying after db push.
- **`get_traffic_landing_page_rollup` p_top_n applies after RPC sort, not
  after client filter** — the admin `Filter by path…` filters the top-N rows
  returned by the server, so paths that match the filter but rank below
  position N are silently invisible. Same defect as a "filter searches only
  visible rows" UX bug.
- **Realtime tab does NOT forward `org_id` for clinic_owner** — the SECDEF
  RPC's branch requires `(p_org_id is not null and _is_org_clinician(p_org_id))`.
  TrafficRealtimeTab hardcodes `orgFilter: string | null = null`, so every
  clinic_owner gets a forbidden error and only admins can use the tab.
  Comment acknowledges this as a "51-10 close-out concern" but the data path
  ships broken for clinic_owner today.

Migration timestamps look clean. RLS gating uses canonical
`public.is_admin_at_least('admin'::public.admin_role)` consistently.
SECDEF RPCs called from service-role contexts (cron + recorder) do NOT
gate on `auth.uid()` per project memory. Cookie attributes
(`HttpOnly+Secure+SameSite=Lax`, no Domain) are correct.

The Phase 51 codebase is structurally sound; findings below are bugs and
robustness gaps within that scaffolding.

---

## Critical Issues

### CR-01: `referrer` field bypasses PHI redaction in traffic recorder

**Files:**
- `supabase/functions/traffic-attribution-recorder/index.ts:187`
- `supabase/functions/_shared/traffic-attribution.ts:170`
- `supabase/migrations/20271102000001_user_traffic_attribution.sql` (table comment lines 16–20)

**Issue:** The recorder Edge Fn applies `redactPath()` to `landingPath` only.
The `referrer` body field passes through `clamp()` and is then written
verbatim to `user_traffic_attribution.first_touch_referrer` /
`last_touch_referrer`. A referrer of
`https://app.leanshot.app/patient/abc-123-phi/notes` will land in the SQL
table in cleartext.

The table comment claims "PHI containment: this table carries NO PHI columns
(utm_* + referrer + landing_path are non-PHI by construction; the recorder
Edge Fn in Plan 51-02 path-redacts /patient/* / /clinic/*/patient/* /
/dose-log/* before write per RESEARCH §Security V6)." — but the recorder
does NOT redact `referrer`, only `landingPath`. The claim is false.

This is the underpinning of the planned ESLint zone rule (CONTEXT §Specifics
"PHI ESLint zone rule"). PHI in `referrer` defeats the table's safety claim
and the downstream PostHog mirror (`captureServer({ properties: { last_touch_referrer: ... } })`).

**Fix:**
1. In `traffic-attribution-recorder/index.ts`, also redact the referrer's
   pathname when its host is in our own allowlist:

```ts
function redactReferrer(ref: string | null): string | null {
  if (ref == null) return null;
  try {
    const u = new URL(ref);
    if (ALLOWED_ORIGINS.has(u.origin)) {
      u.pathname = redactPath(u.pathname);
      u.search = '';
      return u.toString();
    }
    return ref;
  } catch { return ref; }
}
// ...
const referrer = redactReferrer(
  clamp(typeof body.referrer === 'string' ? body.referrer : null, REFERRER_MAX_BYTES)
);
```

2. Add a test case to `traffic-attribution-recorder.test.ts` asserting that
   a same-origin referrer carrying `/patient/...` is redacted before the
   helper sees it.

---

### CR-02: Cross-channel activation/paid double-counting in channel rollup matviews

**Files:**
- `supabase/migrations/20271102000007_traffic_channel_rollup_matview.sql:90-97, 105-114`
- `supabase/migrations/20271102000008_traffic_channel_rollup_first_matview.sql:60-65, 73-78`

**Issue:** The join is `OR`-ed against two utat columns:

```sql
join public.user_traffic_attribution utat
  on utat.user_id::text = em.distinct_id
 or utat.user_id = em.user_id
```

A single user with N anon_ids (multi-device, cookie clearance, incognito
visit, etc.) has N rows in `user_traffic_attribution`, each potentially
classified to a different `last_touch_channel_group`. An activation event
for that user is joined against ALL N utat rows. The CTE then aggregates
`count(distinct em.distinct_id) … group by channel_group, audience, day,
org_id` — meaning the activation is counted once per channel_group the user
ever visited from, not once total.

Concretely: user signs up after touching Email → Direct → Paid Social. The
activation event lands once in events_mirror with user_id = U. utat has 3
rows (one per anon_id), each classified to a different
last_touch_channel_group. The activation joins to all 3 utat rows; the
matview shows `Email: 1 activation, Direct: 1, Paid Social: 1` instead of
"Paid Social: 1" (last-touch semantics) or "Email: 1" (first-touch).

CAC math then divides correct ad_spend by inflated activations — CAC values
in the dashboard will be artificially low for users with multi-touch
journeys, which is exactly the segment operators care about.

**Fix:** Pick a single utat row per `em.user_id` for last-touch (and the
mirror for first-touch). The intent is to attribute each activation to the
SINGLE last-touch channel_group at the time of the activation event:

```sql
-- daily_activations CTE
join lateral (
  select utat.last_touch_channel_group, utat.org_id
  from public.user_traffic_attribution utat
  where utat.user_id = em.user_id
  order by utat.last_touch_at desc
  limit 1
) utat on true
```

(Mirror for first-touch matview, ordering by `first_touch_at asc`.) The
existing `or utat.anon_id = em_in.distinct_id` branch in
`traffic_funnel_rollup` (migration ..0009) has the same issue and needs the
same lateral-pick fix. The `traffic_landing_page_rollup` (migration ..0010)
avoids this only because it joins via `audience_per_user au` keyed on
`au.user_id::text = em_act.distinct_id` — single side; double-count still
occurs there if a user has multiple utat rows because `au` is a SELECT FROM
utat (each utat row produces its own au row). Verify behavior with a
multi-anon fixture in 51-10 test data.

---

### CR-03: TrafficRealtimeTab forbids every clinic_owner — `orgFilter` hardcoded to null

**File:** `leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx:62`

**Issue:**

```ts
// Admin reads all orgs (p_org_id=null). Clinic-owner has no plumbed org_id
// on this codebase yet (app_metadata exposes org_name only, not the UUID),
// so we pass null and let the RPC's admin gate reject — surfacing a
// friendly Permission-denied error string.
const orgFilter: string | null = null;
```

The SECDEF RPC `get_realtime_traffic_summary` requires
`is_admin_at_least('admin') OR (p_org_id is not null and
_is_org_clinician(p_org_id, auth.uid()))`. Passing `null` from a
clinic_owner role triggers the 42501 forbidden branch every time. Per
UI-SPEC §Per-clinic-org Scope this tab should render with the clinic_owner's
own org. Today it renders "Permission denied — admin role required" for
every clinic_owner, which is a UX defect AND contradicts the documented
contract.

Other tabs (`TrafficChannelsTab.tsx:97-102`,
`TrafficLandingPagesTab.tsx:99-100`) correctly read
`s.signedIn?.user?.app_metadata?.org_id` (Channels) or `s.currentOrg?.id`
(Landing Pages). Realtime tab is the only outlier.

**Fix:** Match the Channels tab's pattern:

```ts
const orgFilter = useStore((s) => {
  const meta = s.signedIn?.user?.app_metadata as { role?: string; org_id?: string } | undefined;
  return meta?.role === 'clinic_owner' ? meta?.org_id ?? null : null;
});
```

Note: the Channels and Landing Pages tabs use TWO DIFFERENT sources for the
clinic_owner's org_id (`app_metadata.org_id` vs `currentOrg?.id`). That
inconsistency is its own bug — see WR-04.

---

### CR-04: `get_traffic_landing_page_rollup` returns top-N before client filter, hiding matching rows

**File:** `leanshot/src/components/admin/growth/TrafficLandingPagesTab.tsx:113-122, 164-173`

**Issue:** The SECDEF RPC applies `order by visits desc limit p_top_n` at
the server, returning at most N rows ordered by visits. The component then
applies the user's `Filter by path…` substring filter to those N rows. If
the user filters for `pricing` and `pricing` ranks #67 by visits but the
user is looking at Top 25, the filter returns zero matches even though the
data exists.

This is a real correctness defect: the UI promises "filter all landing
pages" but actually filters "top-N landing pages by visits."

**Fix options:**
1. Fetch with `p_top_n = 500` (the server cap, see migration ..0012 line
   195) and let the client apply both filter + top-N.
2. Push the filter to the server via a new `p_path_filter text` parameter
   on the SECDEF accessor (requires migration).

Option 1 is the cheapest:

```ts
// in fetchLanding()
const { data, error: rpcErr } = await supabase.rpc('get_traffic_landing_page_rollup', {
  p_org_id: orgFilter,
  p_start_date: startDate,
  p_end_date: endDate,
  p_audience: audience === 'all' ? null : audience,
  p_top_n: 500, // server cap; client applies filter + topN
});
```

---

## Warnings

### WR-01: `is_retained` RLS bypass leaks events_mirror counts to any caller that can read its caller's matview

**File:** `supabase/migrations/20271102000004_is_retained_secdef_helper.sql`

**Issue:** `is_retained` is `SECURITY DEFINER` and is called inside the
matview SELECT body. After REFRESH MATERIALIZED VIEW the matview stores the
result as a literal value. Anyone with SELECT on the matview (via the
SECDEF accessor RPC) sees retention counts that were computed against
events_mirror (admin-only) and `subscriptions` rows that may belong to
other orgs.

For the channel rollup matview this is grouped by org_id, so the
authorization gate on the accessor RPC keeps each org confined to its own
counts — fine. But the file comment claims "Service-role only" (line 96–
101), which is correct for execute permission, while masking the broader
implication: a clinic_owner reading their org's matview slice still observes
a number that was derived from events_mirror data they cannot read
directly. This is intentional aggregation, but is fragile: any future
audience leaking subscription state into the count (e.g., "clinic-org
retained" counts ALL active org subscriptions, not just the caller's org)
risks leakage.

The current `clinic-org` branch (lines 68–75) is fine because it joins on
the user_id passed in — a clinic_owner reading their org's matview row
still gets a retention count that's a function of THEIR org's members. The
`consumer` branch (lines 55–60) joins on events_mirror by `em.user_id = p_user_id`
or `em.distinct_id = p_user_id::text` — also fine.

**Fix:** Document this design in the helper comment so a future contributor
doesn't add a query that pulls cross-org rows. Add a test (in 51-10
RLS-traffic-attribution fixture) that asserts a clinic_owner's matview
retention column for their own row only reflects events from their org's
members.

---

### WR-02: `is_retained` returns false for `consumer` when distinct_id is the user's UUID-as-text from PostHog

**File:** `supabase/migrations/20271102000004_is_retained_secdef_helper.sql:56-60`

**Issue:** The match is `em.user_id = p_user_id OR em.distinct_id = p_user_id::text`.
Pre-stitch events_mirror rows have `distinct_id = anon_id` (not the user
UUID), so they won't match — which is correct. Post-stitch posthog-js
events typically use the supabase user_id as distinct_id, which DOES match.

But events captured server-side via `captureServer({ userId: args.userId ?? args.anonId })`
in `traffic-attribution.ts:184-186` use `args.anonId` as the PostHog
distinct_id BEFORE stitch and `args.userId` AFTER. Post-stitch
events_mirror rows have distinct_id = userId. Pre-stitch rows have distinct_id
= anonId. The OR-branch covers post-stitch only; pre-stitch activity (which
is what "consumer retained" should measure) is missed.

For "consumer retained = has any activity event in window" this means a
user who installed on D0, logged in on D5, and re-engaged from their phone
(new anon_id) on D7 may not register as D7-retained.

**Fix:** Either also JOIN to `user_traffic_attribution` by user_id to enumerate
the user's full anon_id set, or just relax the OR to match `em.user_id =
p_user_id` only (post-stitch events) and document that retention measures
post-signup activity:

```sql
return exists (
  select 1
  from public.events_mirror em
  where em.created_at >= v_threshold
    and em.user_id = p_user_id
);
```

---

### WR-03: traffic-attribution-recorder allows `orgId` from request body without validation

**File:** `supabase/functions/traffic-attribution-recorder/index.ts:202`

**Issue:** `body.orgId` is accepted as any string and forwarded to
`recordTouch({ orgId })`, which forwards it as `p_org_id uuid` to
`upsert_traffic_attribution`. A malicious browser can pass an arbitrary
org_id and stamp their anonymous attribution row to that org. The org_id
column has a FK to `public.orgs(id)` so a non-existent UUID will fail —
but a VALID UUID for some other org succeeds. Two consequences:

1. Cross-org pollution: the attacker's visit appears in org X's matview
   slice ("Traffic - {orgName}" — anyone with `is_admin_at_least('admin')`
   sees the noise; clinic_owner of X sees a phantom visit).
2. Forbids the planned signed-cookie flow (CONTEXT §Specifics
   "Org_id propagation on /share/clinic-X") from being authoritative —
   the cookie is supposed to be the only source of truth; an attacker can
   inject a different org_id.

The recorder comments line 168–174 acknowledge that org_id resolution
"happens in a future plan (51-10 wires resolve_clinic_slug_rpc); for now
we surface the slug-presence signal by leaving orgId null when only the
slug cookie is present" — but the body.orgId path is still wired,
short-circuiting that "future plan" with an unvalidated channel.

**Fix:** Either drop the body.orgId path entirely (preferred until slug-
resolution lands) or validate it via a server-side RPC that asserts the
caller is associated with that org (impossible for anon traffic — so:
drop it):

```ts
// Remove body.orgId entirely. orgId comes from the resolved slug cookie
// (Plan 51-10) — until then, always null:
const orgId: string | null = null;
```

---

### WR-04: Two divergent sources for clinic_owner's org_id across tabs

**Files:**
- `leanshot/src/components/admin/growth/TrafficChannelsTab.tsx:97-102` (uses `app_metadata.org_id`)
- `leanshot/src/components/admin/growth/TrafficLandingPagesTab.tsx:94-100` (uses `s.currentOrg?.id`)
- `leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx:197-202` (uses `app_metadata.org_id`)
- `leanshot/src/components/admin/growth/TrafficRealtimeTab.tsx:62` (hardcoded null)

**Issue:** Three different patterns for the same lookup across four sibling
files in the same module. At least one of these is wrong (and possibly all
three since the canonical source is undefined in CLAUDE.md / CONVENTIONS).
A clinic_owner switching between tabs will see different data subsets
depending on which source is populated.

**Fix:** Pick one source (the CACDashboardPage pattern from Phase 33 is the
precedent — verify which it uses) and use it across all four tabs. Refactor
into a single hook (`useOrgScope`) so the contract is documented in one
place.

---

### WR-05: `funnel-anomaly-cron` per-channel scan has inverted sigma sign convention

**File:** `supabase/functions/funnel-anomaly-cron/index.ts:209-211`

**Issue:** The per-channel scan computes
`const sigmas = (expected - observed) / stddev;` and fires when
`sigmas >= TRAFFIC_FUNNEL_SIGMA_THRESHOLD (2)`. This means observed must
be ≥ 2σ BELOW expected to alert — correct for "funnel drop."

But the EXISTING per-funnel scan in the same file uses
`baseline.z_score >= -funnel.sigma_threshold` (line 413) to mean "within
baseline." The Postgres function `funnel_anomaly_baseline_compute` returns
`z_score = (observed - expected) / stddev` (negative when drop).

The two paths use opposite z-score conventions in the same file. Anyone
maintaining this will eventually swap one for the other and silently flip
the alert direction.

**Fix:** Normalize. Either:
1. Adapt the per-channel scan to use the same convention:
   `const z = (observed - expected) / stddev; if (z >= -TRAFFIC_FUNNEL_SIGMA_THRESHOLD) continue;`
2. Or document the asymmetry clearly with `// sigmas > 0 = drop; threshold means observed >= 2σ below expected`.

The current code is correct but easy to misread.

---

### WR-06: `compute_channel_stage_rate` returns NaN for first today's hit

**File:** `supabase/migrations/20271102000014_compute_channel_stage_rate_rpc.sql:100-125`

**Issue:** When the (channel × audience × stage_pair) has fewer than 2
windowed days with non-null rate, `stddev_samp` returns NULL (it's sample
stddev, undefined for n < 2). The RPC then COALESCEs to 0. The cron check
in `funnel-anomaly-cron/index.ts:207`:

```ts
if (stddev === 0 || expected === 0) continue; // not enough baseline
```

Correctly bails. Fine.

But the `expected_rate` coalesces to 0 when `windowed` is empty. The sigma
computation `(expected - observed) / stddev` becomes `(0 - observed) / 0`
which is `-Infinity`, caught by `Number.isFinite` (line 210). Also fine.

What's NOT fine: when `expected_rate = 0.5` and `stddev = 0` (perfectly
flat baseline — every windowed day had rate 50%), the cron bails and no
alert fires even when today's rate has crashed to 5%. A flat baseline is
the EXACT case where a drop alert is most warranted.

**Fix:** Replace `stddev === 0` with a positive floor (e.g., 0.01) so flat
baselines still surface large drops:

```ts
if (stddev === null || expected === 0) continue;
const effectiveStddev = Math.max(stddev, 0.01);
const sigmas = (expected - observed) / effectiveStddev;
```

Or, in the SQL, return a small synthetic stddev when sample stddev is
NULL/0.

---

### WR-07: `traffic_funnel_rollup` matview attributes each stage_in event to ALL of the actor's utat rows

**File:** `supabase/migrations/20271102000009_traffic_funnel_rollup_matview.sql:71-73`

**Issue:** Same shape as CR-02 but in a different matview. The `LEFT JOIN
public.user_traffic_attribution utat ON utat.user_id::text = em_in.distinct_id
OR utat.anon_id = em_in.distinct_id` will match multiple utat rows for any
user with multiple anon_ids. The downstream GROUP BY then duplicates the
distinct_id count across channel_groups.

Less severe than CR-02 because `count(distinct em_in.distinct_id)` dedupes
within each (audience, channel_group, day, org_id, stage_in, stage_out)
group — but the distinct_id appears in multiple groups, so the per-channel
breakdown over-attributes. Top-of-page funnel chart (which sums across
channel_groups) overestimates `in_count` and `out_count`.

**Fix:** Same lateral-pick approach as CR-02 — attribute each event to one
utat row per user.

---

### WR-08: `is_retained` plpgsql function leaks per-user enumeration via timing

**File:** `supabase/migrations/20271102000004_is_retained_secdef_helper.sql:50, 62, 77`

**Issue:** The function has three branches with progressively more
expensive queries. Calling it via the matview path is fine (admin), but if
the function ever leaks to lower-privileged callers it becomes a user-id
enumeration oracle. Currently `revoke execute … from public, anon,
authenticated` (line 98) closes this, but the matview SELECT runs as the
matview owner — if a future migration grants matview SELECT directly to
authenticated, the helper exposes user existence.

**Fix:** Add a CHECK at top of body to refuse calls when `auth.uid()` is
not service_role:

```sql
-- defense in depth — refuse non-service-role direct calls
if current_setting('role', true) <> 'service_role' and not public.is_admin_at_least('admin'::public.admin_role) then
  return false;
end if;
```

Lower priority since execute is currently revoked.

---

### WR-09: TrafficTaxonomyPage match-rule editor accepts arrays and primitives mid-typing

**File:** `leanshot/src/components/admin/growth/TrafficTaxonomyPage.tsx:113-122`

**Issue:** The check `if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate))` is good. But the server-side
`upsert_channel_group` migration (`coalesce(p_match_rule_jsonb, '{}'::jsonb)`)
doesn't validate the jsonb is an object — it accepts any jsonb, including
arrays and primitives. If the client-side check is bypassed (direct
supabase.rpc call), bad data lands in `channel_groups.match_rule_jsonb`
and breaks `classify_channel_group()`'s `jsonb_each(cg.match_rule_jsonb)`
call at matview refresh time, taking down the entire refresh chain.

**Fix:** Add a CHECK constraint or validation in the RPC:

```sql
if jsonb_typeof(coalesce(p_match_rule_jsonb, '{}'::jsonb)) <> 'object' then
  raise exception 'match_rule_must_be_object' using errcode = '22023';
end if;
```

---

### WR-10: Empty `is_default_fallback` partial index uniqueness can be defeated by setting all rows false

**File:** `supabase/migrations/20271102000002_channel_groups.sql:35-37`

**Issue:** `create unique index … (is_default_fallback) where is_default_fallback`
enforces at most one row with `is_default_fallback = true`. But nothing
prevents an operator from UPDATEing the Direct row's `is_default_fallback`
to false (via direct SQL or a future bug in the admin UI's
`upsert_channel_group` if it ever gains a checkbox for the field). The
classifier wrapper `classify_channel_group_with_referrer` falls back to
hardcoded 'Direct' (line 152 of migration 03) so the system survives — but
the `delete_channel_group` "cannot delete fallback" protection (migration
15 lines 92–96) becomes meaningless if `is_default_fallback` is toggled
off first.

**Fix:** Add a partial CHECK that at least one row must be a fallback (not
strictly enforceable cross-row in Postgres — use a trigger or accept the
risk and document in the table comment).

---

### WR-11: `merge-anon-session` stitches lt_anon_id even when body.cookie_ids doesn't include it

**File:** `supabase/functions/merge-anon-session/index.ts:327-361`

**Issue:** After the legacy cookie-based merge logic completes successfully
(or short-circuits via "not eligible"), the code reads `lt_anon_id` from
the cookie header and calls `claim_traffic_attribution(lt_anon_id, userId)`.
This proceeds regardless of whether the legacy merge succeeded — so a
returning user whose cookie_ids are all stale still gets their traffic
attribution stitched.

That's actually intended (claim is idempotent + non-fatal), but the
implementation has a subtle bug: if the user has already signed in
previously and their `lt_anon_id` was claimed against a DIFFERENT user_id,
this call is a no-op (the RPC body sets `user_id = p_user_id WHERE
user_id IS NULL`). That's fine.

But if `lt_anon_id` is missing from the cookie header (browser sent only
non-HttpOnly cookies in some edge case) the function silently skips. The
posthog `doAlias(userId, ltAnonId)` call on line 335 fires BEFORE the SQL
claim — so a malicious user could pre-set their `lt_anon_id` cookie to an
arbitrary value and force a posthog alias to that distinct_id, polluting
posthog person properties. Low severity (posthog alias is mostly
idempotent), but the call ordering is wrong.

**Fix:** Reorder so the SQL claim's success gates the posthog alias:

```ts
const ltAnonId = parseCookie(req.headers.get('cookie'), 'lt_anon_id');
if (ltAnonId) {
  let claimSucceeded = false;
  try {
    const { error: claimErr } = await (admin() as any).rpc('claim_traffic_attribution', { ... });
    if (!claimErr) claimSucceeded = true;
  } catch (...) { ... }
  if (claimSucceeded) {
    try { doAlias(userId, ltAnonId); } catch (...) { ... }
  }
}
```

---

### WR-12: `traffic-attribution-recorder` accepts any audience value silently

**File:** `supabase/functions/traffic-attribution-recorder/index.ts:192-195`

**Issue:**

```ts
const audience =
  typeof body.audience === 'string' && VALID_AUDIENCES.has(body.audience)
    ? (body.audience as 'consumer' | ...)
    : 'consumer';
```

When the client sends an invalid audience (e.g., `audience: "<script>"`),
the recorder silently coerces to `consumer`. No 400 returned. The browser
attacker can't observe whether their input was malformed. Combined with
WR-03 (orgId), an attacker can write controlled audience+org_id pairs
without feedback. Server-side validation should reject malformed bodies
explicitly — at minimum log warn so operators see attempted abuse.

**Fix:**

```ts
if (typeof body.audience === 'string' && !VALID_AUDIENCES.has(body.audience)) {
  return jsonError(400, 'invalid_audience');
}
const audience = (body.audience as Audience) ?? 'consumer';
```

---

### WR-13: TrafficLandingPagesTab `r.bounce` uses `1 - signups/visits` (not real bounce rate)

**File:** `leanshot/src/components/admin/growth/TrafficLandingPagesTab.tsx:162`

**Issue:** "Bounce %" in the UI is computed as `Math.max(0, 1 - r.signups / r.visits)`. This is "did not sign up" %, not "bounce rate" in any
analytics sense. A user who landed, scrolled, read three pages, and left
without signing up is counted as a bounce. This is a misleading metric
label.

**Fix:** Either rename the column header "Did Not Sign Up %" (accurate) or
add real bounce tracking (a separate column in the matview that counts
sessions with only one event in `events_mirror`). For the immediate fix,
rename:

```tsx
<th ... aria-label="Sort by non-signup rate" ...>
  Non-Signup % {sortArrow('bounce')}
</th>
```

---

### WR-14: `traffic_realtime_v` is `inherits` access via SECURITY INVOKER but underlying tables locked

**File:** `supabase/migrations/20271102000011_traffic_realtime_view_and_rpc.sql:30-58`

**Issue:** A regular view defaults to `SECURITY INVOKER` (queries as the
caller). The view selects from `user_traffic_attribution` (RLS enabled) and
`events_mirror` (RLS enabled, no policies — admin only via SECDEF). With
`revoke all on public.traffic_realtime_v from public, anon, authenticated`
the direct SELECT is denied — good. But the SECDEF RPC
`get_realtime_traffic_summary` reads from this view at line 110 — running
as SECDEF owner, the view's inner queries run as that owner too (Postgres
14+ default for SECURITY INVOKER views: rights of the function owner).
This should work as documented, but a subtle Postgres version-dependent
behavior change (Postgres 15 introduced `security_invoker` view option as
default-off) means the actual semantics depend on the Postgres version
behind Supabase. Worth verifying after db push.

**Fix:** Explicitly opt the view OUT of the new security_invoker default
to nail down behavior:

```sql
create or replace view public.traffic_realtime_v
with (security_invoker = false) as
  select ...
```

(Or accept the default and document the Postgres version dependency.)

---

## Info

### IN-01: Hardcoded chart colors break dark-mode contract

**File:** `leanshot/src/components/admin/growth/TrafficFunnelsTab.tsx:325, 330`

The funnel chart uses literal `rgba(120, 120, 120, 0.55)` and `rgba(74,
144, 226, 0.85)` for dataset colors. UI-SPEC explicitly forbids hardcoded
colors and reserves accent for the existing 6-item list. Dark-mode users
see the same colors against a different background; contrast ratios may
fail WCAG.

**Fix:** Read from CSS custom properties via `getComputedStyle(document.documentElement).getPropertyValue('--color-...')` or pass theme-aware tokens via the BaseChart wrapper (which already handles theme remount per `BaseChart.tsx`).

---

### IN-02: `fire-touch.ts` comment block is stale / mid-thought

**File:** `leanshot/src/lib/traffic/fire-touch.ts:85-101`

A 15-line comment debates whether HttpOnly cookies are readable from
`document.cookie`. The first sentence claims yes, the second walks it
back. Reads like an in-flight thought. Trim to a 2-line note:

> The middleware mints lt_anon_id as HttpOnly. document.cookie cannot read
> it. The recorder Fn falls back to the inbound Cookie header (browser
> attaches via credentials:'include').

---

### IN-03: `tickBucket()` rounds wrong on edge

**File:** `supabase/functions/funnel-anomaly-cron/index.ts:281-285`

```ts
return iso.slice(0, 16) + ':00.000Z';
```

For input `2026-05-24T10:59:59.999Z`, the bucket is `2026-05-24T10:59:00.000Z` — correct. But `iso.slice(0, 16)` includes the seconds-separator `:` at position 16; actually slice(0,16) gives `'2026-05-24T10:59'`. So the final string is `'2026-05-24T10:59:00.000Z'` — correct. Just confusing; consider `new Date(d.setSeconds(0,0)).toISOString()`.

---

### IN-04: `n()` helper in TrafficChannelsTab is dead-equivalent to `Number()`

**File:** `leanshot/src/components/admin/growth/TrafficChannelsTab.tsx:82-84`

```ts
function n(value: number | null | undefined): number {
  return value == null || Number.isNaN(Number(value)) ? 0 : Number(value);
}
```

`Number.isNaN(Number(value))` only matters for non-numeric strings; the
typing already restricts to `number | null | undefined`. Simplify:

```ts
const n = (v: number | null | undefined): number => v ?? 0;
```

---

### IN-05: Stale "PostHog alias" comment in `traffic-attribution.ts`

**File:** `supabase/functions/_shared/traffic-attribution.ts:184-186`

Comment claims "before identification we use anonId as the PostHog
distinct_id" but the `userId ?? args.anonId` fallback runs at every call
— so a pre-signup touch passes anonId, and a post-signup touch (if the
caller knows the user_id) passes user_id. The comment is accurate but
misleading about the lifecycle. Edit to clarify the call-site responsibility.

---

### IN-06: Migration `references public.orgs` while comment mentions `public.organizations`

**File:** `supabase/migrations/20271102000001_user_traffic_attribution.sql:33`

The migration references `public.orgs(id)` (correct — canonical table
exists). But the surrounding CONTEXT.md and code comments reference
`public.organizations` (e.g., 51-CONTEXT.md line 32, "Organizations + org_members + _is_org_clinician()"). Two names for one table is a documentation drift; align to `public.orgs` (the actual table) across plan docs.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Fixes Applied (2026-05-24)

All 4 Critical + 14 Warning findings fixed across 6 commits on `main`.
Info (IN-01..06) deferred (cosmetic / non-blocking; tracked as paper cuts).

| Finding | Commit  | Status                              | Note |
|---------|---------|-------------------------------------|------|
| CR-01   | b102798a | fixed                              | `redactReferrer()` + test; same-origin PHI paths only. |
| CR-02   | 2478f789 | fixed (requires human verification) | Matview 07/08: lateral-pick utat by recency. NOT db-pushed yet (Phase 51 deferred to v1.3 milestone). |
| CR-03   | 82c150bd | fixed                              | TrafficRealtimeTab via useOrgScope (canonical app_metadata.org_id). |
| CR-04   | 82c150bd | fixed                              | p_top_n=500; client filter+sort+slice. |
| WR-01   | e19c121d | fixed                              | is_retained COMMENT documents cross-RLS invariant. |
| WR-02   | e19c121d | fixed (requires human verification) | Consumer match enumerates full anon_id set via utat. |
| WR-03   | 5a099694 | fixed                              | recorder body.orgId path dropped — always null. |
| WR-04   | c0ad73ed | fixed                              | useOrgScope hook unifies 4 Traffic tabs. |
| WR-05   | 5a099694 | fixed                              | Sigma convention asymmetry documented inline. |
| WR-06   | 5a099694 | fixed                              | stddev floor 0.01 so flat baseline surfaces drops. |
| WR-07   | 2478f789 | fixed (requires human verification) | Matview 09 funnel: lateral-pick by last_touch_at. |
| WR-08   | e19c121d | fixed                              | is_retained role gate (service_role OR admin). |
| WR-09   | e19c121d | fixed                              | upsert_channel_group jsonb_typeof = 'object' check. |
| WR-10   | e19c121d | fixed                              | BEFORE UPDATE/DELETE trigger blocks zero-fallback. |
| WR-11   | 5a099694 | fixed                              | claim BEFORE alias; alias gated on claim success. |
| WR-12   | 5a099694 | fixed                              | Recorder rejects invalid audience with 400. |
| WR-13   | c0ad73ed | fixed                              | "Bounce %" → "Non-Signup %" label rename. |
| WR-14   | e19c121d | fixed                              | View pinned `with (security_invoker = false)`. |

Verification:
- Recorder Deno tests: 9/9 pass (added CR-01 case + redactReferrer helper).
- TypeScript: `tsc --noEmit` clean on changed leanshot/ files.
- Deno typecheck: clean on all 3 modified Fns.
- Matview SQL edits (CR-02 / WR-07): NOT yet db-pushed — Phase 51 SUMMARY
  notes "db push + Fn deploys deferred to v1.3 milestone close", so the
  in-place edits to migrations ..0007/..0008/..0009 are safe (no
  corrective migration needed). Carry into v1.3 milestone close.
- Edge Fn deploys (recorder, merge-anon-session, funnel-anomaly-cron):
  also deferred to v1.3 milestone close per the same Phase 51 SUMMARY.

Pre-existing lint errors (lucide-react import-order, jsx-a11y aria-sort on
button-role) NOT touched — they predate this review and are out of scope.

_Fixed: 2026-05-24_
_Fixer: Claude (gsd-code-fixer)_
