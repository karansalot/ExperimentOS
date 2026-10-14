"""Peeking and group-sequential testing, by simulation.

The data has no timestamps, so this module does not re-analyse Criteo over time. It shows,
with a seeded Monte Carlo of the test statistic's path, what repeated looks do to the false
positive rate and how alpha-spending boundaries repair it, for a design the user specifies.
Under H0 the z statistic at information fraction t_k behaves like B(t_k)/sqrt(t_k) for a
standard Brownian motion B, which is exact for large samples and independent of the base rate.
"""
from __future__ import annotations

import numpy as np
from scipy import stats as st

from .. import config


def _paths(n_looks: int, drift: float, sims: int, rng: np.random.Generator) -> np.ndarray:
    """z statistics at equally spaced looks; ``drift`` is the expected z at the final look."""
    t = np.arange(1, n_looks + 1) / n_looks
    inc = rng.standard_normal((sims, n_looks)) * np.sqrt(np.diff(np.concatenate([[0.0], t])))
    b = np.cumsum(inc, axis=1) + drift * t  # B(t) + theta * t
    return b / np.sqrt(t)


def _boundary(kind: str, n_looks: int, alpha: float, null_paths: np.ndarray) -> np.ndarray:
    """Two-sided critical values per look with overall type-I error ``alpha`` (calibrated on null paths)."""
    k = np.arange(1, n_looks + 1)
    shape = {"pocock": np.ones(n_looks), "obrien_fleming": np.sqrt(n_looks / k)}[kind]
    absz = np.abs(null_paths)

    def fpr(c: float) -> float:
        return float((absz >= c * shape).any(axis=1).mean())

    lo, hi = 0.5, 10.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if fpr(mid) <= alpha else (mid, hi)
    return hi * shape


def simulate(n_looks: int = 10, alpha: float = config.ALPHA, power: float = 0.8, sims: int = 100_000,
             seed: int = config.SEED) -> dict:
    """False-positive rate of naive peeking vs Pocock / O'Brien-Fleming boundaries, plus power and early stopping
    for an effect the fixed-horizon design is powered to detect."""
    if not 1 <= n_looks <= 50:
        raise ValueError("n_looks must be between 1 and 50")
    if not 0 < alpha < 0.5 or not 0 < power < 1:
        raise ValueError("alpha must be in (0, 0.5) and power in (0, 1)")
    rng = np.random.default_rng(seed)
    z_fixed = float(st.norm.ppf(1 - alpha / 2))
    drift = z_fixed + float(st.norm.ppf(power))  # expected final z for the design effect
    null = _paths(n_looks, 0.0, sims, rng)
    alt = _paths(n_looks, drift, sims, rng)
    looks = np.arange(1, n_looks + 1)

    designs = {
        "naive": np.full(n_looks, z_fixed),
        "pocock": _boundary("pocock", n_looks, alpha, null),
        "obrien_fleming": _boundary("obrien_fleming", n_looks, alpha, null),
    }
    labels = {
        "naive": "Peek every time at the fixed-horizon threshold",
        "pocock": "Pocock boundary (constant threshold)",
        "obrien_fleming": "O'Brien-Fleming boundary (strict early, lenient late)",
    }
    out = []
    for key, bound in designs.items():
        # Each design is calibrated on the first null sample and evaluated on a fresh one,
        # so the reported error rate is not the one the boundary was tuned to hit.
        fresh = _paths(n_looks, 0.0, sims, rng)
        reject_null = (np.abs(fresh) >= bound).any(axis=1)
        hits = np.abs(alt) >= bound
        stopped = hits.any(axis=1)
        first = np.where(stopped, hits.argmax(axis=1) + 1, n_looks)
        out.append({
            "id": key,
            "name": labels[key],
            "boundary_z": [float(b) for b in bound],
            "false_positive_rate": float(reject_null.mean()),
            "power": float(stopped.mean()),
            "expected_sample_fraction": float((first / n_looks).mean()),
            "stop_by_look": [float((stopped & (first <= k)).mean()) for k in looks],
        })
    # Naive false-positive rate as a function of how many times you look (same threshold every time).
    curve = []
    for k in sorted({1, 2, 3, 5, 10, 20, 30, 50} | {n_looks}):
        p = _paths(k, 0.0, sims // 2, rng)
        curve.append({"looks": k, "false_positive_rate": float((np.abs(p) >= z_fixed).any(axis=1).mean())})
    return {
        "inputs": {"n_looks": n_looks, "alpha": alpha, "power": power, "sims": sims, "seed": seed},
        "designs": out,
        "naive_fpr_by_looks": curve,
        "fixed_horizon_z": z_fixed,
        "method": ("Monte Carlo of the z-statistic path at equally spaced looks (Brownian motion approximation). "
                   "Boundaries are calibrated to the overall alpha on one simulated null sample and evaluated on another."),
        "note": "A design simulation, not a re-analysis of the Criteo data, which has no timestamps.",
    }


