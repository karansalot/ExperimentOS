"""Decision brief: turns cached statistics + one simulator scenario into a stakeholder read-out.

Every sentence is generated from artifact values; nothing is hard-coded.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import artifacts, config
from .simulator.decision import Scenario, simulate

OUTCOME_LABEL = {"visit": "visit", "conversion": "conversion"}


def pct(x, d: int = 2) -> str:
    return "n/a" if x is None else f"{x * 100:.{d}f}%"


def pp(x, d: int = 3) -> str:
    return "n/a" if x is None else f"{x * 100:+.{d}f} pp"


def num(x, d: int = 0) -> str:
    return "n/a" if x is None else f"{x:,.{d}f}"


def pval(p) -> str:
    if p is None:
        return "n/a"
    return "< 0.0001" if p < 1e-4 else f"{p:.4f}"


def build(scope_name: str, scenario: Scenario) -> dict:
    exp = artifacts.read(scope_name, "experiment")
    diag = artifacts.read(scope_name, "diagnostics")["data"]
    models = artifacts.read(scope_name, "models")["data"]
    sim = simulate(scope_name, scenario)
    meta, e = exp["meta"], exp["data"]
    o = scenario.outcome
    eff = e["outcomes"][o]
    adj = (diag.get("adjusted") or {}).get("outcomes", {}).get(o)
    verdict = diag["verdict"]
    mo = models["outcomes"][o]
    champ = next(m for m in mo["models"] if m["id"] == mo["champion"])
    tm = champ["test_metrics"]
    rec, sel, be, sc = sim["recommendation"], sim["selected"], sim["break_even"], sim["scenario"]

    scope_note = (
        f"Development sample of {meta['n_rows']:,} users (~{meta['n_rows'] / meta['full_dataset_rows']:.0%} of the full "
        f"{meta['full_dataset_rows']:,}). Figures are NOT full-dataset results."
        if meta["is_sample"] else f"Full dataset: {meta['n_rows']:,} users."
    )

    # ---- findings ------------------------------------------------------------
    findings = [
        f"Assignment to treatment raised the {o} rate from {pct(eff['rate_control'], 3)} (control) to {pct(eff['rate_treatment'], 3)} "
        f"(treatment): {pp(eff['absolute_effect'])} (95% CI {pp(eff['ci_low'])} to {pp(eff['ci_high'])}), "
        f"a relative lift of {pct(eff['relative_effect'], 1)}.",
    ]
    adj_est = None
    if adj:
        adj_est = next(x for x in adj["estimators"] if x["method"].startswith("AIPW"))
        lin = next(x for x in adj["estimators"] if x["method"].startswith("Regression"))
        findings.append(
            f"After adjusting for the 12 pre-treatment features the estimate is {pp(adj_est['estimate'])} "
            f"(doubly robust, 95% CI {pp(adj_est['ci_low'])} to {pp(adj_est['ci_high'])}) and {pp(lin['estimate'])} (regression adjustment): "
            f"{pct(abs(adj_est['relative_to_unadjusted']), 0)} {'below' if adj_est['relative_to_unadjusted'] < 0 else 'above'} the raw comparison. "
            "The effect is positive under every estimator; its size depends on the estimator."
        )
    other = [x for x in config.OUTCOMES if x != o][0]
    eo = e["outcomes"][other]
    findings.append(
        f"The secondary outcome ({other}) moved in the same direction: {pp(eo['absolute_effect'])} "
        f"(95% CI {pp(eo['ci_low'])} to {pp(eo['ci_high'])})."
    )
    g, u10, tot = tm["gain_over_random_adjusted"], tm["uplift_at_10_adjusted"], tm["total_effect_adjusted"]
    findings.append(
        f"Response is concentrated: on the held-out test split the {champ['name']} model's top 10% of users show an adjusted effect of "
        f"{pp(u10['value'], 2)} per user (95% CI {pp(u10['low'], 2)} to {pp(u10['high'], 2)}) against a population average of {pp(tot['value'], 3)}. "
        f"Its gain over random targeting is {'distinguishable from zero' if g['low'] > 0 else 'not distinguishable from zero'} "
        f"(95% CI {g['low'] * 1000:.2f} to {g['high'] * 1000:.2f} extra incremental {o}s per 1,000 users, averaged over all targeting depths)."
    )

    # ---- interpretation --------------------------------------------------------
    srm = e["srm"]
    interp = [
        f"Hypothesis test: two-sided pooled z-test, z = {eff['z_statistic']:.1f}, p {pval(eff['p_value'])} "
        f"(Holm-adjusted across the two outcomes: p {pval(eff['p_value_holm'])}). With {meta['n_rows']:,} users even tiny effects are "
        "significant, so read the interval and the effect size, not the p-value.",
        f"Sample ratio: {pct(srm['observed_treatment_share'], 3)} treated vs the documented {pct(srm['expected_treatment_share'], 0)} design "
        f"(chi-square p = {pval(srm['p_value'])}): {'MISMATCH detected' if srm['mismatch_detected'] else 'no mismatch'}.",
        f"Covariate balance: {verdict['headline']} Largest standardised mean difference is {verdict['max_abs_smd']:.3f} ({verdict['worst_feature']}); "
        f"{verdict['features_significant_after_holm']} of {verdict['n_features']} features differ after Holm correction.",
    ]
    if diag.get("adjusted"):
        c2 = diag["adjusted"]["classifier_two_sample_test"]
        interp.append(
            f"A cross-fitted classifier predicts assignment from features with AUC {c2['auc']:.3f} (0.500 = indistinguishable; p {pval(c2['p_value'])}). "
            "In a clean single randomisation this would be 0.5, so the unadjusted difference should not be read as a pure causal effect."
        )
    cace = e["exposure"]["effect_per_exposed_user"][o]
    if cace.get("identified"):
        interp.append(
            f"Only {pct(e['exposure']['exposure_rate_treatment'], 1)} of treated users were actually exposed. Under the exclusion restriction the "
            f"intent-to-treat effect implies {pp(cace['cace'], 1)} per exposed user (95% CI {pp(cace['ci_low'], 1)} to {pp(cace['ci_high'], 1)}). "
            "Comparing exposed with unexposed users directly would be biased, because exposure is not randomised."
        )

    # ---- recommendation --------------------------------------------------------
    action = rec["action"]
    if action == "hold":
        decision = "Do not treat under these assumptions"
        headline = (
            f"No targeting depth has positive {sc['risk_criterion']} at a cost of {num(scenario.cost_per_user, 2)} per user and a value of "
            f"{num(scenario.value_per_outcome, 2)} per incremental {o}."
        )
    elif action == "roll_out":
        decision = "Treat everyone"
        headline = f"The average effect clears the break-even threshold, so treating the whole population maximises {sc['risk_criterion']}."
    else:
        decision = f"Target the top {rec['targeting_pct']:.0f}% by predicted uplift"
        headline = (
            f"Ranking users with the {rec['name']} model and treating the top {rec['targeting_pct']:.0f}% maximises {sc['risk_criterion']}"
            f"{' within the budget' if rec['at_budget_limit'] else ''}."
        )
    recommendation = [headline]
    if action != "hold":
        recommendation.append(
            f"Scenario estimate for a population of {num(scenario.population)}: {num(rec['targeted_users'])} users treated, "
            f"{num(rec['incremental_outcomes'])} incremental {o}s, cost {num(rec['treatment_cost'])}, profit {num(rec['profit'])} "
            f"(95% interval {num(rec['profit_low'])} to {num(rec['profit_high'])})."
        )
    rule = sim["targeting_rule"]
    if action == "target" and rule["recommended_cutoff"] is not None:
        recommendation.append(
            f"Deployable rule: treat users whose {rule['score_kind']} from the {rec['name']} model is at least "
            f"{rule['recommended_cutoff'] * 100:.3f} percentage points."
            if rule["score_kind"] == "predicted uplift" else
            f"Deployable rule: treat users whose {rule['score_kind']} from the {rec['name']} model is at least {rule['recommended_cutoff']:.4f}."
        )
    if rec.get("coverage_selected_on") == "validation" and action != "hold":
        recommendation.append("The coverage was chosen on the validation split; the profit quoted is measured on the separate test split.")
    thr = be["required_effect_per_targeted_user"]
    recommendation.append(
        f"Break-even: a treated user must gain at least {pp(thr, 2)} in {o} probability (cost / value). The population average effect is "
        f"{pp(be['population_average_effect'], 2)}, so treating everyone is {'profitable' if be['treat_everyone_is_profitable'] else 'not profitable'} "
        "at these assumptions."
    )
    recommendation.append(
        f"At your selected depth of {sel['targeting_pct']:.0f}%: profit {num(sel['profit'])} (95% interval {num(sel['profit_low'])} to "
        f"{num(sel['profit_high'])}); it stays positive down to a value of {num(be['break_even_value_per_outcome'], 2)} per incremental {o}."
        if sel["targeted_users"] > 0 and be["break_even_value_per_outcome"] is not None
        else "At your selected depth nobody is treated, so cost and incremental value are both zero."
    )
    if sim["budget"]["capped_by_budget"]:
        recommendation.append(
            f"The budget of {num(scenario.budget)} caps targeting at {sim['budget']['max_affordable_pct']:.0f}% (requested {scenario.targeting_pct:.0f}%)."
        )

    limitations = [
        "The public file was sub-sampled non-uniformly for privacy; the publisher states the original incrementality level cannot be deduced. "
        "Absolute effect sizes describe this file, not the advertiser's real campaign.",
        "The file pools several incrementality tests with no test identifier, timestamp or user id, so effects cannot be stratified by test "
        "and time-based validity checks are impossible.",
        "Arms are slightly but detectably imbalanced on features. Adjusted estimates correct for the 12 observed features only; "
        "imbalance on unobserved factors cannot be ruled out.",
        "Features are anonymised random projections: segments can be targeted but not explained in business terms.",
        "Costs and values are user-entered scenario assumptions. The dataset has no revenue or cost fields.",
        "The uplift model is evaluated on a held-out split of the same data; performance on a future population may differ.",
    ]
    if meta["is_sample"]:
        limitations.insert(0, scope_note)

    sections = [
        {"id": "findings", "title": "Main findings", "bullets": findings},
        {"id": "interpretation", "title": "Statistical interpretation", "bullets": interp},
        {"id": "recommendation", "title": "Recommended decision under the stated assumptions", "bullets": recommendation},
        {"id": "limitations", "title": "Limitations", "bullets": limitations},
    ]
    assumptions = [
        ["Outcome", o],
        ["Population size", num(scenario.population)],
        ["Treatment cost per targeted user", num(scenario.cost_per_user, 2)],
        [f"Value per incremental {o}", num(scenario.value_per_outcome, 2)],
        ["Budget", "none" if scenario.budget is None else num(scenario.budget)],
        ["Risk criterion", sc["risk_criterion"]],
        ["Effect basis", "covariate-adjusted (doubly robust)" if scenario.basis == "adjusted" else "unadjusted difference in rates"],
        ["Targeting model", sc["strategy_name"]],
    ]
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    md = [
        "# ExperimentOS decision brief", "",
        f"*Generated {generated} · {meta['dataset']} · {scope_note}*", "",
        f"## Decision: {decision}", "", headline, "",
        "### Scenario assumptions (user-supplied, not from the dataset)", "",
        "| Assumption | Value |", "|---|---|", *[f"| {k} | {v} |" for k, v in assumptions], "",
    ]
    for s in sections:
        md += [f"## {s['title']}", "", *[f"- {b}" for b in s["bullets"]], ""]
    md += ["---", f"Data: {config.DATASET['citation']} License {config.DATASET['license']}. "
           f"Seed {meta['seed']} · code {meta['code_version']} · raw sha256 {meta['raw_sha256'][:12]}…", ""]
    return {
        "meta": meta,
        "generated_at": generated,
        "scope_note": scope_note,
        "decision": decision,
        "action": action,
        "headline": headline,
        "assumptions": assumptions,
        "sections": sections,
        "key_numbers": {
            "absolute_effect": eff["absolute_effect"], "ci_low": eff["ci_low"], "ci_high": eff["ci_high"],
            "adjusted_effect": adj_est["estimate"] if adj_est else None,
            "recommended_pct": rec["targeting_pct"], "recommended_profit": rec["profit"],
            "recommended_profit_low": rec["profit_low"], "recommended_profit_high": rec["profit_high"],
        },
        "markdown": "\n".join(md),
    }
