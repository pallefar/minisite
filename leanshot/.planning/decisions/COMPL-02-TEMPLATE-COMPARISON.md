# COMPL-02 Template Comparison — Termly vs iubenda vs RCW 19.373 (hand-rolled)

**Decision date:** 2026-05-12
**Decision owner:** Karsten Haldan (founder, per 07-CONTEXT.md D-01 self-draft)
**Outcome:** Hand-roll the Consumer Health Data Privacy notice (CHDP) from RCW 19.373.030; use Termly and iubenda outputs only as a cross-reference sanity check.

## Sources evaluated

Three sources were evaluated as drafting candidates for the WMHMDA-mandated CHDP:

1. **Termly free tier** — a privacy-policy generator with a WMHMDA-aware questionnaire. Free tier exposes the WMHMDA module behind email registration.
2. **iubenda free tier** — a privacy-policy generator with a general data-collection wizard and an add-on for "consumer health data". Free tier limits the policy length and reorders sections; WMHMDA-specific anchors land in a paid module.
3. **RCW 19.373 primary statute text** — Washington Revised Code 19.373.030(1)(b)(i)–(v) lists the five mandatory structural disclosures verbatim. Treated as the authoritative source.

Per memory `feedback_aggressive_foundations.md`, the founder defaulted to maximum-coverage on a compliance foundation rather than a minimum-viable generator output.

## What each template covers

### Termly free tier

Termly's WMHMDA module produces a notice with the five structural disclosures, but the free-tier output:

- Folds **§4 Third parties** into the broader privacy-policy "data sharing" section rather than emitting it as a structurally distinct H2 — RCW 19.373.030(1)(b)(iv) treats third-party disclosure as its own anchor and a regulator scanning headings for compliance will not see it as a discrete anchor in Termly free output.
- Includes default "we may sell consumer health data" boilerplate that has to be edited out manually; if the editor misses the toggle the published notice asserts a practice that does not exist (T-07-03-02 risk).
- Names "advertising partners" and "data analytics providers" as generic processor categories rather than naming specific subprocessors. WMHMDA RCW 19.373.030(1)(b)(iv) requires the third parties be named, not categorised.
- Does not include a verbatim "private right of action" string. RCW 19.373.900 grants this right and the literal phrase is the load-bearing keyword in any future plaintiff search.
- Per Researcher Key Finding #7 ("Termly free skips some statute-required anchors"), the gap is structural, not just cosmetic.

### iubenda free tier

iubenda's free output:

- Produces a single "privacy policy" with a "California Notice / Washington Notice" appendix rather than a stand-alone CHDP. RCW 19.373.030 requires a separate, conspicuous link from the homepage — burying the CHDP inside the general privacy policy partially defeats the conspicuous-link requirement.
- Limits free-tier policy length, which (depending on the size of the data-category list) can truncate the §1 enumeration.
- Treats "subprocessors" as a paid feature and does not name them in the free output. Same naming gap as Termly.
- Does not natively split CHD vs non-CHD data categories; the entire data-collection list is presented as a single block, which obscures the WMHMDA scope.

### RCW 19.373.030 primary text

The statute itself lists five structural disclosures (§030(1)(b)(i)–(v)) plus the §030(2)–(3) "conspicuous link" and "separate from the general privacy policy" surface requirements. Authoring directly from the statute lets the page:

- Use the statutory phrasing verbatim as section headings (the five H2 anchors in `ConsumerHealthData.tsx`), which makes a regulatory diff-against-statute audit trivial.
- Name our actual subprocessors (Supabase, Moonshot AI, PostHog, Sentry, Vercel) by entity name rather than by category, satisfying RCW 19.373.030(1)(b)(iv).
- Truthfully assert "we do not sell consumer health data" rather than starting from a template that defaults to the opposite.
- Bind the rendered data-category list to source-of-truth code (the `DATA_CATEGORIES` manifest in `src/lib/legal/data-categories.ts`) so the policy cannot silently drift from the codebase. Neither generator emits machine-readable category metadata that we could pin a CI test to.

## Why hand-rolled won

Hand-rolled wins on four axes:

1. **Statute fidelity** — every H2 anchor maps 1-to-1 to RCW 19.373.030(1)(b)(i)–(v). A regulator can hold the statute next to the page and check off compliance line-by-line. Termly's folded §4 and iubenda's appendix-style notice both fail this test.
2. **Truthful subprocessor disclosure** — we name Supabase Inc., Moonshot AI Ltd., PostHog Inc., Functional Software Inc. d/b/a Sentry, and Vercel Inc. explicitly. Neither free generator produces named-entity output without a paid upgrade. RCW 19.373.030(1)(b)(iv) is "third parties," not "categories of third parties."
3. **Practice-consistent posture** — the hand-rolled notice asserts "we do not sell consumer health data" affirmatively, which matches reality. Template defaults can contradict actual practice if the editor misses a toggle.
4. **Machine-pinned drift gate** — the `DATA_CATEGORIES` manifest plus the e2e content-grep test in `e2e/legal-pages.spec.ts` make policy/code drift a CI failure (T-07-03-03 mitigation). Neither generator exposes a primitive that lets us wire this gate.

## Cross-reference outcome

After drafting from the statute, the Termly and iubenda outputs were compared against the hand-rolled notice as a sanity check rather than as templates. Findings:

- Both generators include a "Contact" section and an "Effective date" line. The hand-rolled notice already has both (footer paragraph + "Last updated" line). No additions required.
- Both generators include a "rights mechanism" section. The hand-rolled §5 covers confirm/access/withdraw/delete/appeal explicitly, which matches RCW 19.373.040.
- Termly suggests a 45-day response window for rights requests. RCW 19.373.060(2) sets 45 days as the maximum; the hand-rolled notice adopts 45 days verbatim.
- Neither generator includes the "30-day undo, then crypto-shred" account-delete mechanism that LeanShot ships per Phase 7 D-03. This is mechanism-specific and would not be present in any generator. The hand-rolled §5 describes it accurately.
- Neither generator distinguishes CHD from non-CHD data categories on the same page. The hand-rolled notice splits them via the `isConsumerHealthData` boolean on the manifest, which is a transparency improvement over both templates.

Conclusion: nothing in the generator outputs needed to be adopted beyond what the statute and primary research already drove. The cross-reference is documented here as the audit trail.

## Risk accepted (per D-01)

Per 07-CONTEXT.md D-01 (LOCKED, counsel model), no attorney was engaged for this document. The founder explicitly accepts:

- Risk of self-drafted statutory interpretation error.
- Risk of a future WMHMDA private-right-of-action plaintiff alleging the hand-rolled notice misses an anchor that a paid template would have caught.
- Risk of a future amendment to RCW 19.373 invalidating the current language — mitigated by the manifest-to-policy drift gate (any future amendment that requires a new disclosure becomes a code change with its own CI gate, not a silent staleness).

If a real privacy incident, paying-clinic contract, or formal complaint surfaces post-launch, the trigger is to spin a Phase 7.5 hardening cycle that funds and runs an attorney review against this hand-rolled draft. Phase 7 itself ships without that gate.

This decision log is the audit trail.
