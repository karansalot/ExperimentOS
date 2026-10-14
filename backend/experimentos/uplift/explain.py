"""What drives predicted uplift, and does the model's heterogeneity match the data's?

Three views of the champion model per outcome, all on the held-out test split:

1. Permutation importance: drop in covariate-adjusted gain over random when one feature
   is shuffled (computed on a seeded, labelled subsample of test users, because each
   permutation means re-scoring every user).
2. Segment agreement: mean predicted uplift vs observed (doubly-robust) uplift for every
   feature segment. If the model has learned real heterogeneity, the two line up.
3. Persuadables profile: how the top 10% of users by predicted uplift differ from everyone else.
"""
from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np

from .. import artifacts, config
from ..sql import runner
from ..stats import adjustment
from . import metrics

IMPORTANCE_SAMPLE = 300_000
REPEATS = 2


def _model_path(scope: config.Scope, outcome: str, card: dict) -> Path:
    return scope.artifacts / "models" / f"{outcome}__{card['id']}__{card['version']}.joblib"


def _test_rows(con, scope: config.Scope) -> dict:
    lo, hi = config.PROPENSITY_CLIP
    cols = ", ".join([f"e.{f}" for f in config.FEATURES])
    d = con.sql(
        f"""SELECT e.row_id, {cols}, e.treatment, e.visit, e.conversion, n.propensity,
                   n.mu1_visit, n.mu0_visit, n.mu1_conversion, n.mu0_conversion
            FROM experiment e JOIN read_parquet('{scope.nuisances}') n USING (row_id)
            WHERE e.split = 'test' ORDER BY e.row_id"""
    ).fetchnumpy()
    X = np.column_stack([d[f] for f in config.FEATURES]).astype(np.float32)
    out = {"row_id": d["row_id"], "X": X, "t": d["treatment"].astype(np.uint8)}
    for o in config.OUTCOMES:
        out[o] = d[o].astype(np.uint8)
        out[f"psi_{o}"] = adjustment.dr_scores(out["t"], out[o], d["propensity"].astype(float),
                                               d[f"mu1_{o}"].astype(float), d[f"mu0_{o}"].astype(float), (lo, hi))
    return out


def permutation_importance(model, X, t, y, psi, seed: int = config.SEED, repeats: int = REPEATS, n_bins: int = 50) -> list[dict]:
    rng = np.random.default_rng(seed)

    def gain(Xm):
        r = metrics.evaluate({"m": model.predict_uplift(Xm)}, t, y, psi, n_bins=n_bins, n_boot=0, seed=seed)
        return r["models"]["m"]["metrics"]["gain_over_random_adjusted"]["value"]

    base = gain(X)
    rows = []
    for j, f in enumerate(config.FEATURES):
        drops = []
        for _ in range(repeats):
            Xp = X.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            drops.append(base - gain(Xp))
        rows.append({"feature": f, "drop": float(np.mean(drops)), "drop_min": float(np.min(drops)), "drop_max": float(np.max(drops)),
                     "share_of_gain": float(np.mean(drops) / base) if base > 0 else None})
    rows.sort(key=lambda r: -r["drop"])
    return [{"base_gain": base, **r} for r in rows]


def segment_agreement(con, outcome: str, model_id: str) -> list[dict]:
    """Mean predicted vs observed (DR) uplift per feature segment on the test split, computed in DuckDB."""
    col = f"{outcome}__{model_id}"
    con.execute("CREATE OR REPLACE TEMP TABLE segment_map AS SELECT * FROM v_feature_segments")
    feats = ", ".join(config.FEATURES)
    rows = con.sql(
        f"""
        WITH scored AS (
            SELECT {", ".join("e." + f for f in config.FEATURES)}, p.{col} AS pred, p.psi_{outcome} AS psi
            FROM predictions p JOIN experiment e USING (row_id) WHERE p.split = 'test'
        ),
        long AS (UNPIVOT scored ON {feats} INTO NAME feature VALUE value)
        SELECT l.feature, g.segment_id, count(*) AS n, avg(pred), avg(psi), stddev_samp(psi) / sqrt(count(*))
        FROM long l JOIN segment_map g USING (feature, value)
        GROUP BY l.feature, g.segment_id ORDER BY CAST(substr(l.feature, 2) AS INTEGER), g.segment_id
        """
    ).fetchall()
    names = {0: "Modal value", 1: "Non-modal: low", 2: "Non-modal: mid", 3: "Non-modal: high"}
    return [{"feature": f, "segment_id": s, "segment": names[s], "n_users": n, "mean_predicted": p, "observed": o,
             "observed_std_error": se} for f, s, n, p, o, se in rows]


def persuadables_profile(X: np.ndarray, score: np.ndarray, modal: dict, top: float = 0.1) -> list[dict]:
    """Top-``top`` users by predicted uplift vs the rest: standardised differences and share off the modal value."""
    cut = np.quantile(score, 1 - top)
    is_top = score >= cut
    rows = []
    for j, f in enumerate(config.FEATURES):
        a, b = X[is_top, j].astype(float), X[~is_top, j].astype(float)
        m = float(np.float32(modal[f]))  # X is float32: compare at the same precision
        sd = np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2) or 1.0
        rows.append({
            "feature": f,
            "smd": float((a.mean() - b.mean()) / sd),
            "share_off_modal_top": float((a != m).mean()),
            "share_off_modal_rest": float((b != m).mean()),
        })
    rows.sort(key=lambda r: -abs(r["smd"]))
    return rows


def explain(scope: config.Scope, seed: int = config.SEED) -> dict:
    models = artifacts.read(scope.name, "models")["data"]["outcomes"]
    con = runner.connect(scope)
    test = _test_rows(con, scope)
    modal = dict(con.sql("SELECT feature, value FROM v_feature_segments WHERE segment_id = 0").fetchall())
    rng = np.random.default_rng(seed)
    n = len(test["t"])
    take = np.sort(rng.choice(n, size=min(IMPORTANCE_SAMPLE, n), replace=False))

    out = {"outcomes": {}, "importance_sample": {"rows": int(len(take)), "of_test_rows": int(n), "repeats": REPEATS,
                                                  "rule": "seeded uniform sample of test users without replacement"}}
    for o, mo in models.items():
        card = next(c for c in mo["models"] if c["id"] == mo["champion"])
        model = joblib.load(_model_path(scope, o, card))
        out["outcomes"][o] = {
            "model_id": card["id"],
            "model_name": card["name"],
            "model_version": card["version"],
            "importance": permutation_importance(model, test["X"][take], test["t"][take], test[o][take], test[f"psi_{o}"][take], seed),
            "segment_agreement": segment_agreement(con, o, card["id"]),
            "persuadables": persuadables_profile(test["X"], model.predict_uplift(test["X"]), modal),
        }
        seg = out["outcomes"][o]["segment_agreement"]
        p = np.array([s["mean_predicted"] for s in seg])
        q = np.array([s["observed"] for s in seg])
        w = np.array([s["n_users"] for s in seg], dtype=float)
        out["outcomes"][o]["agreement_correlation"] = float(np.corrcoef(p, q)[0, 1]) if len(seg) > 2 else None
        out["outcomes"][o]["agreement_weighted_mae"] = float(np.sum(w * np.abs(p - q)) / w.sum())
    return out
