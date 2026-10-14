"""Train the uplift models on the train split, select on validation, report on test."""
from __future__ import annotations

import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from typing import Callable, Optional

import joblib
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import sklearn

from .. import config
from ..data.loader import load_frame
from ..stats import adjustment
from . import metrics
from .models import RANDOM_BASELINE, ResponseModel, SLearnerGBM, TLearnerGBM, TwoModelLogit, UpliftModel

SELECTION_METRIC = "gain_over_random_adjusted"
MODEL_ORDER = ["random", "response", "two_model_logit", "t_learner_gbm", "s_learner_gbm"]


def model_version(scope: config.Scope, outcome: str, model_id: str, params: dict, seed: int) -> str:
    """Content hash of everything that determines a fitted model."""
    key = {
        "dataset_sha256": config.DATASET["raw_sha256"],
        "scope": scope.name,
        "split": [config.TRAIN_BUCKETS, config.SPLIT_SALT],
        "outcome": outcome,
        "model": model_id,
        "params": params,
        "seed": seed,
        "code": config.CODE_VERSION,
        "sklearn": sklearn.__version__,
    }
    return hashlib.sha256(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _describe(model, scope, outcome, seed) -> dict:
    d = RANDOM_BASELINE if model is None else {
        "id": model.id, "name": model.name, "family": model.family, "description": model.description,
        "estimates_uplift": model.estimates_uplift, "params": model.params,
    }
    return {**d, "version": model_version(scope, outcome, d["id"], d["params"], seed)}


def train_and_evaluate(
    scope: config.Scope,
    frame: Optional[dict] = None,
    seed: int = config.SEED,
    n_boot: int = 200,
    n_bins: int = 100,
    progress: Optional[Callable[[str, int, int], None]] = None,
    save_models: bool = True,
) -> dict:
    """Returns {'models': ..., 'curves': ..., 'bootstrap': {outcome: {...}}} and writes predictions to Parquet."""
    started = datetime.now(timezone.utc)
    t_start = time.time()
    d = frame or load_frame(scope)
    X, t, split = d["X"], d["treatment"], d["split"]
    tr = split == "train"
    ev = ~tr  # validation + test rows are only ever scored, never fitted on
    if not scope.nuisances.exists():
        nuis = adjustment.cross_fit_nuisances(X, t, {o: d[o] for o in config.OUTCOMES}, d["row_id"], seed=seed)
        adjustment.save_nuisances(scope, d["row_id"], nuis)
    nuis = adjustment.load_nuisances(scope, d["row_id"])

    steps_total = len(config.OUTCOMES) * 5
    step = 0

    def tick(msg: str) -> None:
        nonlocal step
        step += 1
        if progress:
            progress(msg, step, steps_total)

    pred_cols = {
        "row_id": d["row_id"][ev], "split": split[ev], "treatment": t[ev],
        "propensity": nuis["propensity"][ev].astype(np.float32),
    }
    models_out, curves_out, boot_out, boot_valid_out = {}, {}, {}, {}
    model_dir = scope.artifacts / "models"

    for outcome in config.OUTCOMES:
        y = d[outcome]
        psi = adjustment.dr_scores(t, y, nuis["propensity"], nuis["mu1"][outcome], nuis["mu0"][outcome])
        pred_cols[outcome] = y[ev]
        pred_cols[f"psi_{outcome}"] = psi[ev].astype(np.float32)

        fitted: list[UpliftModel] = []
        fit_info = {}
        for cls in (TLearnerGBM, SLearnerGBM, TwoModelLogit):
            t0 = time.time()
            m = cls(seed).fit(X[tr], t[tr], y[tr])
            fit_info[m.id] = round(time.time() - t0, 1)
            fitted.append(m)
            tick(f"{outcome}: fitted {m.name}")
        # The response baseline is exactly the treated-arm model of the T-learner; reuse the fit.
        t_gbm = fitted[0]
        resp = ResponseModel(seed, fitted=t_gbm.mu1)
        fit_info[resp.id] = None  # shares the T-learner's treated-arm fit
        fitted.insert(0, resp)

        Xe, te, ye, pe, se = X[ev], t[ev], y[ev], psi[ev], split[ev]
        scores, uplift, comps = {}, {}, {}
        for m in fitted:
            comps[m.id] = m.component_predictions(Xe)
            if m.estimates_uplift:
                uplift[m.id] = comps[m.id]["treatment"] - comps[m.id]["control"]
                scores[m.id] = uplift[m.id]
            else:
                scores[m.id] = comps[m.id]["treatment"]
            pred_cols[f"{outcome}__{m.id}"] = scores[m.id].astype(np.float32)
        tick(f"{outcome}: scored validation and test rows")

        is_valid, is_test = se == "valid", se == "test"
        # Validation is bootstrapped too: the simulator chooses targeting depth on validation
        # and reports profit on test, so the reported profit is not tuned on the data it is measured on.
        valid = metrics.evaluate({k: v[is_valid] for k, v in scores.items()}, te[is_valid], ye[is_valid], pe[is_valid],
                                 n_bins=n_bins, n_boot=n_boot, seed=seed + 101)
        test = metrics.evaluate({k: v[is_test] for k, v in scores.items()}, te[is_test], ye[is_test], pe[is_test],
                                n_bins=n_bins, n_boot=n_boot, seed=seed, reference_id="response")
        tick(f"{outcome}: evaluated with {n_boot} bootstrap replicates")

        candidates = [m.id for m in fitted if m.estimates_uplift]
        champion = max(candidates, key=lambda k: valid["models"][k]["metrics"][SELECTION_METRIC]["value"])

        cards = []
        by_id = {m.id: m for m in fitted}
        for mid in MODEL_ORDER:
            m = by_id.get(mid)
            card = _describe(m, scope, outcome, seed)
            card.update(
                fit_seconds=fit_info.get(mid),
                validation_metrics={k: v["value"] for k, v in valid["models"][mid]["metrics"].items()},
                test_metrics=test["models"][mid]["metrics"],
                is_champion=mid == champion,
            )
            if m is not None:
                diag = {}
                for arm, p in comps[mid].items():
                    mask = is_test & (te == (1 if arm == "treatment" else 0))
                    diag[arm] = metrics.classifier_diagnostics(p[mask], ye[mask])
                card["outcome_models"] = diag
                if m.estimates_uplift:
                    card["calibration"] = metrics.uplift_calibration(uplift[mid][is_test], te[is_test], ye[is_test], pe[is_test], seed=seed)
                    u = uplift[mid][is_test]
                    card["predicted_uplift_summary"] = {
                        "mean": float(u.mean()), "p05": float(np.quantile(u, 0.05)), "p50": float(np.quantile(u, 0.5)),
                        "p95": float(np.quantile(u, 0.95)), "share_negative": float((u < 0).mean()),
                    }
                if save_models:
                    model_dir.mkdir(parents=True, exist_ok=True)
                    joblib.dump(m, model_dir / f"{outcome}__{mid}__{card['version']}.joblib", compress=3)
            cards.append(card)

        models_out[outcome] = {
            "models": cards,
            "champion": champion,
            "selection": {
                "metric": SELECTION_METRIC,
                "split": "valid",
                "rule": "Highest validation gain over random on the covariate-adjusted basis, among models that estimate uplift.",
            },
            "rows": {
                "train": int(tr.sum()), "train_treatment": int((tr & (t == 1)).sum()), "train_control": int((tr & (t == 0)).sum()),
                "valid": int(is_valid.sum()), "test": int(is_test.sum()),
                "test_treatment": int(te[is_test].sum()), "test_control": int((1 - te[is_test]).sum()),
                "train_positives": int(y[tr].sum()), "test_positives": int(ye[is_test].sum()),
            },
        }
        curves_out[outcome] = {
            "fraction": test["fraction"], "n_rows": test["n_rows"], "n_bins": n_bins, "n_boot": n_boot,
            "ci_level": test["ci_level"], "split": "test",
            "models": {mid: test["models"][mid]["curves"] for mid in MODEL_ORDER},
            "validation": {
                "n_rows": valid["n_rows"],
                "models": {mid: {b: valid["models"][mid]["curves"][b]["value"] for b in ("adjusted", "unadjusted")} for mid in MODEL_ORDER},
            },
            # Model score of the last user included at each targeting depth (test split): the deployable rule
            # "treat users whose score is at least x". None at depth 0 and for random targeting.
            "score_thresholds": {mid: metrics.score_thresholds(scores[mid][is_test], n_bins) for mid in scores},
            "score_kind": {m.id: ("predicted uplift" if m.estimates_uplift else "predicted outcome probability") for m in fitted},
        }
        boot_out[outcome] = test["bootstrap"]
        boot_valid_out[outcome] = valid["bootstrap"]

    scope.predictions.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(pred_cols), scope.predictions, compression="zstd")

    models_payload = {
        "outcomes": models_out,
        "run": {
            "status": "completed",
            "started_at": started.isoformat(timespec="seconds"),
            "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seconds": round(time.time() - t_start, 1),
            "seed": seed,
            "n_boot": n_boot,
            "n_bins": n_bins,
            "tooling": {"python": platform.python_version(), "scikit_learn": sklearn.__version__, "numpy": np.__version__},
            "leakage_controls": [
                "Splits are a salted hash of row_id: every row is in exactly one of train / valid / test.",
                "Models are fitted on train rows only; validation selects the champion; test is used once for reporting.",
                "Doubly-robust evaluation scores are cross-fitted: no row is scored by a nuisance model that saw it.",
                "Gradient-boosting early stopping uses an internal 10% hold-out of the training rows, not valid/test.",
            ],
            "evaluation_bases": {
                "unadjusted": "Treated minus control outcome rate within the targeted group.",
                "adjusted": "Mean cross-fitted doubly-robust (AIPW) score within the targeted group.",
            },
        },
    }
    return {"models": models_payload, "curves": {"outcomes": curves_out}, "bootstrap": boot_out, "bootstrap_valid": boot_valid_out}


def save_bootstrap(scope: config.Scope, boot: dict, prefix: str = "bootstrap") -> None:
    """Persist bootstrap gain curves (replicates x grid) for the decision simulator."""
    for outcome, by_model in boot.items():
        arrays = {f"{mid}__{basis}": arr for mid, d in by_model.items() for basis, arr in d.items()}
        scope.artifacts.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(scope.artifacts / f"{prefix}_{outcome}.npz", **arrays)


def save_outputs(scope: config.Scope, out: dict, meta: dict) -> None:
    """Write everything the API needs from one training run."""
    from .. import artifacts

    artifacts.write(scope, "models", out["models"], meta)
    artifacts.write(scope, "curves", out["curves"], meta)
    save_bootstrap(scope, out["bootstrap"])
    save_bootstrap(scope, out["bootstrap_valid"], prefix="bootstrap_valid")
