---
phase: 64-legal-refresh
plan: 08
type: execute
wave: 2
depends_on:
  - 64-01
  - 64-02
  - 64-03
  - 64-04
  - 64-05
  - 64-06
  - 64-07
files_modified:
  - .planning/ROADMAP.md
  - .planning/STATE.md
  - .planning/REQUIREMENTS.md
  - .planning/phases/64-legal-refresh/64-CARRY-OVER.md
  - .planning/phases/64-legal-refresh/64-SUMMARY.md
  - .planning/phases/64-legal-refresh/64-VERIFICATION.md
autonomous: false
requirements:
  - LEGAL-01
  - LEGAL-02
  - LEGAL-03
  - LEGAL-04
  - LEGAL-05
  - LEGAL-06
  - LEGAL-07
  - LEGAL-08
  - LEGAL-09
  - LEGAL-10
  - AUTH-16
user_setup:
  - service: supabase
    why: "Apply 5 Phase 64 migrations + deploy 2 Edge Functions"
    env_vars:
      - name: SUPABASE_ACCESS_TOKEN
        source: "Ambient (Claude Code session) or `supabase login` device-flow"
      - name: PHASE_64_SHIP_DATE
        source: "Operator sets at deploy time — ISO timestamp for grandfathered-policy-notice cutoff"
      - name: PHYSICAL_ADDRESS
        source: "LeanShot LLC physical address — required by CAN-SPAM; runtime guard rejects [placeholder] strings"

must_haves:
  truths:
    - "All 5 Phase 64 migrations are applied to remote project ytnsipxxmzgaebkqmokp"
    - "Edge Functions privacy-optout-process + grandfathered-policy-notice are deployed ACTIVE"
    - "ROADMAP.md Phase 64 row shows all 8 plans checked + Phase 64 status complete"
    - "STATE.md last_completed = 64; current_phase = 65 (or next planned)"
    - "REQUIREMENTS.md LEGAL-01..10 + AUTH-16 cross-ref all marked Complete (Phase 64)"
    - "CARRY-OVER.md documents: grandfathered email send is operator-action at Phase 70; DMCA agent registration with U.S. Copyright Office is operator-action at Phase 70; legal counsel review of state-addendum draft copy at Phase 70 UAT"
    - "VERIFICATION.md records the human-verify checkpoint outcome including axe-core re-audit against staging URL"
  artifacts:
    - path: ".planning/phases/64-legal-refresh/64-SUMMARY.md"
      provides: "Phase 64 close-out summary"
    - path: ".planning/phases/64-legal-refresh/64-CARRY-OVER.md"
      provides: "Operator-action items for Phase 70 UAT"
    - path: ".planning/phases/64-legal-refresh/64-VERIFICATION.md"
      provides: "Verification + axe-core re-audit results"
  key_links:
    - from: ".planning/STATE.md"
      to: "ROADMAP.md Phase 64 row"
      via: "manual edit per [[reference_state_complete_phase_writes_wrong_counters]] (do NOT use state.complete-phase)"
      pattern: "Phase: 64.*complete\\|completed_phases: 1[23]"
---

<objective>
Close out Phase 64: Legal Refresh. Apply migrations, deploy Edge Functions, run cross-plan verification, run human-verify checkpoint against staging URL (axe-core WCAG 2.2 AA re-audit per LEGAL-07), update ROADMAP/STATE/REQUIREMENTS, write SUMMARY + CARRY-OVER + VERIFICATION docs.

Purpose: Phase 64 atomic close-out — the v1.4 launch BLOCKER (per ROADMAP.md "cannot launch nationally without these") needs all 10 LEGAL-* requirements crossed off before Phase 70 UAT can sign off.

Output: Remote DB has 5 new tables, 2 deployed Edge Fns, planning docs reflect completion, operator-action items isolated in CARRY-OVER for Phase 70.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/64-legal-refresh/64-CONTEXT.md
@.planning/phases/64-legal-refresh/64-VALIDATION.md
@.planning/phases/64-legal-refresh/64-01-SUMMARY.md
@.planning/phases/64-legal-refresh/64-02-SUMMARY.md
@.planning/phases/64-legal-refresh/64-03-SUMMARY.md
@.planning/phases/64-legal-refresh/64-04-SUMMARY.md
@.planning/phases/64-legal-refresh/64-05-SUMMARY.md
@.planning/phases/64-legal-refresh/64-06-SUMMARY.md
@.planning/phases/64-legal-refresh/64-07-SUMMARY.md

<interfaces>
<!-- Migration push command per [[feedback_phase_close_out_db_push_verification]] -->
npx supabase db push --linked

<!-- Edge Fn deploy commands -->
npx supabase functions deploy privacy-optout-process --project-ref ytnsipxxmzgaebkqmokp
npx supabase functions deploy grandfathered-policy-notice --project-ref ytnsipxxmzgaebkqmokp

<!-- STATE.md edit per [[reference_state_complete_phase_writes_wrong_counters]] — do NOT use gsd-sdk state.complete-phase, edit manually -->
<!-- ROADMAP.md format per [[feedback_roadmap_format_variance_close_out_check]] — grep for `- [ ] 64-` before sed -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Apply 5 Phase 64 migrations to remote + verify</name>
  <files>(no source edits — applies migrations 20290103000001..20290103000005 from Plan 64-01)</files>
  <action>
    From the git root `/Users/karstenhaldan/minisite`:
    1. List local migrations: `ls supabase/migrations/20290103*.sql` — expect 5 files.
    2. Inspect remote head: `npx supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp` — current head should be `20290102000010`.
    3. Apply: `npx supabase db push --linked --project-ref ytnsipxxmzgaebkqmokp`
       - If a back-dated-migration block triggers per [[reference_supabase_back_dated_migration_blocks_push]]: pause + alert operator (rare since 20290103* are forward-dated).
       - On success: verify with `npx supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp | tail -8` shows all 5 new entries.
    4. Verify table presence via SQL: connect with `npx supabase db remote commit --project-ref ytnsipxxmzgaebkqmokp` OR run a one-off `npx supabase db execute --linked` (if available) OR pgrest call:
       `curl -sS "${SUPABASE_URL}/rest/v1/privacy_optout_requests?limit=0" -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"` — expect 200 (empty array).
       Repeat for ad_targeting_exclusion (will 401 — staff-only RLS), email_lifecycle_exclusion (401), policy_notice_log (401), data_rights_requests (401 unless authenticated). Empty 200 for the public table + 401 for the staff-only tables confirms migration + RLS together.
    5. If any migration fails to apply, halt — do NOT continue. Operator must investigate; recovery may include the [[reference_supabase_back_dated_migration_blocks_push]] recipe.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite &amp;&amp;
      ls supabase/migrations/20290103000001_*.sql supabase/migrations/20290103000002_*.sql supabase/migrations/20290103000003_*.sql supabase/migrations/20290103000004_*.sql supabase/migrations/20290103000005_*.sql &amp;&amp;
      npx supabase migration list --linked --project-ref ytnsipxxmzgaebkqmokp | tail -10 | grep -c "20290103" | awk '{ if ($1 &lt; 5) { print "MISSING migrations on remote"; exit 1 } else print "OK 5 migrations applied" }'
    </automated>
  </verify>
  <done>
    5 migrations applied to remote project ytnsipxxmzgaebkqmokp; presence verified via supabase migration list.
  </done>
</task>

<task type="auto">
  <name>Task 2: Deploy 2 Edge Functions + smoke-test healthz endpoints</name>
  <files>(no source edits — deploys functions from Plans 64-02 + 64-03)</files>
  <action>
    From the git root:
    1. Set required secrets on the project (if not already set):
       `npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp PHASE_64_SHIP_DATE=2026-05-27T00:00:00Z`
       `npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp PHYSICAL_ADDRESS="&lt;operator-provided real address&gt;"` — REJECT if value contains `[`, `TODO`, or `REPLACE_ME` (placeholder runtime guard per [[feedback_placeholder_string_runtime_guard_pattern]])
       (NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY + RESEND_API_KEY + SUPABASE_SERVICE_ROLE_KEY + POSTHOG_PROJECT_KEY were configured in Phase 60.5 — verify with `npx supabase secrets list --project-ref ytnsipxxmzgaebkqmokp`)

    2. Deploy `privacy-optout-process`:
       `npx supabase functions deploy privacy-optout-process --project-ref ytnsipxxmzgaebkqmokp`
       Smoke test: `curl -sS https://ytnsipxxmzgaebkqmokp.functions.supabase.co/privacy-optout-process/healthz` → expect 200 + `{"ok":true,"fn":"privacy-optout-process"}`

    3. Deploy `grandfathered-policy-notice`:
       `npx supabase functions deploy grandfathered-policy-notice --project-ref ytnsipxxmzgaebkqmokp`
       Smoke test: `curl -sS https://ytnsipxxmzgaebkqmokp.functions.supabase.co/grandfathered-policy-notice/healthz` → expect 200 + `{"ok":true,"fn":"grandfathered-policy-notice"}`
       DO NOT invoke the POST endpoint — actual campaign send is a Phase 70 UAT operator action.

    4. Verify Fn lists ACTIVE: `npx supabase functions list --project-ref ytnsipxxmzgaebkqmokp | grep -E "privacy-optout-process|grandfathered-policy-notice"` — expect both rows with status ACTIVE.

    5. If deploy fails with `--import-map silently ignored` per [[reference_supabase_functions_deploy_import_map_flag]]: check per-function deno.json import map is present + correctly shapes the npm: prefixes.
  </action>
  <verify>
    <automated>
      curl -sS --max-time 10 https://ytnsipxxmzgaebkqmokp.functions.supabase.co/privacy-optout-process/healthz | grep -q '"ok":true' &amp;&amp;
      curl -sS --max-time 10 https://ytnsipxxmzgaebkqmokp.functions.supabase.co/grandfathered-policy-notice/healthz | grep -q '"ok":true' &amp;&amp;
      cd /Users/karstenhaldan/minisite &amp;&amp;
      npx supabase functions list --project-ref ytnsipxxmzgaebkqmokp | grep -c -E "privacy-optout-process|grandfathered-policy-notice" | awk '{ if ($1 &lt; 2) { print "MISSING Fns"; exit 1 } else print "OK 2 Fns ACTIVE" }'
    </automated>
  </verify>
  <done>
    Both Edge Fns deployed ACTIVE; healthz returns 200; secrets set; placeholder runtime guard satisfied.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Phase 64 surfaces are deployed to staging. axe-core WCAG 2.2 AA re-audit is the final LEGAL-07 conformance gate before sign-off.

    Surfaces shipped this phase:
    - PrivacyPolicy.tsx with 5 state addendums (CA/VA/CO/CT/UT) + TOC + What Changed banner + live SubprocessorList
    - TermsOfService.tsx with new UGC content-license + Community Rules + DMCA cross-reference
    - DoNotSellPage at /privacy/do-not-sell with form → privacy-optout-process Fn → fan-out to PostHog + ad_targeting_exclusion + email_lifecycle_exclusion + Resend confirmation
    - AccessibilityPage at /legal/accessibility with WCAG 2.2 AA + ADA Title III copy
    - DMCAPage at /legal/dmca with § 512 takedown procedure
    - DSAR portal at /settings/privacy/dsar extended with state-residency Select + conditional checkboxes
    - Cookie banner updated with Do Not Sell anchor + AUTH-16 sign-in rate-limit mention
    - LegalFooter expanded to 8 link entries
    - public/sitemap.xml lists all legal surfaces
  </what-built>
  <how-to-verify>
    Three multi-signal verification items — approve each independently:

    **Signal A (CLI-runnable inline): axe-core WCAG 2.2 AA re-audit against the cookie banner**
    From a machine with browser + axe-core CLI:
    1. Open staging URL (or `npm run dev` + http://localhost:5173 if staging not yet wired).
    2. Trigger cookie banner: open in Incognito so consent state is fresh.
    3. Run: `npx @axe-core/cli http://localhost:5173 --tags wcag2aa,wcag22aa --rules color-contrast,aria-label,target-size --no-reporter --exit`
    4. Expected: ZERO violations. If violations: triage inline + commit fixes + re-run.
    Resume signal: "axe-core: 0 violations" OR "axe-core: N violations — paste detailed output"

    **Signal B (browser walk-through): legal-surface link audit + DSAR state-residency flow + Do Not Sell submission**
    1. Visit http://localhost:5173/#/legal/privacy — verify TOC sticky on lg+, all 5 state-addendum anchors scroll-to correctly, SubprocessorList renders rows or empty-state.
    2. Visit /#/legal/accessibility + /#/legal/dmca + /#/legal/terms — verify LegalLayout H1 rendering + draft disclaimer + page-specific CTAs ("Submit DMCA notice" mailto, "Report an accessibility issue" mailto).
    3. Visit /privacy/do-not-sell — submit a test request with state=CA + advertising checkbox. Confirm:
       - Modal opens with verbatim copy "Submit this opt-out request? You can change your mind later…"
       - Submit triggers POST to /functions/v1/privacy-optout-process
       - Success state appears with confirmation message
       - Confirmation email arrives at the test email (Resend dashboard inspection)
       - Row appears in privacy_optout_requests + ad_targeting_exclusion + email_lifecycle_exclusion (admin SELECT)
    4. Visit /settings/privacy/dsar (signed in) — select state=UT, verify ONLY 2 checkboxes show (deletion + access — narrower per UT-UCPA). Switch to state=CO, verify 6 checkboxes (incl. opt_in_sensitive).
    Resume signal: "all surfaces verified" OR "issue at step N: …"

    **Signal C (deferred — Phase 70 UAT acknowledgment): operator action items**
    Confirm operator has been briefed on Phase 70 UAT items:
    - Manually invoke `grandfathered-policy-notice` Fn at the chosen ship date
    - Register DMCA agent with U.S. Copyright Office (DMCA Designated Agent Directory)
    - Configure Resend Inbound routing for abuse@leanshot.app → legal@leanshot.app
    - Legal counsel reviews state-addendum draft copy + adjusts inline
    - Re-publish staging → flip ship date constant if needed
    Resume signal: "Phase 70 carry-over acknowledged" OR list specific items still ambiguous
  </how-to-verify>
  <resume-signal>
    Approve each signal independently (A / B / C) OR describe issues. Partial approval is fine — pending items move to CARRY-OVER.
  </resume-signal>
</task>

<task type="auto">
  <name>Task 3: Update ROADMAP + STATE + REQUIREMENTS; write SUMMARY + CARRY-OVER + VERIFICATION</name>
  <files>
    .planning/ROADMAP.md,
    .planning/STATE.md,
    .planning/REQUIREMENTS.md,
    .planning/phases/64-legal-refresh/64-CARRY-OVER.md,
    .planning/phases/64-legal-refresh/64-SUMMARY.md,
    .planning/phases/64-legal-refresh/64-VERIFICATION.md
  </files>
  <action>
    ROADMAP.md — find "### Phase 64: Legal Refresh" section. Change the line `**Plans**: 8 plans` to checked plan list. Add `**Status**: Complete (YYYY-MM-DD)`. Per [[feedback_roadmap_format_variance_close_out_check]] grep with `grep -c '^- \[ \] 64-' .planning/ROADMAP.md` BEFORE attempting to flip checkboxes — if 0, the file uses summary format (no per-plan checkbox bullets) and only the Status line needs update.

    STATE.md — manual edit per [[reference_state_complete_phase_writes_wrong_counters]] (do NOT use gsd-sdk state.complete-phase verb which writes wrong counters):
    - `completed_phases: 12` (was 11; +1 for Phase 64)
    - `completed_plans: 72` (was 64; +8 for Phase 64's 8 plans)
    - `percent: 93+` recalc (12/20 = 60 — verify formula; if existing STATE used per-plan-weighted, follow that formula)
    - Update `**Status:** Phase 62 COMPLETE` → `**Status:** Phase 64 COMPLETE (2026-MM-DD)`
    - Update `**Current Position:** Phase 62 …` → `**Current Position:** Phase 64 COMPLETE — Legal Refresh shipped: 5 migrations + 2 Edge Fns + 3 new legal pages + DSAR state-flavor extension + PrivacyPolicy/ToS extensions + cookie banner CPRA update`
    - Update `**Last completed:** …` → `**Last completed:** Phase 64 close-out (2026-MM-DD). Plan 08 inline.`

    REQUIREMENTS.md — find LEGAL-01 through LEGAL-10 rows in the requirement-status table (line 444-453). Flip status from `Pending` to `Complete (Phase 64)` for all 10. For AUTH-16 (line ~469) — leave status as Phase 66 owner BUT add a cross-reference note `(LEGAL-07 cross-ref delivered Phase 64; full implementation in Phase 66)`.

    Write `.planning/phases/64-legal-refresh/64-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. Include: phase intent recap, list of 8 plans + their key outputs, list of remote migrations applied, list of deployed Fns, axe-core re-audit result, operator-action carry-over summary.

    Write `.planning/phases/64-legal-refresh/64-CARRY-OVER.md` documenting Phase 70 UAT items per CONTEXT D-Grandfathered-Notice-Email + D-DMCA:
    - **Operator-invoke** `grandfathered-policy-notice` Edge Fn (POST with service-role bearer) on chosen campaign date
    - **DMCA agent registration** with U.S. Copyright Office (Designated Agent Directory at https://www.copyright.gov/dmca-directory/) — update DMCAPage placeholder copy with registered agent name + address once filed
    - **Resend Inbound** routing config for `abuse@leanshot.app` → forward to `legal@leanshot.app` + auto-acknowledge sender
    - **Legal counsel review** of state-addendum + ToS UGC + Accessibility + DMCA draft copy; counsel edits applied inline
    - **PHYSICAL_ADDRESS** env var: confirm operator's real LeanShot LLC address is set (not [placeholder])
    - **PHASE_64_SHIP_DATE** env var: operator confirms cutoff date for grandfathered-notice query

    Write `.planning/phases/64-legal-refresh/64-VERIFICATION.md` capturing the multi-signal checkpoint outcomes from Task 2 (this plan's checkpoint task). Each signal A/B/C as a sub-section with date + verifier + outcome + any issues.

    All three docs commit together with message `docs(64): close out phase 64 legal refresh`.
  </action>
  <verify>
    <automated>
      cd /Users/karstenhaldan/minisite/leanshot &amp;&amp;
      grep -q "Phase 64 COMPLETE\|Phase 64.*complete" .planning/STATE.md &amp;&amp;
      grep -E "LEGAL-(01|02|03|04|05|06|07|08|09|10).*Complete \(Phase 64\)" .planning/REQUIREMENTS.md | wc -l | awk '{ if ($1 &lt; 10) { print "MISSING LEGAL-* updates"; exit 1 } else print "OK 10 LEGAL- requirements marked complete" }' &amp;&amp;
      test -f .planning/phases/64-legal-refresh/64-SUMMARY.md &amp;&amp;
      test -f .planning/phases/64-legal-refresh/64-CARRY-OVER.md &amp;&amp;
      test -f .planning/phases/64-legal-refresh/64-VERIFICATION.md &amp;&amp;
      grep -q "grandfathered-policy-notice" .planning/phases/64-legal-refresh/64-CARRY-OVER.md &amp;&amp;
      grep -q "DMCA agent\|Copyright Office" .planning/phases/64-legal-refresh/64-CARRY-OVER.md
    </automated>
  </verify>
  <done>
    ROADMAP + STATE + REQUIREMENTS reflect Phase 64 complete with all 10 LEGAL- IDs flipped. SUMMARY + CARRY-OVER + VERIFICATION docs written + committed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator → supabase CLI (db push + functions deploy) | service-role privileged ops via SUPABASE_ACCESS_TOKEN |
| operator → axe-core CLI run | local browser run; no transport |
| operator → docs commit | git commit + push |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-64-08-01 | Tampering | back-dated migration block silently halts push of OTHER pending migrations | mitigate | Per [[reference_supabase_back_dated_migration_blocks_push]]: Task 1 step 3 inspects `npx supabase migration list --linked` BEFORE push; if mismatch found, apply rescue recipe (mv → push → restore) before continuing |
| T-64-08-02 | Tampering | gsd-sdk state.complete-phase writes wrong counters | mitigate | Task 3 uses MANUAL STATE.md edit per [[reference_state_complete_phase_writes_wrong_counters]] — never invoke the sdk verb |
| T-64-08-03 | Information Disclosure | PHYSICAL_ADDRESS [placeholder] ships to prod via grandfathered-notice — CAN-SPAM violation | mitigate | Task 2 step 1 rejects PHYSICAL_ADDRESS value matching `/\[|TODO|REPLACE_ME/` before secrets set; runtime guard in Fn body (Plan 64-03) provides defense-in-depth |
| T-64-08-04 | Spoofing | unauthorized actor invokes grandfathered-policy-notice POST endpoint | mitigate | Fn (Plan 64-03) requires service-role bearer; Phase 70 UAT operator action is the only legitimate invocation; deploy this plan does NOT invoke the POST |
| T-64-08-05 | Repudiation | axe-core results not recorded — LEGAL-07 conformance unverifiable later | mitigate | Task 3 VERIFICATION.md records axe-core run outcome verbatim (output paste OR "0 violations" attestation) |
| T-64-08-SC | Tampering | npm install during functions deploy | mitigate | functions deploy uses already-audited deno.json import map; no `npm install` runs in this Plan |
</threat_model>

<verification>
- 5 migrations show up in `npx supabase migration list --linked` for project ytnsipxxmzgaebkqmokp with timestamps 20290103000001..20290103000005
- 2 Edge Fns visible in `npx supabase functions list` with status ACTIVE
- /healthz endpoints return 200 + correct JSON for both Fns
- axe-core re-audit recorded in VERIFICATION.md (0 violations or remediations)
- ROADMAP/STATE/REQUIREMENTS reflect Phase 64 complete with 10 LEGAL- IDs flipped
- SUMMARY + CARRY-OVER + VERIFICATION docs present + committed
</verification>

<success_criteria>
- All 5 Plan 64-01 migrations applied; 2 Plan 64-02/03 Fns deployed ACTIVE
- axe-core WCAG 2.2 AA re-audit yields 0 violations (or remediations applied + re-verified)
- ROADMAP Phase 64 row marked complete; STATE.md counters updated manually; REQUIREMENTS.md 10 LEGAL- IDs flipped
- CARRY-OVER documents 5 operator-action items for Phase 70 UAT
- VERIFICATION captures the 3-signal checkpoint outcome
- Phase advances to Phase 65 (Stripe Tax + Payment Resilience) per ROADMAP
</success_criteria>

<output>
Plan 64-08 close-out is the phase-level close-out — write `.planning/phases/64-legal-refresh/64-SUMMARY.md` (phase summary, not plan-08 summary; convention: 64-SUMMARY.md serves as both close-out and phase recap). Optional: also write `.planning/phases/64-legal-refresh/64-08-SUMMARY.md` if the orchestrator wants per-plan SUMMARYs to remain uniform.
</output>
