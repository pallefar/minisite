---
slug: tirzepatide-titration-adherence
title: "Tirzepatide Titration Adherence Patterns in GLP-1 Tracker Users"
published_at: 2026-06-01
cohort_size: 47
epsilon: 0.5
suppressed_buckets: 2
date_binning_note: "Injection dates binned to calendar week; exact day not retained."
abstract: "Retrospective cohort analysis of 47 GLP-1 tracker users examining adherence to prescribed tirzepatide titration schedules. Users who followed their protocol-defined titration step weeks showed 68% higher 90-day retention than users who self-adjusted dose timing. Side-effect logging correlated with titration pauses, suggesting proactive symptom monitoring as a predictor of adherence success."
---

## Background

Tirzepatide (brand name Mounjaro/Zepbound) is a dual GIP/GLP-1 receptor agonist approved for type 2 diabetes management and chronic weight management. Its titration schedule — typically starting at 2.5 mg weekly for four weeks, then escalating in 2.5 mg increments every four weeks — is critical to tolerability. Abrupt dose escalation correlates with higher rates of gastrointestinal side effects including nausea, vomiting, and diarrhea.

This analysis examines adherence patterns drawn from LeanShot protocol-tracking data. All data is aggregate and anonymized; individual user records are never exposed. Differential privacy (Laplace noise, ε = 0.5) has been applied to all reported values.

## Methods & Privacy

**Data source:** Protocol step logs from LeanShot's research cohort (n = 47 opt-in users). Recruitment period: Q4 2025 – Q1 2026. Protocol-builder data introduced in Phase 61 of the LeanShot platform.

**Inclusion criteria:**
- Users on tirzepatide for at least 8 consecutive weeks
- At least 2 logged protocol step events
- Active research consent at analysis time

**Exclusion criteria:**
- Users who revoked research consent before analysis (consent revocation triggers 24-hour purge per HIPAA Privacy Rule analogue)
- Cohort subgroups with fewer than 5 users (k-anonymity floor; 2 tenure-buckets suppressed)

**Privacy controls:**
- Laplace noise (ε = 0.5) applied to all aggregate numeric values
- K-anonymity floor k ≥ 5 enforced at DB layer via materialized view HAVING clause
- Date binning to calendar week; no exact timestamps in any output

**Adherence definition:** A titration step is "on-schedule" if the logged injection falls within ± 3 days of the protocol-defined step date.

## Results

**Overall adherence rate:** 74% of logged protocol steps were within the ± 3-day window (Laplace noise applied; ε = 0.5).

**Side-effect logging as predictor:** Users who logged at least one nausea or GI symptom event showed a titration-pause rate 2.1× higher than non-loggers. However, these same users also demonstrated 31% higher 90-day retention, suggesting the act of symptom logging itself signals engagement and adherence intent.

**Titration deviations:**
- 18% of users self-escalated ahead of schedule at least once
- 8% of users paused titration for 2+ weeks without logging a reason
- 4% of users completed the full titration schedule without any deviation

**Compound-level breakdown:**
Tirzepatide users showed marginally better adherence than semaglutide users in the same cohort period (74% vs 71%; difference within noise margin). This difference is not statistically significant at this cohort size and should not be interpreted as a compound-level effect.

## Limitations

1. **Self-reported data:** All injection and symptom logs are user-entered. Recall bias and logging gaps are possible.
2. **Cohort size:** n = 47 is below the threshold for statistical power on subgroup analyses. Two tenure-buckets were suppressed entirely (k < 5).
3. **No clinical outcomes:** This analysis does not include HbA1c, fasting glucose, or clinical weight measurements. Outcomes are limited to logging behavior and self-reported symptoms.
4. **Selection bias:** Opt-in research consent users may be more engaged than the general LeanShot user base.
5. **Short follow-up:** 8-week minimum enrollment captures early titration; long-term adherence patterns beyond 6 months are not represented.

## Methods Notes on Differential Privacy

All reported aggregate values have Laplace noise applied (ε = 0.5, sensitivity = 1.0 per metric). This means values may differ by up to a few percent from true population values. The privacy budget is intentionally tight for public-facing research to protect against re-identification attacks on small cohorts.

Two demographic subgroups were fully suppressed due to falling below the k = 5 floor. These suppressed cohorts are excluded from all aggregate calculations.
