"""Held-out evaluation of uplift rankings.

All curves are built from per-bin sufficient statistics after ranking users by
model score, so the same code yields point estimates and (with Poisson
bootstrap weights) uncertainty bands.

Two evaluation bases are reported side by side:

* ``unadjusted`` - within the top-phi users, treated outcome rate minus control
  outcome rate (the classic uplift / Qini construction);
* ``adjusted``   - mean of cross-fitted doubly-robust scores psi_i among the
  top-phi users, which corrects for covariate imbalance between arms.

"Gain" is always expressed as incremental outcomes per user in the whole
evaluated population when the top-phi fraction is treated and nobody else is.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

STAT_COLUMNS = ("n_t", "n_c", "y_t", "y_c", "psi")
TOP_K = (0.1, 0.2, 0.3, 0.5)


def rank_bins(score: np.ndarray, n_bins: int, seed: int) -> np.ndarray:
    """Assign each row to an equal-size rank bin (0 = highest scores).

    Ties are broken by a seeded random key: the features are heavily tied, and
    breaking ties by file order would leak the file's non-random structure.
    """
    n = len(score)
    tie = np.random.default_rng(seed).random(n)
    order = np.lexsort((tie, -np.asarray(score, dtype=np.float64)))
    bins = np.empty(n, dtype=np.int32)
    bins[order] = (np.arange(n, dtype=np.int64) * n_bins // n).astype(np.int32)
    return bins


def bin_stats(bins: np.ndarray, t: np.ndarray, y: np.ndarray, psi: Optional[np.ndarray], n_bins: int,
              w: Optional[np.ndarray] = None) -> np.ndarray:
    """Per-bin [n_t, n_c, y_t, y_c, sum(psi)], optionally weighted. Shape (n_bins, 5)."""
    tt = t.astype(np.float64)
    yy = y.astype(np.float64)
    if w is None:
        w = np.ones(len(tt))
    wt = w * tt
    wc = w - wt
    cols = [wt, wc, wt * yy, wc * yy, w * psi if psi is not None else np.zeros(len(tt))]
    return np.column_stack([np.bincount(bins, weights=c, minlength=n_bins) for c in cols])


def curves(stats: np.ndarray) -> dict:
    """Cumulative curves from bin stats. ``stats`` is (..., n_bins, 5); output arrays are (..., n_bins + 1)."""
    zero = np.zeros(stats.shape[:-2] + (1, stats.shape[-1]))
    cum = np.concatenate([zero, np.cumsum(stats, axis=-2)], axis=-2)
    n_t, n_c, y_t, y_c, psi = (cum[..., j] for j in range(5))
    n = n_t + n_c
    total = n[..., -1:]
    with np.errstate(divide="ignore", invalid="ignore"):
        rate_t = np.where(n_t > 0, y_t / n_t, 0.0)
        rate_c = np.where(n_c > 0, y_c / n_c, 0.0)
        ratio = np.where(n_c > 0, n_t / n_c, 0.0)
    return {
        "fraction": n / total,
        "unadjusted": (rate_t - rate_c) * n / total,
        "adjusted": psi / total,
        "qini": (y_t - y_c * ratio) / n_t[..., -1:],
    }


def _area(curve: np.ndarray, n_bins: int) -> np.ndarray:
    """Trapezoid area over the equal-width fraction grid."""
    return (curve[..., 1:] + curve[..., :-1]).sum(axis=-1) / (2 * n_bins)


def summarize(c: dict) -> dict:
    """Scalar metrics from curves (vectorised over leading bootstrap dimensions)."""
    n_bins = c["unadjusted"].shape[-1] - 1
    out = {}
    for basis in ("unadjusted", "adjusted"):
        g = c[basis]
        auuc = _area(g, n_bins)
        out[f"auuc_{basis}"] = auuc
        out[f"gain_over_random_{basis}"] = auuc - g[..., -1] / 2
        out[f"total_effect_{basis}"] = g[..., -1]
        for k in TOP_K:
            idx = int(round(k * n_bins))
            out[f"uplift_at_{int(k * 100)}_{basis}"] = g[..., idx] / k
    q = c["qini"]
    out["qini_coefficient"] = _area(q, n_bins) - q[..., -1] / 2
    return out


def random_curves(c: dict) -> dict:
    """Random targeting: every prefix has the population-average effect, i.e. a straight line to the endpoint."""
    n_bins = c["unadjusted"].shape[-1] - 1
    frac = np.linspace(0, 1, n_bins + 1)
    out = {"fraction": np.broadcast_to(frac, c["unadjusted"].shape).copy()}
    for key in ("unadjusted", "adjusted", "qini"):
        out[key] = c[key][..., -1:] * frac
    return out


def evaluate(scores: dict, t: np.ndarray, y: np.ndarray, psi: Optional[np.ndarray], n_bins: int = 100,
             n_boot: int = 200, seed: int = 0, random_id: str = "random", reference_id: Optional[str] = None,
             ci: float = 0.95) -> dict:
    """Evaluate several score vectors on the same rows with a paired Poisson bootstrap.

    Returns per-model curves with percentile bands, scalar metrics with intervals,
    paired differences against ``reference_id``, and the raw bootstrap gain curves
    (used by the decision simulator for risk-adjusted choices).
    """
    bins = {m: rank_bins(s, n_bins, seed) for m, s in scores.items()}
    point = {m: curves(bin_stats(b, t, y, psi, n_bins)) for m, b in bins.items()}
    first = next(iter(point.values()))
    point[random_id] = random_curves(first)

    rng = np.random.default_rng(seed + 1)
    boot = {m: np.empty((n_boot, n_bins, 5)) for m in bins}
    for b in range(n_boot):
        w = rng.poisson(1.0, len(t)).astype(np.float64)
        for m, bn in bins.items():
            boot[m][b] = bin_stats(bn, t, y, psi, n_bins, w)
    boot_curves = {m: curves(s) for m, s in boot.items()}
    if n_boot:
        boot_curves[random_id] = random_curves(next(iter(boot_curves.values())))

    lo_q, hi_q = (1 - ci) / 2 * 100, (1 + ci) / 2 * 100
    # Bins are equal-size by rank, so the nominal grid is exact up to one row.
    result = {"fraction": np.linspace(0, 1, n_bins + 1).tolist(), "models": {}, "n_rows": int(len(t)), "n_bins": n_bins,
              "n_boot": n_boot, "ci_level": ci, "bootstrap": {}}
    point_metrics = {m: summarize(c) for m, c in point.items()}
    boot_metrics = {m: summarize(c) for m, c in boot_curves.items()} if n_boot else {}
    for m in point:
        entry = {"curves": {}, "metrics": {}}
        for key in ("unadjusted", "adjusted", "qini"):
            cur = {"value": point[m][key].tolist()}
            if n_boot:
                cur["low"] = np.percentile(boot_curves[m][key], lo_q, axis=0).tolist()
                cur["high"] = np.percentile(boot_curves[m][key], hi_q, axis=0).tolist()
            entry["curves"][key] = cur
        for name, val in point_metrics[m].items():
            met = {"value": float(val)}
            if n_boot:
                bs = boot_metrics[m][name]
                met.update(low=float(np.percentile(bs, lo_q)), high=float(np.percentile(bs, hi_q)), std_error=float(bs.std(ddof=1)))
                if reference_id and m != reference_id and reference_id in boot_metrics:
                    diff = bs - boot_metrics[reference_id][name]
                    met["vs_reference"] = {
                        "reference": reference_id,
                        "difference": float(val - point_metrics[reference_id][name]),
                        "low": float(np.percentile(diff, lo_q)),
                        "high": float(np.percentile(diff, hi_q)),
                        "prob_better": float((diff > 0).mean()),
                    }
            entry["metrics"][name] = met
        result["models"][m] = entry
        if n_boot:
            result["bootstrap"][m] = {k: boot_curves[m][k].astype(np.float32) for k in ("unadjusted", "adjusted")}
    return result


def score_thresholds(score: np.ndarray, n_bins: int) -> list:
    """Score of the last user included when the top k/n_bins of users are targeted (None at k = 0)."""
    ordered = np.sort(np.asarray(score, dtype=np.float64))[::-1]
    n = len(ordered)
    return [None] + [float(ordered[min(n - 1, max(0, (k * n) // n_bins - 1))]) for k in range(1, n_bins + 1)]


def uplift_calibration(pred: np.ndarray, t: np.ndarray, y: np.ndarray, psi: Optional[np.ndarray], n_groups: int = 10,
                       seed: int = 0) -> list[dict]:
    """Predicted vs observed uplift within groups of predicted uplift (group 1 = highest)."""
    g = rank_bins(pred, n_groups, seed)
    rows = []
    for k in range(n_groups):
        m = g == k
        tt, yy = t[m], y[m]
        n_t, n_c = int(tt.sum()), int((1 - tt).sum())
        p_t = float(yy[tt == 1].mean()) if n_t else float("nan")
        p_c = float(yy[tt == 0].mean()) if n_c else float("nan")
        se = float(np.sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c)) if n_t and n_c else float("nan")
        row = {
            "group": k + 1,
            "n_users": int(m.sum()),
            "treatment_share": n_t / max(1, n_t + n_c),
            "mean_predicted_uplift": float(pred[m].mean()),
            "observed_uplift": p_t - p_c,
            "observed_std_error": se,
            "rate_treatment": p_t,
            "rate_control": p_c,
        }
        if psi is not None:
            row["observed_uplift_adjusted"] = float(psi[m].mean())
            row["observed_adjusted_std_error"] = float(psi[m].std(ddof=1) / np.sqrt(m.sum()))
        rows.append(row)
    return rows


def classifier_diagnostics(p: np.ndarray, y: np.ndarray, n_groups: int = 10) -> dict:
    """Discrimination and calibration of one outcome model on held-out rows."""
    from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

    p = np.clip(p, 1e-9, 1 - 1e-9)
    order = np.argsort(p, kind="stable")
    groups = np.array_split(order, n_groups)
    reliability = [
        {"group": i + 1, "n": int(len(ix)), "mean_predicted": float(p[ix].mean()), "observed_rate": float(y[ix].mean())}
        for i, ix in enumerate(groups) if len(ix)
    ]
    return {
        "n": int(len(y)),
        "positives": int(y.sum()),
        "auc": float(roc_auc_score(y, p)) if 0 < y.sum() < len(y) else None,
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier": float(brier_score_loss(y, p)),
        "base_rate": float(y.mean()),
        "reliability": reliability,
    }
