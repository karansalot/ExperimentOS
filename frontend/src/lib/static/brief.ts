/** Port of backend/experimentos/brief.py: the stakeholder read-out, generated from artifacts + one scenario. */
import { loadJson } from "./data";
import { py } from "./math";
import { simulate, type ScenarioIn } from "./simulate";

const OUTCOMES = ["visit", "conversion"];

export async function buildBrief(scope: string, scenario: ScenarioIn) {
  const [exp, diagA, modelsA, metaAll] = await Promise.all([
    loadJson(`${scope}/raw/experiment.json`), loadJson(`${scope}/raw/diagnostics.json`), loadJson(`${scope}/raw/models.json`), loadJson("meta.json"),
  ]);
  const sim = await simulate(scope, scenario);
  const { pct, pp, num, pval } = py;
  const meta = exp.meta;
  const e = exp.data;
  const diag = diagA.data;
  const o = scenario.outcome;
  const eff = e.outcomes[o];
  const adj = diag.adjusted?.outcomes?.[o];
  const verdict = diag.verdict;
  const mo = modelsA.data.outcomes[o];
  const champ = mo.models.find((m: any) => m.id === mo.champion);
  const tm = champ.test_metrics;
  const rec = sim.recommendation;
  const sel = sim.selected;
  const be = sim.break_even;
  const sc = sim.scenario;

  const scopeNote = meta.is_sample
    ? `Development sample of ${num(meta.n_rows)} users (~${pct(meta.n_rows / meta.full_dataset_rows, 0)} of the full ${num(meta.full_dataset_rows)}). Figures are NOT full-dataset results.`
    : `Full dataset: ${num(meta.n_rows)} users.`;

  const findings = [
    `Assignment to treatment raised the ${o} rate from ${pct(eff.rate_control, 3)} (control) to ${pct(eff.rate_treatment, 3)} (treatment): ${pp(eff.absolute_effect)} (95% CI ${pp(eff.ci_low)} to ${pp(eff.ci_high)}), a relative lift of ${pct(eff.relative_effect, 1)}.`,
  ];
  let adjEst: any = null;
  if (adj) {
    adjEst = adj.estimators.find((x: any) => x.method.startsWith("AIPW"));
    const lin = adj.estimators.find((x: any) => x.method.startsWith("Regression"));
    findings.push(
      `After adjusting for the 12 pre-treatment features the estimate is ${pp(adjEst.estimate)} (doubly robust, 95% CI ${pp(adjEst.ci_low)} to ${pp(adjEst.ci_high)}) and ${pp(lin.estimate)} (regression adjustment): ${pct(Math.abs(adjEst.relative_to_unadjusted), 0)} ${adjEst.relative_to_unadjusted < 0 ? "below" : "above"} the raw comparison. The effect is positive under every estimator; its size depends on the estimator.`,
    );
  }
  const other = OUTCOMES.find((x) => x !== o)!;
  const eo = e.outcomes[other];
  findings.push(`The secondary outcome (${other}) moved in the same direction: ${pp(eo.absolute_effect)} (95% CI ${pp(eo.ci_low)} to ${pp(eo.ci_high)}).`);
  const g = tm.gain_over_random_adjusted;
  const u10 = tm.uplift_at_10_adjusted;
  const tot = tm.total_effect_adjusted;
  findings.push(
    `Response is concentrated: on the held-out test split the ${champ.name} model's top 10% of users show an adjusted effect of ${pp(u10.value, 2)} per user (95% CI ${pp(u10.low, 2)} to ${pp(u10.high, 2)}) against a population average of ${pp(tot.value, 3)}. Its gain over random targeting is ${g.low > 0 ? "distinguishable from zero" : "not distinguishable from zero"} (95% CI ${(g.low * 1000).toFixed(2)} to ${(g.high * 1000).toFixed(2)} extra incremental ${o}s per 1,000 users, averaged over all targeting depths).`,
  );

  const srm = e.srm;
  const interp = [
    `Hypothesis test: two-sided pooled z-test, z = ${eff.z_statistic.toFixed(1)}, p ${pval(eff.p_value)} (Holm-adjusted across the two outcomes: p ${pval(eff.p_value_holm)}). With ${num(meta.n_rows)} users even tiny effects are significant, so read the interval and the effect size, not the p-value.`,
    `Sample ratio: ${pct(srm.observed_treatment_share, 3)} treated vs the documented ${pct(srm.expected_treatment_share, 0)} design (chi-square p = ${pval(srm.p_value)}): ${srm.mismatch_detected ? "MISMATCH detected" : "no mismatch"}.`,
    `Covariate balance: ${verdict.headline} Largest standardised mean difference is ${verdict.max_abs_smd.toFixed(3)} (${verdict.worst_feature}); ${verdict.features_significant_after_holm} of ${verdict.n_features} features differ after Holm correction.`,
  ];
  if (diag.adjusted) {
    const c2 = diag.adjusted.classifier_two_sample_test;
    interp.push(`A cross-fitted classifier predicts assignment from features with AUC ${c2.auc.toFixed(3)} (0.500 = indistinguishable; p ${pval(c2.p_value)}). In a clean single randomisation this would be 0.5, so the unadjusted difference should not be read as a pure causal effect.`);
  }
  const cace = e.exposure.effect_per_exposed_user[o];
  if (cace.identified) {
    interp.push(`Only ${pct(e.exposure.exposure_rate_treatment, 1)} of treated users were actually exposed. Under the exclusion restriction the intent-to-treat effect implies ${pp(cace.cace, 1)} per exposed user (95% CI ${pp(cace.ci_low, 1)} to ${pp(cace.ci_high, 1)}). Comparing exposed with unexposed users directly would be biased, because exposure is not randomised.`);
  }

  const action = rec.action;
  let decision: string;
  let headline: string;
  if (action === "hold") {
    decision = "Do not treat under these assumptions";
    headline = `No targeting depth has positive ${sc.risk_criterion} at a cost of ${num(scenario.cost_per_user, 2)} per user and a value of ${num(scenario.value_per_outcome, 2)} per incremental ${o}.`;
  } else if (action === "roll_out") {
    decision = "Treat everyone";
    headline = `The average effect clears the break-even threshold, so treating the whole population maximises ${sc.risk_criterion}.`;
  } else {
    decision = `Target the top ${rec.targeting_pct.toFixed(0)}% by predicted uplift`;
    headline = `Ranking users with the ${rec.name} model and treating the top ${rec.targeting_pct.toFixed(0)}% maximises ${sc.risk_criterion}${rec.at_budget_limit ? " within the budget" : ""}.`;
  }
  const recommendation = [headline];
  if (action !== "hold") {
    recommendation.push(`Scenario estimate for a population of ${num(scenario.population)}: ${num(rec.targeted_users)} users treated, ${num(rec.incremental_outcomes)} incremental ${o}s, cost ${num(rec.treatment_cost)}, profit ${num(rec.profit)} (95% interval ${num(rec.profit_low)} to ${num(rec.profit_high)}).`);
  }
  const rule = sim.targeting_rule;
  if (action === "target" && rule.recommended_cutoff != null) {
    recommendation.push(rule.score_kind === "predicted uplift"
      ? `Deployable rule: treat users whose ${rule.score_kind} from the ${rec.name} model is at least ${(rule.recommended_cutoff * 100).toFixed(3)} percentage points.`
      : `Deployable rule: treat users whose ${rule.score_kind} from the ${rec.name} model is at least ${rule.recommended_cutoff.toFixed(4)}.`);
  }
  if (rec.coverage_selected_on === "validation" && action !== "hold") {
    recommendation.push("The coverage was chosen on the validation split; the profit quoted is measured on the separate test split.");
  }
  recommendation.push(`Break-even: a treated user must gain at least ${pp(be.required_effect_per_targeted_user, 2)} in ${o} probability (cost / value). The population average effect is ${pp(be.population_average_effect, 2)}, so treating everyone is ${be.treat_everyone_is_profitable ? "profitable" : "not profitable"} at these assumptions.`);
  recommendation.push(sel.targeted_users > 0 && be.break_even_value_per_outcome != null
    ? `At your selected depth of ${sel.targeting_pct.toFixed(0)}%: profit ${num(sel.profit)} (95% interval ${num(sel.profit_low)} to ${num(sel.profit_high)}); it stays positive down to a value of ${num(be.break_even_value_per_outcome, 2)} per incremental ${o}.`
    : "At your selected depth nobody is treated, so cost and incremental value are both zero.");
  if (sim.budget.capped_by_budget) {
    recommendation.push(`The budget of ${num(scenario.budget)} caps targeting at ${sim.budget.max_affordable_pct.toFixed(0)}% (requested ${scenario.targeting_pct.toFixed(0)}%).`);
  }

  const limitations = [
    "The public file was sub-sampled non-uniformly for privacy; the publisher states the original incrementality level cannot be deduced. Absolute effect sizes describe this file, not the advertiser's real campaign.",
    "The file pools several incrementality tests with no test identifier, timestamp or user id, so effects cannot be stratified by test and time-based validity checks are impossible.",
    "Arms are slightly but detectably imbalanced on features. Adjusted estimates correct for the 12 observed features only; imbalance on unobserved factors cannot be ruled out.",
    "Features are anonymised random projections: segments can be targeted but not explained in business terms.",
    "Costs and values are user-entered scenario assumptions. The dataset has no revenue or cost fields.",
    "The uplift model is evaluated on a held-out split of the same data; performance on a future population may differ.",
  ];
  if (meta.is_sample) limitations.unshift(scopeNote);

  const sections = [
    { id: "findings", title: "Main findings", bullets: findings },
    { id: "interpretation", title: "Statistical interpretation", bullets: interp },
    { id: "recommendation", title: "Recommended decision under the stated assumptions", bullets: recommendation },
    { id: "limitations", title: "Limitations", bullets: limitations },
  ];
  const assumptions: [string, string][] = [
    ["Outcome", o],
    ["Population size", num(scenario.population)],
    ["Treatment cost per targeted user", num(scenario.cost_per_user, 2)],
    [`Value per incremental ${o}`, num(scenario.value_per_outcome, 2)],
    ["Budget", scenario.budget == null ? "none" : num(scenario.budget)],
    ["Risk criterion", sc.risk_criterion],
    ["Effect basis", scenario.basis === "adjusted" ? "covariate-adjusted (doubly robust)" : "unadjusted difference in rates"],
    ["Targeting model", sc.strategy_name],
  ];
  const generated = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const ds = metaAll.dataset;
  const md = [
    "# ExperimentOS decision brief", "",
    `*Generated ${generated} · ${meta.dataset} · ${scopeNote}*`, "",
    `## Decision: ${decision}`, "", headline, "",
    "### Scenario assumptions (user-supplied, not from the dataset)", "",
    "| Assumption | Value |", "|---|---|", ...assumptions.map(([k, v]) => `| ${k} | ${v} |`), "",
  ];
  for (const s of sections) md.push(`## ${s.title}`, "", ...s.bullets.map((b) => `- ${b}`), "");
  md.push("---", `Data: ${ds.citation} License ${ds.license}. Seed ${meta.seed} · code ${meta.code_version} · raw sha256 ${meta.raw_sha256.slice(0, 12)}…`, "");

  return {
    meta, generated_at: generated, scope_note: scopeNote, decision, action, headline, assumptions, sections,
    key_numbers: {
      absolute_effect: eff.absolute_effect, ci_low: eff.ci_low, ci_high: eff.ci_high, adjusted_effect: adjEst ? adjEst.estimate : null,
      recommended_pct: rec.targeting_pct, recommended_profit: rec.profit, recommended_profit_low: rec.profit_low, recommended_profit_high: rec.profit_high,
    },
    markdown: md.join("\n"),
  };
}
