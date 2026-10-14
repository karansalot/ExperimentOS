"""Covariate-adjusted treatment-effect estimators.

Used as sensitivity analyses next to the unadjusted difference in proportions:
if assignment is truly random all three agree up to noise; if they disagree,
covariates are imbalanced across arms and the unadjusted number is suspect.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import stats as st

from .. import config
from ..data.hashing import bucket
from ..learners import gradient_boosting


def _ci(est: float, se: float, alpha: float) -> tuple[float, float]:
    z = float(st.norm.ppf(1 - alpha / 2))
    return est - z * se, est + z * se


def lin_estimator(X: np.ndarray, t: np.ndarray, y: np.ndarray, alpha: float = config.ALPHA, chunk: int = 500_000) -> dict:
    """Lin (2013) regression adjustment: OLS of y on treatment, centred covariates and their interactions.

    The coefficient on treatment estimates the ATE. Standard errors are
    heteroskedasticity-robust (HC1). Two streaming passes over the data.
    """
    n, k = X.shape
    mu = X.mean(axis=0, dtype=np.float64)
    sd = X.std(axis=0, dtype=np.float64)
    sd[sd == 0] = 1.0
    p = 2 + 2 * k

    def design(i: int) -> tuple[np.ndarray, np.ndarray]:
        Z = (X[i : i + chunk].astype(np.float64) - mu) / sd
        tt = t[i : i + chunk].astype(np.float64)
        D = np.column_stack([np.ones(len(tt)), tt, Z, Z * tt[:, None]])
        return D, y[i : i + chunk].astype(np.float64)

    xtx = np.zeros((p, p))
    xty = np.zeros(p)
    # Apple Accelerate raises spurious floating-point flags inside matmul; results are checked below instead.
    with np.errstate(all="ignore"):
        for i in range(0, n, chunk):
            D, yy = design(i)
            xtx += D.T @ D
            xty += D.T @ yy
        bread = np.linalg.inv(xtx)
        beta = bread @ xty
        meat = np.zeros((p, p))
        for i in range(0, n, chunk):
            D, yy = design(i)
            e = yy - D @ beta
            De = D * e[:, None]
            meat += De.T @ De
        cov = bread @ meat @ bread * (n / (n - p))
    if not (np.all(np.isfinite(beta)) and np.all(np.isfinite(cov))):
        raise FloatingPointError("Regression adjustment produced non-finite values (collinear covariates?)")
    est, se = float(beta[1]), float(math.sqrt(cov[1, 1]))
    lo, hi = _ci(est, se, alpha)
    return {"method": "Regression adjustment (Lin 2013, HC1)", "estimate": est, "std_error": se, "ci_low": lo, "ci_high": hi, "n": int(n)}


def cross_fit_nuisances(
    X: np.ndarray,
    t: np.ndarray,
    outcomes: dict,
    row_id: np.ndarray,
    n_folds: int = 2,
    seed: int = config.SEED,
) -> dict:
    """Out-of-fold propensity e(x) and outcome models mu_1(x), mu_0(x) for every outcome.

    Folds come from a salted hash of row_id, so they are reproducible. Each row is
    scored only by models that never saw it.
    """
    fold = bucket(row_id.astype(np.uint64), seed, n_folds)
    n = len(t)
    e = np.empty(n)
    mu1 = {k: np.empty(n) for k in outcomes}
    mu0 = {k: np.empty(n) for k in outcomes}
    for f in range(n_folds):
        tr, te = fold != f, fold == f
        e[te] = gradient_boosting(seed).fit(X[tr], t[tr]).predict_proba(X[te])[:, 1]
        for name, y in outcomes.items():
            tr1, tr0 = tr & (t == 1), tr & (t == 0)
            mu1[name][te] = gradient_boosting(seed).fit(X[tr1], y[tr1]).predict_proba(X[te])[:, 1]
            mu0[name][te] = gradient_boosting(seed).fit(X[tr0], y[tr0]).predict_proba(X[te])[:, 1]
    return {"propensity": e, "mu1": mu1, "mu0": mu0, "n_folds": n_folds}


def dr_scores(t: np.ndarray, y: np.ndarray, e: np.ndarray, mu1: np.ndarray, mu0: np.ndarray,
              clip: tuple[float, float] = config.PROPENSITY_CLIP) -> np.ndarray:
    """Doubly-robust score psi_i; its mean over any covariate-defined group estimates that group's ATE."""
    ec = np.clip(e, *clip)
    tt, yy = t.astype(np.float64), y.astype(np.float64)
    return mu1 - mu0 + tt * (yy - mu1) / ec - (1 - tt) * (yy - mu0) / (1 - ec)


def aipw(
    t: np.ndarray,
    y: np.ndarray,
    e: np.ndarray,
    mu1: np.ndarray,
    mu0: np.ndarray,
    clip: tuple[float, float] = config.PROPENSITY_CLIP,
    alpha: float = config.ALPHA,
) -> dict:
    """Augmented inverse-propensity-weighted (doubly robust) ATE from cross-fitted nuisances.

    Consistent if either the propensity model or the outcome models are right.
    The standard error is the sample standard deviation of the influence function.
    """
    psi = dr_scores(t, y, e, mu1, mu0, clip)
    est = float(psi.mean())
    se = float(psi.std(ddof=1) / math.sqrt(len(psi)))
    lo, hi = _ci(est, se, alpha)
    return {
        "method": "AIPW / doubly robust (cross-fitted gradient boosting)",
        "estimate": est,
        "std_error": se,
        "ci_low": lo,
        "ci_high": hi,
        "n": int(len(psi)),
        "propensity_clip": list(clip),
        "share_propensity_clipped": float(np.mean((e < clip[0]) | (e > clip[1]))),
    }


def variance_reduction(unadjusted_se: float, adjusted_se: float) -> dict:
    """CUPED-style read-out: how much variance covariate adjustment removes and what that is worth in sample size."""
    ratio = (adjusted_se / unadjusted_se) ** 2
    return {
        "variance_reduction": 1 - ratio,
        "effective_sample_multiplier": 1 / ratio,
        "ci_width_reduction": 1 - adjusted_se / unadjusted_se,
    }


def save_nuisances(scope: config.Scope, row_id: np.ndarray, nuis: dict) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    cols = {"row_id": row_id, "propensity": nuis["propensity"].astype(np.float32)}
    for o in nuis["mu1"]:
        cols[f"mu1_{o}"] = nuis["mu1"][o].astype(np.float32)
        cols[f"mu0_{o}"] = nuis["mu0"][o].astype(np.float32)
    scope.nuisances.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(cols), scope.nuisances, compression="zstd")


def load_nuisances(scope: config.Scope, row_id: np.ndarray) -> dict:
    """Load saved nuisances and check they are aligned with ``row_id``."""
    import pyarrow.parquet as pq

    tbl = pq.read_table(scope.nuisances).to_pydict()
    if not np.array_equal(np.asarray(tbl["row_id"]), row_id):
        raise ValueError("Saved nuisances are not aligned with the loaded rows; re-run the stats step.")
    outcomes = [c[4:] for c in tbl if c.startswith("mu1_")]
    return {
        "propensity": np.asarray(tbl["propensity"], dtype=np.float64),
        "mu1": {o: np.asarray(tbl[f"mu1_{o}"], dtype=np.float64) for o in outcomes},
        "mu0": {o: np.asarray(tbl[f"mu0_{o}"], dtype=np.float64) for o in outcomes},
    }
