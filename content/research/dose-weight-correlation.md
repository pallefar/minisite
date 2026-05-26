---
slug: dose-weight-correlation
title: "Weekly Dose-to-Weight-Loss Correlation Across GLP-1 Compounds"
published_at: 2026-06-15
cohort_size: 63
epsilon: 0.5
suppressed_buckets: 1
date_binning_note: "Weight measurements binned to ISO week; injection dates aligned to nearest Sunday of the injection week."
abstract: "Cross-compound analysis of 63 opt-in GLP-1 tracker users examining the relationship between weekly dose levels and self-reported weight change. Aggregate data from Phase 35 dose-logging infrastructure. Semaglutide users at the 1.0 mg/week dose showed the highest correlation between dose stability and weight loss rate (r = 0.61, Laplace noise applied). Tirzepatide users showed wider variance, consistent with the dual-receptor mechanism's heterogeneous response profiles."
---

## Background

GLP-1 receptor agonists reduce body weight through appetite suppression and delayed gastric emptying. The dose-response relationship varies considerably across compounds: semaglutide (Ozempic/Wegovy) acts solely on the GLP-1 receptor, while tirzepatide (Mounjaro/Zepbound) adds GIP receptor agonism, producing greater average weight loss but also higher inter-individual variance.

This analysis uses dose-log data from LeanShot users who opted into research data sharing. The goal is to characterize the dose-to-weight-loss correlation at each titration step across the two most common GLP-1 compounds tracked on the platform.

## Methods & Privacy

**Data source:** Injection logs and weekly weight measurements from LeanShot's research cohort (n = 63). Injection and dose data from the Phase 35 dose-logging module. Weight logs from the body metrics module.

**Compounds included:**
- Semaglutide: doses 0.25 mg, 0.5 mg, 1.0 mg, 1.7 mg, 2.4 mg (weekly)
- Tirzepatide: doses 2.5 mg, 5 mg, 7.5 mg, 10 mg, 12.5 mg, 15 mg (weekly)

**Minimum data per user:** 4 consecutive weeks at the same dose level with at least one weight measurement per week.

**Privacy controls:**
- Laplace noise (ε = 0.5) applied to all aggregate correlation coefficients and mean weight changes
- Date binning to ISO week; no exact injection timestamps
- One subgroup suppressed (k < 5): users at tirzepatide 15 mg with enrollment > 12 months

**Correlation method:** Pearson r between dose level (mg/week) and mean weekly weight change (kg). Weight change computed as 4-week rolling mean to reduce noise from weekly fluctuation.

## Results

**Semaglutide dose-weight correlation (n = 38 users with sufficient data):**

| Dose (mg/week) | Mean weight change/week (kg) | Correlation r | n |
|---|---|---|---|
| 0.25 | -0.19 | 0.38 | 18 |
| 0.5 | -0.31 | 0.49 | 24 |
| 1.0 | -0.44 | 0.61 | 21 |
| 1.7 | -0.51 | 0.58 | 12 |
| 2.4 | -0.48 | 0.55 | 9 |

Note: All values have Laplace noise applied (ε = 0.5). The apparent plateau at 1.7–2.4 mg/week may reflect true diminishing returns or noise from the small sample at higher doses.

**Tirzepatide dose-weight correlation (n = 25 users with sufficient data):**

| Dose (mg/week) | Mean weight change/week (kg) | Correlation r | n |
|---|---|---|---|
| 2.5 | -0.21 | 0.35 | 15 |
| 5.0 | -0.37 | 0.44 | 18 |
| 7.5 | -0.52 | 0.53 | 14 |
| 10.0 | -0.63 | 0.60 | 11 |
| 12.5 | -0.71 | 0.62 | 8 |
| 15.0 | [suppressed, k < 5] | — | — |

The tirzepatide higher-dose rows suggest continued efficacy at 12.5 mg, consistent with clinical trial data. The 15 mg row is suppressed.

**Cross-compound comparison:**
At equivalent titration stages (weeks 8–16 of treatment), tirzepatide users showed 19% greater mean weight change per week than semaglutide users. This difference falls within the Laplace noise margin for this cohort size; it should not be interpreted as a definitive head-to-head efficacy comparison.

## Limitations

1. **Self-reported weight:** Home scale measurements introduce measurement error. No clinic-calibrated weights available.
2. **Dose compliance:** We have no way to verify that logged injections actually occurred. Missing logs are treated as missing data (not as zero-dose weeks).
3. **Confounders not captured:** Dietary intake, activity level, concurrent medications, and metabolic baseline are not included in this analysis.
4. **Short follow-up at high doses:** Most users at the highest dose levels have fewer than 8 weeks of data at that dose, reducing statistical reliability.
5. **Single suppressed bucket:** The tirzepatide 15 mg subgroup (k < 5) is excluded, which may bias the tirzepatide series downward at the high end.

## Methods Notes on Differential Privacy

All reported aggregate values have Laplace noise applied (ε = 0.5). Correlation coefficients have been perturbed by Laplace-drawn noise with sensitivity appropriate to the Pearson r statistic. Values may differ by ± 0.05–0.10 from true population values.

The k-anonymity floor (k ≥ 5) is enforced at the data layer. One subgroup (tirzepatide 15 mg) did not meet this threshold and is fully suppressed.
