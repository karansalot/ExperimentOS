# Executive case study: should we keep advertising to everyone?

*ExperimentOS on the Criteo Uplift Prediction Dataset v2.1. Every figure is a full-dataset result from [RESULTS.md](RESULTS.md) and [MODEL_EVALUATION_REPORT.md](MODEL_EVALUATION_REPORT.md); monetary figures are scenario estimates under stated assumptions.*

## The question

An advertiser ran incrementality tests: 85% of 13,979,592 users were eligible for advertising, 15% were held out. Leadership wants to know three things. Did advertising cause additional visits and conversions? Is it worth its cost? And if budget is limited, who should receive it?

## What we found

**1. Advertising increases visits and conversions.**

| Outcome | Held out | Eligible | Raw difference (95% CI) | After adjusting for user features (95% CI) |
|---|---|---|---|---|
| Visit | 3.820% | 4.854% | +1.034 pp (+1.005 to +1.063) | +0.745 pp (+0.720 to +0.770) |
| Conversion | 0.194% | 0.309% | +0.115 pp (+0.108 to +0.122) | +0.100 pp (+0.093 to +0.107) |

**2. The headline number needs a haircut.** The eligible and held-out groups should be statistically identical before treatment. They are close but not identical: a model can predict group membership from user features slightly better than chance (AUC 0.510 instead of 0.500). Correcting for those differences lowers the visit effect by about 28% and the conversion effect by about 13%. The direction never changes. We report the adjusted figure as the planning number and the raw figure as an upper reference.

**3. A small group of users produces most of the effect.** On users the models never saw, the top 10% ranked by predicted uplift gain +6.07 visit percentage points each (95% CI +5.66 to +6.47). The average user gains +0.73. Most users barely respond at all.

**4. Smart targeting beats broad targeting; sophisticated modelling adds only a little on top.** A plain "who is likely to visit" model already captures most of the available gain. The best uplift model (S-learner) improves on it by a small, statistically reliable margin for visits. For conversions, which are sixteen times rarer, the more flexible uplift models are actually worse than the simple one. We would not invest in heavier modelling before testing targeting itself.

## What it means for the decision

Whether advertising to a user pays depends on one ratio: cost per treated user ÷ value per incremental outcome. That is the uplift a user must show to break even.

Illustrative scenario (assumptions, not data): 1,000,000 users, cost 0.05 per treated user, value 5 per incremental visit. Break-even uplift is 1.00 pp.

| Strategy | Users treated | Incremental visits | Cost | Scenario profit (95% interval) |
|---|---|---|---|---|
| Advertise to everyone | 1,000,000 | 7,346 | 50,000 | −13,272 (−16,478 to −10,612) |
| Random 20% | 200,000 | 1,469 | 10,000 | −2,654 |
| Top 14% by uplift model | 140,000 | 6,516 | 7,000 | **+25,582 (+23,234 to +27,708)** |

The average user's uplift (0.73 pp) is below break-even, so blanket advertising loses money in this scenario. The top 14% retain 89% of the incremental visits at 14% of the cost. That cut-off was chosen on one held-out split and its profit measured on another, so the figure is not flattered by tuning. The simulator recomputes this for any cost, value, budget and risk tolerance, and shows that the conclusion "target, don't blanket" holds across a wide band of assumptions while the exact percentage does not.

## Recommendation

1. **Keep advertising, but target it.** Rank users by predicted uplift and treat the top segment; set the cut-off from your real cost and value per outcome using the simulator, which also states the rule in deployable form (in this scenario: treat users whose predicted uplift is at least +0.804 pp).
2. **Validate with a new experiment.** Randomise *targeted vs blanket vs held-out* on fresh users. The experiment planner sizes it: detecting a 5% relative lift in visits needs about 640,000 users at an 85/15 split, or about half that at 50/50. The current evidence is a held-out split of historical data, not a prospective test of the policy.
3. **Use the adjusted effect for planning** and treat the raw effect as optimistic.
4. **Do not expand modelling yet.** The simple response model is nearly as good; the gain from targeting dwarfs the gain from model choice.

## What could make this wrong

- The public file was sub-sampled for privacy in a way that hides the true incrementality level. Effect sizes describe this file, not the real campaign.
- Several tests are pooled with no identifiers, dates or user ids, so we cannot check for novelty effects, seasonality or repeated users.
- We could only adjust for the 12 anonymised features provided.
- Costs and values are placeholders. The dataset has no revenue or cost fields.

## How it was produced

A reproducible pipeline (checksum-verified download → validated Parquet → SQL layer → statistics → models → cached artifacts) with fixed seeds, 108 automated tests that check the estimators against known ground truth, and a dashboard that reads only cached aggregates. See [METHODOLOGY.md](METHODOLOGY.md).
