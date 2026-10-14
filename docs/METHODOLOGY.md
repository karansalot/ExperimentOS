# Methodology

How ExperimentOS turns the Criteo uplift file into an experiment read-out and a targeting decision, what each number means, and what it does not license you to conclude. Computed values live in [RESULTS.md](RESULTS.md); this document explains the methods.

## 1. The experiment and the estimand

The dataset assembles several *incrementality tests*: a random part of the population is prevented from being targeted by advertising. Each row is a user with 12 anonymised features, a `treatment` flag (1 = eligible for advertising, 0 = held out), two outcomes (`visit`, `conversion`) and an `exposure` flag (the user was effectively shown advertising).

- **Estimand: intent-to-treat (ITT).** The effect of being *assigned* to treatment on the probability of a visit or conversion. Arms are always compared as assigned.
- **Exposure is a post-treatment variable.** Only 3.6% of treated users were exposed and none of the control users were. Comparing exposed with unexposed users would condition on an outcome of assignment and is biased; ExperimentOS never does it.
- **Design ratio.** The dataset card documents a treatment ratio of 0.85, used as the expected split in the sample-ratio check.

## 2. Data engineering

1. **Download** is pinned to a Hugging Face commit and refused unless the SHA-256 matches `config.DATASET["raw_sha256"]`.
2. **Schema validation** checks column names, order and types before anything is read; label columns are cast to `UTINYINT`, which fails loudly on a non-integer.
3. **Parquet** files are written with an added `row_id` (0-based file position) and two hash buckets.
4. **Splits and sample** come from a salted splitmix64 hash of `row_id` (`data/hashing.py`): buckets 0-59 train, 60-79 validation, 80-99 test; `sample_bucket < 5` is the development sample. The hash is specified in the code, so splits do not depend on library versions, and a row is in exactly one split.
5. **Why hashing matters here.** The raw file is ordered in contiguous single-arm blocks drawn from visibly different sub-populations (SQL query 11). Any sequential split or sample would be biased.

## 3. Experimentation statistics

All tests work on counts (sufficient statistics) produced by the SQL layer, so they are exact on all 14M rows.

| Quantity | Method | Notes |
|---|---|---|
| Absolute effect | difference in proportions | 95% **Newcombe hybrid-score** interval (better coverage than Wald for rare outcomes); the Wald interval is also stored |
| Relative effect | risk ratio − 1 | interval on the log scale (Katz), back-transformed |
| Hypothesis test | two-sided pooled two-proportion z-test | equivalent to the 1-df chi-square test |
| Two outcomes | Holm adjustment across visit and conversion | controls family-wise error |
| Sample ratio mismatch | chi-square goodness of fit against 85/15, alarm at p < 0.001 | the strict threshold is the industry convention for a check run on every experiment |
| Minimum detectable effect | two-sided, α = 0.05, power 0.8 | a design read-out: what this sample size could have detected |
| Effect per exposed user | Wald / instrumental-variable estimator, ITT ÷ exposure rate, delta-method SE | requires the exclusion restriction; see below |

**Reading significance at this scale.** With 14M users almost any difference has p < 0.0001. The dashboard therefore leads with effect sizes and intervals and says so explicitly.

### Covariate balance

Randomisation implies pre-treatment features have the same distribution in both arms. Three checks, in increasing sensitivity:

1. **Standardised mean differences** per feature, with a Welch z-test and Holm adjustment. The conventional "acceptable" threshold is |SMD| < 0.1.
2. **Omnibus F-test**: OLS of treatment on all 12 features; under randomisation F ~ F(k, n−k−1). Computed from streamed sufficient statistics.
3. **Classifier two-sample test**: a cross-fitted gradient-boosting model predicts assignment; out-of-fold AUC should be 0.5. This catches non-linear and interaction imbalance.

In this file all SMDs are below 0.05, yet every feature differs significantly and the AUC is 0.510. The verdict is therefore **"caution"**: small in magnitude, but assignment is not independent of the features. Plausible causes are pooling several tests with different populations and treatment ratios, and the publisher's non-uniform privacy sub-sampling. Neither can be verified because the file has no test identifier.

### Covariate-adjusted estimators

Because of that imbalance, two adjusted estimators are reported next to the raw difference:

- **Regression adjustment (Lin 2013).** OLS of the outcome on treatment, centred features and their interactions; the treatment coefficient is the ATE; HC1 robust standard errors. Two streaming passes over the data.
- **AIPW / doubly robust.** Cross-fitted (2 folds, hash-assigned) gradient-boosting models for the propensity e(x) and the outcome surfaces μ₁(x), μ₀(x). The estimate is the mean of
  ψᵢ = μ₁ − μ₀ + T(Y − μ₁)/e − (1 − T)(Y − μ₀)/(1 − e),
  with standard error sd(ψ)/√n and propensities clipped to [0.05, 0.95]. It is consistent if either the propensity or the outcome model is right.

Both are validated in the test suite: the Lin estimator matches statsmodels to 1e-6, and both recover a known effect on synthetic data where the naive difference is biased. If the three estimators agree, the raw number is safe; here they do not (adjusted visit effect is about 28% lower), and the dashboard shows all three.

Adjustment corrects for the 12 observed features only. If the imbalance came from selection on outcomes during sub-sampling, no covariate adjustment fully repairs it. This is why the conclusion is phrased as "positive under every estimator, magnitude uncertain".

### Segment-level effects

Features are zero-inflated: one modal value holds 26-99% of users. `NTILE` would split ties arbitrarily, so segments are **modal value** plus **user-weighted terciles of the remaining values**, built with window functions over pre-aggregated counts. Segments depend only on pre-treatment values, never on outcomes.

For each outcome: 45 segment tests (three features have fewer than four populated segments), each with a Newcombe interval and raw, Benjamini-Hochberg (FDR) and Holm (FWER) p-values; per feature a **Cochran Q** test for effect heterogeneity with I², Holm-adjusted across the 12 features. Segments with fewer than 1,000 control users are flagged.

Each segment also carries a **covariate-adjusted effect**: the mean cross-fitted doubly-robust score ψ among the segment's users, with mean ± 1.96 SE. It is computed in DuckDB by joining rows to their saved nuisance predictions, and a test checks it against the Python scores. The p-values and the heterogeneity test refer to the unadjusted effect. Segment effects are descriptive.

## 4. Uplift modelling

| Strategy | Score used to rank users |
|---|---|
| Random targeting | none; expected gain is the average effect × share treated |
| Response propensity | P(outcome \| treated, x): who is likely to respond, ignoring what they would do anyway |
| Two-model (logistic) | μ₁(x) − μ₀(x) from two logistic regressions on standardised features |
| T-learner (GBM) | the same construction with gradient-boosted trees |
| S-learner (GBM) | f(x, T=1) − f(x, T=0) from one gradient-boosted model with treatment as a feature |

"Two-model" and "T-learner" are the same construction; they are kept separate here by base learner (linear vs boosted) so the comparison shows what flexibility buys. No causal forest is trained: it would not change the decision and EconML/CausalML are not dependencies.

### Leakage controls

- Models are fitted on train rows only. The champion is the uplift-estimating model with the highest validation gain over random. Test is used once, for reporting.
- Early stopping uses an internal hold-out of the *training* rows.
- Doubly-robust evaluation scores are cross-fitted, so no row is scored by a nuisance model that saw it.
- Ties in model scores are broken by a seeded random key, not by file order.
- Each model has a version id: a hash of dataset checksum, scope, split rule, outcome, hyper-parameters, seed, code and scikit-learn version.

### Metrics

Rank test users by score, treat the top fraction φ.

- **Cumulative gain (uplift curve)** G(φ): incremental outcomes per user in the population when the top φ is treated.
  - *Unadjusted:* (treated rate − control rate within the top φ) × φ.
  - *Adjusted:* Σ ψᵢ over the top φ ÷ N, using the doubly-robust scores above.
- **Qini curve** (Radcliffe): Q(φ) = (Yₜ(φ) − Y꜀(φ)·Nₜ(φ)/N꜀(φ)) / Nₜ. Always unadjusted.
- **AUUC**: area under G over φ ∈ [0, 1].
- **Gain over random**: AUUC minus the area under the random line, i.e. the average advantage over all targeting depths. **Qini coefficient** is the same for the Qini curve. No "perfect model" normalisation is used, because the perfect curve is not identified for binary outcomes.
- **Uplift@k**: average effect per user among the top k%.
- **Calibration**: within deciles of predicted uplift, mean prediction vs observed uplift (unadjusted difference in rates and adjusted mean ψ, each with a standard error).
- **Outcome-model diagnostics**: AUC, log-loss, Brier and a reliability table per component model.

**Uncertainty.** A paired Poisson bootstrap over test users (200 replicates; identical resamples for every strategy) gives 95% percentile intervals for curves and metrics, intervals for the *difference* between each model and the response baseline, and the probability that a model beats it. A model is called better only if that interval excludes zero.

## 5. Decision simulator

Inputs (all user assumptions): population N, treatment cost c per targeted user, value v per incremental outcome, coverage φ, optional budget B, risk tolerance, and effect basis (adjusted or unadjusted).

- Incremental outcomes = N · G(φ); cost = c · N · φ; **profit = v · N · G(φ) − c · N · φ**; ROI = profit ÷ cost.
- **Budget:** coverage is capped at B ÷ (c · N).
- **Risk tolerance:** the recommended coverage maximises expected profit (neutral) or the 25th / 10th percentile of bootstrap profit (moderate / conservative).
- **Break-even:** treating a user pays only if their effect exceeds c ÷ v. Reported: that threshold, the average effect in the targeted group and in the population, and the value and cost at which the chosen coverage breaks even.
- **Sensitivity:** a cost × value grid (0.5× to 2×) at fixed and re-optimised coverage, and one-at-a-time ±25% swings compared with sampling uncertainty.
- **Recommendation** optimises only the selected strategy (the validation-chosen champion by default); it does not pick the best of several models on test profit.
- **Honest coverage selection.** The validation split has its own bootstrapped curves. The recommended coverage maximises the risk criterion on *validation*; the profit, interval and incremental outcomes reported for it come from *test*.
- **Deployable rule.** For each coverage the simulator reports the model score of the last user included on the test split, so a policy reads "treat users whose predicted uplift is at least x".
- **Saved scenarios** are snapshots of assumptions and headline results kept in the browser for side-by-side comparison.

Model evaluation and business assumptions are kept apart: the curves are estimated once from data; costs and values enter only here. Every monetary figure is labelled a scenario estimate.

## 6. Experiment planner

For a future two-arm test the planner uses the same test the platform runs (two-sided pooled two-proportion z-test):

- **Power** for a true absolute effect δ at total sample n and treatment share r: Φ((|δ| − z₁₋α/₂·SE₀)/SE₁), with SE₀ the pooled standard error under H0 and SE₁ the unpooled one under H1. The two differ under unbalanced allocation, so both are used.
- **Required sample:** n = (z₁₋α/₂·√V₀ + z_power·√V₁)² / δ², where V₀ and V₁ are the per-user variances behind SE₀ and SE₁.
- **Minimum detectable effect** inverts the power function by bisection.
- **Allocation cost:** required n at the chosen share ÷ required n at 50/50. At 85/15 it is about 1.97×.

A test simulates experiments at the computed sample size and checks that the realised rejection rate matches the requested power. The planner assumes one primary outcome, a single final analysis and independent users; sequential looks or several primary metrics need more.

## 7. Further read-outs

### Bayesian analysis
Independent Beta(1, 1) priors on each arm's rate; posteriors sampled with a fixed seed (200,000 draws in the API). Reported: P(treatment better), credible intervals for absolute and relative lift, P(relative lift > threshold), and expected loss: the average rate given up if the chosen arm is actually worse. With this much data the prior is irrelevant and the credible interval matches the confidence interval; a test checks that agreement. The posterior is unadjusted, so it inherits the arm imbalance.

### Variance reduction (CUPED-style)
Regression adjustment on pre-treatment covariates is the general form of CUPED. Reported: 1 − (SE_adjusted / SE_unadjusted)² and the equivalent sample-size multiplier. For visits, adjustment removes about 20% of variance, worth a 1.24× larger experiment. For conversions it removes about 2%.

### Sequential testing
The data has no timestamps, so this is a design simulation, not a re-analysis. Under H0 the z statistic at information fraction t behaves like B(t)/√t for a standard Brownian motion B. Paths are simulated at K equally spaced looks. Pocock (constant) and O'Brien-Fleming (c·√(K/k)) boundaries are calibrated by bisection to overall α on one simulated null sample, and their error rates are measured on a fresh one. Power and expected sample fraction are reported for the effect the fixed-horizon test is powered to detect. Tests check the published constants for K = 10 (Pocock 2.555, O'Brien-Fleming final 2.087).

### Explainability
For each outcome's champion model, on the test split:
- **Permutation importance:** drop in covariate-adjusted gain over random when one feature is shuffled. Computed on a seeded sample of 300,000 test users with two shuffles each, because every shuffle re-scores all users. The sample is labelled in the UI and the reports.
- **Segment agreement:** mean predicted uplift vs mean doubly-robust score for each of the 45 feature segments, summarised by correlation and a size-weighted mean absolute gap.
- **Persuadables profile:** the top 10% by predicted uplift vs everyone else, as standardised differences and share off each feature's modal value.

## 8. Limitations

1. **Privacy sub-sampling.** The publisher states the original incrementality level cannot be deduced. Effect sizes describe this file.
2. **Pooled tests without identifiers.** No test id, timestamp or user id: no per-test analysis, no novelty or seasonality checks, no clustering by user.
3. **Imperfect balance.** Adjustment handles observed features only.
4. **Anonymised features.** Segments are actionable but not interpretable.
5. **Exclusion restriction** for the per-exposed-user effect is an assumption, not a finding.
6. **External validity.** Models are tested on a held-out split of the same data, not on a later campaign.
7. **No financial data.** Profit figures are arithmetic on user assumptions.
8. **Per-strategy "best coverage"** in the comparison table is chosen on validation for every strategy, but comparing those optima across strategies on test is still a mild form of selection.
