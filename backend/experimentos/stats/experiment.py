"""Assembles the experiment read-out: effects, validity diagnostics, segments.

Aggregates come from the SQL layer (sufficient statistics); only the
covariate-adjusted estimators need row-level arrays.
"""
from __future__ import annotations

from typing import Optional

import duckdb

from .. import config
from ..data.loader import load_frame
from . import adjustment, balance, compliance, heterogeneity, multiple, proportions

OUTCOME_COUNT_COLUMN = {"visit": "visits", "conversion": "conversions"}
MIN_CONTROL_FOR_SEGMENT = 1000


def _arms(con: duckdb.DuckDBPyConnection) -> dict:
    rel = con.sql("SELECT * FROM v_arm_summary")
    rows = [dict(zip(rel.columns, r)) for r in rel.fetchall()]
    by = {r["arm"]: r for r in rows}
    if set(by) != {"treatment", "control"}:
        raise ValueError(f"Expected exactly a treatment and a control arm, found {sorted(by)}")
    return by


def effects(con: duckdb.DuckDBPyConnection) -> dict:
    """Headline intent-to-treat analysis from arm-level counts."""
    arms = _arms(con)
    t, c = arms["treatment"], arms["control"]
    outcomes = {}
    for name, col in OUTCOME_COUNT_COLUMN.items():
        test = proportions.two_proportion_test(t[col], t["n_users"], c[col], c["n_users"], config.ALPHA)
        test["mde"] = proportions.minimum_detectable_effect(t["n_users"], c["n_users"], test["rate_control"], config.ALPHA)
        outcomes[name] = test
    adj = multiple.adjust_pvalues([outcomes[o]["p_value"] for o in config.OUTCOMES], "holm")
    for o, p in zip(config.OUTCOMES, adj):
        outcomes[o]["p_value_holm"] = float(p)
        outcomes[o]["significant_after_holm"] = bool(p < config.ALPHA)

    srm = proportions.srm_test(t["n_users"], c["n_users"], config.DESIGN_TREATMENT_RATIO)

    joint = con.sql(
        "SELECT sum(exposure * visit), sum(exposure * conversion) FROM experiment WHERE treatment = 1"
    ).fetchone()
    cace = {}
    for name, both in zip(["visit", "conversion"], joint):
        o = outcomes[name]
        cace[name] = compliance.wald_cace(
            o["absolute_effect"], o["std_error"], t["n_users"], t["exposures"], float(both), o["rate_treatment"],
            exposed_c=c["exposures"], alpha=config.ALPHA,
        )
    return {
        "arms": [arms["treatment"], arms["control"]],
        "n_users": t["n_users"] + c["n_users"],
        "outcomes": outcomes,
        "srm": srm,
        "exposure": {
            "exposed_treatment": t["exposures"],
            "exposed_control": c["exposures"],
            "exposure_rate_treatment": t["exposure_rate"],
            "effect_per_exposed_user": cace,
        },
    }


def balance_table(con: duckdb.DuckDBPyConnection) -> list[dict]:
    rows = con.sql(
        """
        WITH m AS (
            SELECT feature, treatment, sum(n_users)::DOUBLE AS n,
                   sum(value * n_users) / sum(n_users) AS mean,
                   sum(value * value * n_users) / sum(n_users) AS mean_sq
            FROM feature_value_stats GROUP BY feature, treatment
        )
        SELECT feature,
               max(CASE WHEN treatment = 1 THEN n END), max(CASE WHEN treatment = 1 THEN mean END),
               max(CASE WHEN treatment = 1 THEN (mean_sq - mean * mean) * n / (n - 1) END),
               max(CASE WHEN treatment = 0 THEN n END), max(CASE WHEN treatment = 0 THEN mean END),
               max(CASE WHEN treatment = 0 THEN (mean_sq - mean * mean) * n / (n - 1) END)
        FROM m GROUP BY feature ORDER BY CAST(substr(feature, 2) AS INTEGER)
        """
    ).fetchall()
    table = [balance.balance_row(*r) for r in rows]
    adj = multiple.adjust_pvalues([r["p_value"] for r in table], "holm")
    for r, p in zip(table, adj):
        r["p_value_holm"] = float(p)
    return table


def adjusted_segment_stats(con: duckdb.DuckDBPyConnection, scope: config.Scope) -> dict:
    """Mean cross-fitted doubly-robust score per (feature, segment): the covariate-adjusted segment effect.

    Computed entirely in DuckDB by joining the rows to their saved nuisance predictions, so it
    scales to the full data. Returns {} when nuisances have not been computed for this scope.
    """
    if not scope.nuisances.exists():
        return {}
    lo, hi = config.PROPENSITY_CLIP
    feats = ", ".join(config.FEATURES)

    def psi(o: str) -> str:
        e = f"greatest(least(n.propensity, {hi}), {lo})"
        return (f"(n.mu1_{o} - n.mu0_{o} + e.treatment * (e.{o} - n.mu1_{o}) / {e} "
                f"- (1 - e.treatment) * (e.{o} - n.mu0_{o}) / (1 - {e}))")

    con.execute("CREATE OR REPLACE TEMP TABLE segment_map AS SELECT * FROM v_feature_segments")
    cols = ", ".join(f"avg(psi_{o}), stddev_samp(psi_{o})" for o in config.OUTCOMES)
    rows = con.sql(
        f"""
        WITH scored AS (
            SELECT {", ".join("e." + f for f in config.FEATURES)},
                   {", ".join(f"{psi(o)} AS psi_{o}" for o in config.OUTCOMES)}
            FROM experiment e JOIN read_parquet('{scope.nuisances}') n USING (row_id)
        ),
        long AS (UNPIVOT scored ON {feats} INTO NAME feature VALUE value)
        SELECT l.feature, g.segment_id, count(*) AS n, {cols}
        FROM long l JOIN segment_map g USING (feature, value)
        GROUP BY l.feature, g.segment_id
        """
    ).fetchall()
    out = {}
    for feature, seg_id, n, *stats in rows:
        for i, o in enumerate(config.OUTCOMES):
            mean, sd = stats[2 * i], stats[2 * i + 1]
            se = (sd / n**0.5) if sd is not None and n > 1 else None
            out[(o, feature, seg_id)] = {
                "adjusted_effect": mean,
                "adjusted_std_error": se,
                "adjusted_ci_low": mean - 1.959964 * se if se is not None else None,
                "adjusted_ci_high": mean + 1.959964 * se if se is not None else None,
            }
    return out


def segment_effects(con: duckdb.DuckDBPyConnection, scope: Optional[config.Scope] = None) -> dict:
    """Per-feature segment effects with FDR control and a heterogeneity test per feature."""
    adjusted = adjusted_segment_stats(con, scope) if scope is not None else {}
    rel = con.sql("SELECT * FROM v_segment_arm_stats ORDER BY CAST(substr(feature, 2) AS INTEGER), segment_id, treatment")
    rows = [dict(zip(rel.columns, r)) for r in rel.fetchall()]
    cells: dict = {}
    for r in rows:
        cells.setdefault((r["feature"], r["segment_id"]), {})[r["treatment"]] = r

    out = {}
    for outcome, col in OUTCOME_COUNT_COLUMN.items():
        segs = []
        for (feature, seg_id), arms in cells.items():
            if 0 not in arms or 1 not in arms:
                continue  # a segment with a single arm has no estimable effect
            t, c = arms[1], arms[0]
            test = proportions.two_proportion_test(t[col], t["n_users"], c[col], c["n_users"], config.ALPHA)
            segs.append(
                {
                    "feature": feature,
                    "segment_id": seg_id,
                    "segment": t["segment"],
                    "value_min": min(t["value_min"], c["value_min"]),
                    "value_max": max(t["value_max"], c["value_max"]),
                    "n_users": t["n_users"] + c["n_users"],
                    "low_sample": c["n_users"] < MIN_CONTROL_FOR_SEGMENT,
                    **adjusted.get((outcome, feature, seg_id), {}),
                    **{k: test[k] for k in (
                        "n_treatment", "n_control", "rate_treatment", "rate_control", "absolute_effect",
                        "std_error", "ci_low", "ci_high", "relative_effect", "z_statistic", "p_value",
                    )},
                }
            )
        for method in ("bh", "holm"):
            adj = multiple.adjust_pvalues([s["p_value"] for s in segs], method)
            for s, p in zip(segs, adj):
                s[f"p_value_{method}"] = float(p)
        features = []
        for feature in config.FEATURES:
            fs = [s for s in segs if s["feature"] == feature]
            q = heterogeneity.cochran_q([s["absolute_effect"] for s in fs], [s["std_error"] for s in fs])
            features.append({"feature": feature, "segments": fs, "heterogeneity": q})
        # NB: a p-value of exactly 0.0 (underflow) is a real result, so test for None explicitly.
        q_adj = multiple.adjust_pvalues(
            [1.0 if f["heterogeneity"]["p_value"] is None else f["heterogeneity"]["p_value"] for f in features], "holm"
        )
        for f, p in zip(features, q_adj):
            f["heterogeneity"]["p_value_holm"] = float(p)
        out[outcome] = {
            "features": features,
            "n_tests": len(segs),
            "adjustment": "Benjamini-Hochberg (FDR) and Holm (FWER) across all segment tests for this outcome",
        }
    return {
        "segment_definition": (
            "Per feature: segment 0 is the modal value; segments 1-3 are user-weighted terciles of all other values. "
            "Segments are defined from pre-treatment feature values only, never from outcomes."
        ),
        "min_control_for_reliable_segment": MIN_CONTROL_FOR_SEGMENT,
        "has_adjusted_effects": bool(adjusted),
        "adjusted_definition": (
            "Adjusted segment effect = mean cross-fitted doubly-robust score among the segment's users "
            "(corrects for imbalance on all 12 features); interval = mean ± 1.96 standard errors."
        ),
        "outcomes": out,
    }


def adjusted_estimates(scope: config.Scope, unadjusted: dict, frame: Optional[dict] = None) -> dict:
    """Covariate-adjusted ATEs plus the assignment-predictability diagnostics that share the same models."""
    d = frame or load_frame(scope)
    X, t = d["X"], d["treatment"]
    outcomes = {o: d[o] for o in config.OUTCOMES}
    nuis = adjustment.cross_fit_nuisances(X, t, outcomes, d["row_id"])
    adjustment.save_nuisances(scope, d["row_id"], nuis)  # reused by the uplift evaluation
    result = {"outcomes": {}}
    for o in config.OUTCOMES:
        u = unadjusted[o]
        est = [
            {
                "method": "Unadjusted difference in proportions",
                "estimate": u["absolute_effect"], "std_error": u["std_error"],
                "ci_low": u["wald_ci_low"], "ci_high": u["wald_ci_high"], "n": u["n_treatment"] + u["n_control"],
            },
            adjustment.lin_estimator(X, t, outcomes[o]),
            adjustment.aipw(t, outcomes[o], nuis["propensity"], nuis["mu1"][o], nuis["mu0"][o]),
        ]
        base = est[0]["estimate"]
        for e in est:
            e["relative_to_unadjusted"] = (e["estimate"] / base - 1) if base else None
        result["outcomes"][o] = {
            "estimators": est,
            "max_relative_shift": max(abs(e["relative_to_unadjusted"] or 0) for e in est),
        }
    result["classifier_two_sample_test"] = balance.classifier_two_sample_test(t, nuis["propensity"])
    result["omnibus_f_test"] = balance.omnibus_f_test(X, t)
    result["cross_fitting"] = {"n_folds": nuis["n_folds"], "fold_rule": "salted splitmix64 hash of row_id", "seed": config.SEED}
    return result


def balance_verdict(table: list[dict], adjusted: Optional[dict]) -> dict:
    max_smd = max(abs(r["std_mean_diff"]) for r in table)
    worst = max(table, key=lambda r: abs(r["std_mean_diff"]))["feature"]
    n_sig = sum(r["p_value_holm"] < config.ALPHA for r in table)
    detectable = n_sig > 0
    if adjusted:
        detectable = detectable or adjusted["classifier_two_sample_test"]["p_value"] < 0.001
    if max_smd >= 0.1:
        status, headline = "fail", "Covariates are materially imbalanced between arms."
    elif detectable:
        status, headline = (
            "caution",
            "Imbalance is small in magnitude but statistically detectable: assignment is not independent of the features.",
        )
    else:
        status, headline = "pass", "No evidence of covariate imbalance."
    return {
        "status": status,
        "headline": headline,
        "max_abs_smd": max_smd,
        "worst_feature": worst,
        "features_significant_after_holm": n_sig,
        "n_features": len(table),
        "smd_threshold": 0.1,
    }


def analyze(scope: config.Scope, con: duckdb.DuckDBPyConnection, with_adjustment: bool = True,
            frame: Optional[dict] = None) -> dict:
    """Run the full experimentation engine for one scope. Returns the artifact payloads."""
    eff = effects(con)
    table = balance_table(con)
    adjusted = adjusted_estimates(scope, eff["outcomes"], frame) if with_adjustment else None
    return {
        "experiment": eff,
        "diagnostics": {
            "balance": table,
            "verdict": balance_verdict(table, adjusted),
            "adjusted": adjusted,
        },
        "segments": segment_effects(con, scope),
    }
