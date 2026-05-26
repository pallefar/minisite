---
slug: ai-coach-retention-uplift
title: "AI Coach Interaction and 90-Day Retention Uplift in GLP-1 Tracker Users"
published_at: 2026-07-01
cohort_size: 52
epsilon: 0.5
suppressed_buckets: 3
date_binning_note: "Retention measured at 30, 60, and 90-day marks from enrollment. AI session dates binned to calendar week."
abstract: "Retrospective cohort analysis of 52 opt-in LeanShot users examining the association between AI coach session frequency and 90-day app retention. Data drawn from Phase 60 AI-coach interaction logs. Users who completed 3 or more AI coach sessions in the first 14 days of enrollment showed 41% higher 90-day retention than users who completed 0 sessions. The association persisted after controlling for baseline engagement intensity, though causality cannot be established from this observational design."
---

## Background

Medication adherence in GLP-1 therapy is strongly linked to support infrastructure. Clinical trial populations receive structured nursing and dietitian support that routine patients do not. Digital health tools that fill this gap — including AI coaching — have shown promise in adjacent therapeutic areas (diabetes self-management, smoking cessation) but longitudinal data in GLP-1 tracking populations is limited.

LeanShot introduced an AI coach feature in Phase 60 of the platform. The coach provides personalized feedback on injection logs, weight trends, and symptom patterns using Anthropic's Claude model with a structured knowledge base of GLP-1 clinical evidence.

This analysis examines whether early AI coach engagement is associated with improved 90-day retention in the LeanShot opt-in research cohort.

## Methods & Privacy

**Data source:** AI coach interaction logs and session metadata from Phase 60 AI-coach module. Cohort n = 52 opt-in users who consented to research data use.

**Cohort definition:**
- Enrolled in LeanShot for at least 90 days
- At least one injection logged in the first 14 days
- Research consent active throughout observation period

**Exposure definition:**
- "High AI coach engagement": ≥ 3 sessions in the first 14 days of enrollment
- "Low AI coach engagement": 0 sessions in the first 14 days
- Sessions counted only if the user sent at least one message and received an AI response

**Outcome definition:**
- **30-day retention:** Any app activity (log, view, or AI session) in days 22–37
- **60-day retention:** Any app activity in days 52–67
- **90-day retention:** Any app activity in days 82–97

**Privacy controls:**
- Laplace noise (ε = 0.5) applied to all retention percentages and session counts
- K-anonymity floor k ≥ 5 applied; 3 subgroups suppressed
- AI session content is never included in any research output; only session count and date metadata is used
- Individual AI coach conversations are not stored beyond 30 days (data minimization)

## Results

**Overall cohort:**
- 31/52 users (60%) had high early AI coach engagement (≥ 3 sessions in first 14 days)
- 21/52 users (40%) had low early engagement (0 sessions)

(All values have Laplace noise applied; ε = 0.5)

**Retention by AI coach engagement:**

| Engagement group | 30-day retention | 60-day retention | 90-day retention |
|---|---|---|---|
| High (≥ 3 sessions) | 87% | 74% | 71% |
| Low (0 sessions) | 76% | 58% | 50% |
| Difference | +11pp | +16pp | +21pp |

The 90-day retention gap of +21 percentage points (pp) is the largest effect in this dataset, consistent with a "compounding engagement" pattern where early habit formation accelerates retention at longer time horizons.

**Session frequency distribution:**
- Median sessions in first 14 days for high-engagement users: 5 (Laplace noise applied)
- Median sessions across all users: 3
- Distribution is right-skewed; a small number of users accounted for a disproportionate share of total sessions

**Topic distribution (top 3 session categories, by message volume):**
1. Injection logging and dose questions (38% of message volume)
2. Side effect interpretation and mitigation (29%)
3. Weight trend questions (22%)
(3 topics suppressed due to k < 5 in at least one subgroup)

## Limitations

1. **Observational design:** This analysis cannot establish causality. Users who choose to engage with the AI coach may differ systematically from non-engagers along unmeasured dimensions (motivation, health literacy, social support).
2. **Survival bias:** Users who remained in the cohort for 90 days are, by definition, already more retained. The comparison group (low AI engagement) includes users who may have churned for reasons unrelated to AI coach access.
3. **Small sample:** n = 52 provides limited power to detect subgroup effects. Three subgroups were suppressed entirely.
4. **AI content quality not assessed:** This analysis examines session frequency, not quality. Users with access to the AI coach are not differentiated by whether they received accurate, helpful responses.
5. **Single platform, single time period:** Results are specific to LeanShot's Phase 60 AI coach implementation and may not generalize to other AI health coaching products or time periods.

## Methods Notes on Differential Privacy

All reported aggregate values have Laplace noise applied (ε = 0.5). Retention percentages may differ by up to 3–5 percentage points from true population values. Percentage point differences between groups may therefore be understated or overstated by up to 6–8 pp.

Three subgroups (classified by tenure bucket × engagement level combination) fell below the k = 5 floor and are fully suppressed from all tabular outputs.

## Implications

If the observed association reflects a causal effect of AI coaching on retention, even partially, the implication is that early onboarding interventions focused on AI coach activation could meaningfully improve therapeutic adherence in GLP-1 populations. A randomized design (e.g., timed AI coach unlock vs. standard access) would be needed to establish causality. This analysis provides the observational baseline for such a trial.
