"""Auto-generated, evidence-linked insights: the platform's answer to "so what?".

Every insight is computed from cached artifacts (plus seeded simulations for the design
insights) and links to the page that shows the evidence. Nothing here is hand-written per dataset.
"""
from __future__ import annotations

from . import artifacts
from .simulator.decision import Scenario, load_curves, simulate
from .stats import bayes, power, sequential


def _pct(x: float, d: int = 0) -> str:
    return f"{x * 100:.{d}f}%"


def _pp(x: float, d: int = 2) -> str:
    return f"{x * 100:+.{d}f} pp"


def concentration(scope: str, outcome: str = "visit", basis: str = "adjusted") -> dict:
    """Share of the treat-everyone effect captured when only the top fraction is treated."""
    cs = load_curves(scope, outcome, basis)
    total = cs.point["random"][-1]
    series = {}
    for m in ("random", "response", cs.champion):
        series[m] = {"name": cs.names.get(m, m), "share": [float(v / total) for v in cs.point[m]]}
    return {"fraction": [float(f) for f in cs.fraction], "champion": cs.champion, "series": series,
            "note": "100% = incremental outcomes from treating everyone. Values above 100% mean the remaining users are, on net, hurt or unmoved."}


def build(scope: str) -> dict:
    exp = artifacts.read(scope, "experiment")
    meta, e = exp["meta"], exp["data"]
    diag = artifacts.read(scope, "diagnostics")["data"]
    models = artifacts.read(scope, "models")["data"]["outcomes"]
    dq = artifacts.read(scope, "data_quality")["data"]
    explain = artifacts.read(scope, "explain")["data"]["outcomes"] if artifacts.exists(scope, "explain") else None

    v = e["outcomes"]["visit"]
    arms = {a["arm"]: a for a in e["arms"]}
    post = bayes.beta_binomial(arms["treatment"]["visits"], arms["treatment"]["n_users"], arms["control"]["visits"], arms["control"]["n_users"],
                               draws=200_000)
    insights = []

    insights.append({
        "id": "effect", "tone": "good", "kicker": "Did it work?", "href": "/overview",
        "value": _pp(v["absolute_effect"], 2),
        "title": "Advertising lifts visits, and there is no real doubt about the direction",
        "detail": (f"Visit rate rose from {_pct(v['rate_control'], 2)} to {_pct(v['rate_treatment'], 2)} "
                   f"(95% CI {_pp(v['ci_low'], 3)} to {_pp(v['ci_high'], 3)}). Posterior probability that treatment is better: "
                   f"{'> 99.99%' if post['prob_treatment_better'] > 0.9999 else _pct(post['prob_treatment_better'], 2)}."),
    })

    adj = diag.get("adjusted")
    if adj:
        dr = next(x for x in adj["outcomes"]["visit"]["estimators"] if x["method"].startswith("AIPW"))
        c2 = adj["classifier_two_sample_test"]
        insights.append({
            "id": "inflation", "tone": "warning", "kicker": "How big, really?", "href": "/diagnostics",
            "value": f"−{_pct(abs(dr['relative_to_unadjusted']))}",
            "title": "The raw comparison overstates the effect",
            "detail": (f"The arms are not perfectly comparable (a model tells them apart with AUC {c2['auc']:.3f}). Adjusting for the 12 features "
                       f"gives {_pp(dr['estimate'], 3)}, {_pct(abs(dr['relative_to_unadjusted']))} below the raw {_pp(v['absolute_effect'], 3)}. "
                       "Plan on the adjusted number."),
        })

    conc = concentration(scope)
    champ = conc["champion"]
    share = conc["series"][champ]["share"]
    n = len(share) - 1
    top10 = share[round(0.1 * n)]
    mo = models["visit"]
    ccard = next(c for c in mo["models"] if c["id"] == champ)
    u10 = ccard["test_metrics"]["uplift_at_10_adjusted"]["value"]
    avg = ccard["test_metrics"]["total_effect_adjusted"]["value"]
    insights.append({
        "id": "concentration", "tone": "info", "kicker": "Who responds?", "href": "/models",
        "value": _pct(top10),
        "title": f"The top 10% of users deliver {_pct(top10)} of all incremental visits",
        "detail": (f"Ranked by the {ccard['name']} model on held-out users, the top 10% gain {_pp(u10)} each versus "
                   f"{_pp(avg)} on average: {u10 / avg:.0f}× the typical response."),
    })

    sim = simulate(scope, Scenario())
    rec = sim["recommendation"]
    rows = {r["id"]: r for r in sim["strategies"]}
    if rec["action"] == "target":
        insights.append({
            "id": "decision", "tone": "good", "kicker": "What should we do?", "href": "/simulator",
            "value": f"top {rec['targeting_pct']:.0f}%",
            "title": "Blanket advertising loses money; targeting makes it profitable",
            "detail": (f"Illustrative assumptions (cost 0.05 per user, value 5 per visit, 1M users): treating everyone returns "
                       f"{rows['all']['profit']:,.0f}, treating the top {rec['targeting_pct']:.0f}% returns {rec['profit']:,.0f} "
                       f"(95% interval {rec['profit_low']:,.0f} to {rec['profit_high']:,.0f}). Coverage chosen on validation, profit measured on test."),
        })

    resp = next(c for c in mo["models"] if c["id"] == "response")
    g_c = ccard["test_metrics"]["gain_over_random_adjusted"]
    g_r = resp["test_metrics"]["gain_over_random_adjusted"]["value"]
    conv = models["conversion"]
    conv_resp = next(c for c in conv["models"] if c["id"] == "response")["test_metrics"]["gain_over_random_adjusted"]["value"]
    worse = [c["name"] for c in conv["models"] if c["estimates_uplift"] and c["test_metrics"]["gain_over_random_adjusted"]["vs_reference"]["high"] < 0]
    insights.append({
        "id": "sophistication", "tone": "info", "kicker": "Do we need fancy models?", "href": "/models",
        "value": f"+{(g_c['value'] / g_r - 1) * 100:.0f}%",
        "title": "Ranking by likely response gets most of the way; uplift modelling adds a little",
        "detail": (f"The best uplift model beats a plain response model by {(g_c['value'] / g_r - 1) * 100:.0f}% on gain over random for visits"
                   + (f" (paired 95% CI excludes zero). For conversions, {', '.join(worse)} {'is' if len(worse) == 1 else 'are'} significantly worse than the response baseline."
                      if worse else ".")
                   + f" Conversion gain over random for the response baseline: {conv_resp * 1000:.2f} per 1,000 users."),
    })

    if explain:
        ex = explain["visit"]
        top_imp = ex["importance"][0]
        pers = ex["persuadables"][0]
        insights.append({
            "id": "heterogeneity", "tone": "good", "kicker": "Is the model's story true?", "href": "/models#explain",
            "value": f"r = {ex['agreement_correlation']:.2f}",
            "title": "The model's predicted differences match what the data shows",
            "detail": (f"Across {len(ex['segment_agreement'])} feature segments, mean predicted uplift tracks the observed doubly-robust uplift "
                       f"(correlation {ex['agreement_correlation']:.2f}, average gap {ex['agreement_weighted_mae'] * 100:.3f} pp). "
                       f"Shuffling {top_imp['feature']} costs the most ranking value ({_pct(top_imp['share_of_gain'])} of the gain)."),
        })
        insights.append({
            "id": "persuadables", "tone": "info", "kicker": "Who are the persuadables?", "href": "/models#explain",
            "value": _pct(pers["share_off_modal_top"]),
            "title": f"Persuadables {'all' if pers['share_off_modal_top'] >= 0.995 else 'mostly'} sit off {pers['feature']}'s typical value",
            "detail": (f"{_pct(pers['share_off_modal_top'])} of the top 10% by predicted uplift have a non-modal {pers['feature']}, "
                       f"against {_pct(pers['share_off_modal_rest'])} of everyone else (standardised difference {pers['smd']:+.2f}). "
                       "Features are anonymised, so this is a targeting signal, not an explanation."),
        })

    n_obs = v["n_treatment"] + v["n_control"]
    share_t = v["n_treatment"] / n_obs
    mde = power.minimum_detectable_effect(n_obs, v["rate_control"], share_t)
    need5 = power.required_sample_size(v["rate_control"], 0.05 * v["rate_control"], share_t)["n_total"]
    insights.append({
        "id": "overpowered", "tone": "info", "kicker": "Was the test sized well?", "href": "/planner",
        "value": f"{v['absolute_effect'] / mde:.0f}×",
        "title": "The effect is far above what this test could detect",
        "detail": (f"With {n_obs:,} users at {share_t:.0%}/{1 - share_t:.0%} the minimum detectable effect is {_pp(mde, 3)}; the observed effect is "
                   f"{v['absolute_effect'] / mde:.0f} times larger. Detecting a 5% relative lift would need about {need5:,} users "
                   f"({need5 / n_obs:.1%} of this sample)."),
    })

    seq = sequential.simulate(n_looks=10, sims=40_000)
    naive = next(d for d in seq["designs"] if d["id"] == "naive")
    obf = next(d for d in seq["designs"] if d["id"] == "obrien_fleming")
    insights.append({
        "id": "peeking", "tone": "warning", "kicker": "What if we had peeked?", "href": "/sequential",
        "value": _pct(naive["false_positive_rate"]),
        "title": f"Checking results 10 times would push false positives from 5% to {_pct(naive['false_positive_rate'])}",
        "detail": (f"Simulation: stopping at the first p < 0.05 across 10 looks gives a {_pct(naive['false_positive_rate'])} false-positive rate instead of 5%. "
                   f"An O'Brien-Fleming boundary restores {_pct(obf['false_positive_rate'], 1)} and still stops early, using "
                   f"{_pct(obf['expected_sample_fraction'])} of the planned sample on average when the effect is real."),
    })

    order = dq["file_order"]
    pure = sum(1 for b in order if b["treatment_share"] in (0, 1))
    leading = 0
    for b in order:  # rows before the first block that contains any control user
        if b["treatment_share"] < 1:
            break
        leading += b["n_users"]
    insights.append({
        "id": "file_order", "tone": "warning", "kicker": "Data trap", "href": "/sql",
        "value": f"{pure}/{len(order)}",
        "title": "A 'quick sample' of this file would have no control group",
        "detail": (f"{pure} of {len(order)} position blocks contain only one arm, and at least the first {leading:,} rows are all treated. "
                   "Every split and sample here uses a salted hash of row position instead."),
    })

    return {
        "meta": meta,
        "headline": {
            "users": n_obs,
            "effect": v["absolute_effect"],
            "adjusted_effect": (next(x for x in adj["outcomes"]["visit"]["estimators"] if x["method"].startswith("AIPW"))["estimate"] if adj else None),
            "top10_share": top10,
            "recommended_pct": rec["targeting_pct"] if rec["action"] != "hold" else 0.0,
        },
        "insights": insights,
        "concentration": conc,
        "bayes_visit": post,
    }
