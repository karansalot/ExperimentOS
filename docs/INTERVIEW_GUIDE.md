# Interview guide

The decisions behind ExperimentOS, the trade-offs taken, and the questions they tend to raise. Figures are full-dataset results from [INSIGHTS.md](INSIGHTS.md) and [RESULTS.md](RESULTS.md).

## The one-minute story

"I took Criteo's 14-million-user advertising holdout experiment and built the full analysis platform around it: ingestion, a SQL layer, an experimentation engine, uplift models, a decision simulator and a dashboard. The headline isn't 'ads work'. Ads do work, about +1 point on visit rate. What matters is that the raw comparison overstates the effect by about 28%, because the two arms turned out not to be perfectly comparable. And 10% of users deliver 83% of the incremental visits, so blanket advertising loses money where targeting the top 14% makes it pay. Every number is reproducible, tested against ground truth, and labelled by the data it came from."

## Decisions worth defending

| Decision | Why | Trade-off accepted |
|---|---|---|
| Check randomisation before trusting the difference | With 14M users, a classifier detects imbalance invisible to SMDs (AUC 0.510, all SMDs < 0.05) | Two numbers to explain instead of one |
| Report the doubly-robust effect as the planning number | Lin regression and AIPW agree (+0.77 / +0.75 pp), so the correction is not one model's artefact | Corrects observed features only; I cannot rule out selection on outcomes during the publisher's sub-sampling |
| Intent-to-treat, never exposed vs unexposed | Exposure is post-treatment (3.6% of treated); comparing on it conditions on an outcome | Effect per exposed user only via the Wald estimator, under the exclusion restriction |
| Hash-based splits on row position | The file is stored in single-arm blocks, so sequential splits would put whole regimes in one split | None; the hash is specified in code, so splits are version-independent |
| Statistics on sufficient statistics | Exact on 14M rows, fast, and the same function serves one segment or the whole file | statsmodels becomes a test oracle rather than the runtime |
| Paired Poisson bootstrap over test users | Every model is scored on the same resamples, so "model A beats B" gets its own interval | Model-fitting variance is not included (fixed models) |
| Choose coverage on validation, report profit on test | Optimising and measuring on the same curve inflates profit | The validation split also needs a bootstrap, which roughly doubles evaluation time |
| A response model as a first-class baseline | It is what most teams already have; uplift modelling has to beat *that*, not random | The uplift story is less dramatic: +8% for visits, worse for conversions |
| No causal forest, no EconML | The two-model, T- and S-learner comparison already answers the targeting question | One fewer buzzword |
| DuckDB, not Spark or Postgres | A 14M-row analytical workload fits a laptop; SQL stays portable | Not a distributed design, and doesn't claim to be |
| Artifacts as files, API reads only aggregates | Reproducible, diffable, deployable without the dataset; the browser never sees rows | Retraining from the UI is limited to the development sample |

## Questions you will probably get

**"Isn't 28% too big a correction for an AUC of 0.51?"** Small imbalance times a large outcome gradient can still move the estimate. Visit rate varies several-fold across sub-populations in this file (SQL query 11), so a slight compositional difference between arms matters. Two estimators built on different models agree, and on synthetic data where the truth is known both recover it while the naive difference does not.

**"Why trust the uplift model?"** Three reasons. It is evaluated on users it never saw. Its advantage over the response baseline has a paired bootstrap interval that excludes zero. And its predicted segment uplift matches observed doubly-robust uplift with correlation 0.99, so it learned real heterogeneity rather than noise.

**"Why does the response model do so well?"** Here the users most likely to visit are also the most persuadable. That is a property of this dataset, and the reason the dashboard shows both models side by side instead of assuming uplift modelling wins.

**"How would you run the next test?"** Randomise targeted vs blanket vs holdout on fresh users. The planner says a 5% relative lift on visits needs about 324K users at 50/50 or 639K at 85/15. Pre-register the doubly-robust estimator, which removes about 20% of variance and so acts like a 1.24× larger test. If stakeholders want to look early, use an O'Brien-Fleming boundary: ten naive looks would inflate false positives from 5% to about 19%.

**"What would break this in production?"** Drift in who is eligible, interference between users (the analysis assumes none), novelty effects that the data cannot show without timestamps, and the gap between this privacy-subsampled file and a live campaign's true incrementality.

**"What did you get wrong along the way?"** Three bugs, each caught by a check rather than by luck:
- An ingest join wrote a duplicate `row_id` column. A schema test caught it.
- A heterogeneity p-value of exactly 0.0 was being treated as missing and Holm-adjusted to 1. Fixed, and a regression test added.
- The first power formula used one variance for both hypotheses. A simulation test showed 76.5% power where 80% was promised under 85/15 allocation, and the formula was corrected to pooled-null / unpooled-alternative.

## Where to point during a live demo

1. **Insights:** the ten findings and the concentration chart.
2. **Diagnostics:** the three estimators disagreeing, and why.
3. **Model lab → Explainability:** the scatter on the diagonal.
4. **Simulator:** change cost, watch coverage and break-even move, read the deployable rule.
5. **Sequential lab:** drag looks from 1 to 30.
6. **SQL:** the file-order query, which shows why `LIMIT n` would have been a disaster.
