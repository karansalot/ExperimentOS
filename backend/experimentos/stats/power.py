"""Experiment design: power, sample size and minimum detectable effect for a two-arm test of proportions.

The formulas match the test the platform actually runs (two-sided pooled two-proportion
z-test): the critical value uses the pooled standard error under H0, the power uses the
unpooled standard error under H1. With an unbalanced allocation (the Criteo design is
85/15) the two differ noticeably, so using one variance for both would mis-state power.
"""
from __future__ import annotations

import math

from scipy import stats as st


def _check(base_rate: float, delta: float, treatment_share: float, alpha: float) -> None:
    if not 0 < base_rate < 1:
        raise ValueError("base_rate must be strictly between 0 and 1")
    if not 0 < base_rate + delta < 1:
        raise ValueError("base_rate + effect must stay strictly between 0 and 1")
    if delta == 0:
        raise ValueError("the effect to detect must be non-zero")
    if not 0 < treatment_share < 1:
        raise ValueError("treatment_share must be strictly between 0 and 1")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be strictly between 0 and 1")


def _unit_variance(base_rate: float, delta: float, treatment_share: float) -> float:
    """n * Var(difference in proportions) for a total sample of n users."""
    p1 = base_rate + delta
    return p1 * (1 - p1) / treatment_share + base_rate * (1 - base_rate) / (1 - treatment_share)


def _null_unit_variance(base_rate: float, delta: float, treatment_share: float) -> float:
    """n * Var(difference) under H0, using the pooled rate the z-test uses."""
    pooled = treatment_share * (base_rate + delta) + (1 - treatment_share) * base_rate
    return pooled * (1 - pooled) * (1 / treatment_share + 1 / (1 - treatment_share))


def power(n_total: float, base_rate: float, delta: float, treatment_share: float = 0.5, alpha: float = 0.05) -> float:
    """Probability that the pooled z-test rejects H0 when the true absolute effect is ``delta``."""
    _check(base_rate, delta, treatment_share, alpha)
    if n_total <= 0:
        return 0.0
    se0 = math.sqrt(_null_unit_variance(base_rate, delta, treatment_share) / n_total)
    se1 = math.sqrt(_unit_variance(base_rate, delta, treatment_share) / n_total)
    z = float(st.norm.ppf(1 - alpha / 2))
    d = abs(delta)
    return float(st.norm.cdf((d - z * se0) / se1) + st.norm.cdf((-d - z * se0) / se1))


def required_sample_size(base_rate: float, delta: float, treatment_share: float = 0.5, alpha: float = 0.05,
                         target_power: float = 0.8) -> dict:
    """Total users needed to detect an absolute effect ``delta`` with the requested power."""
    _check(base_rate, delta, treatment_share, alpha)
    if not 0 < target_power < 1:
        raise ValueError("power must be strictly between 0 and 1")
    z_a, z_b = float(st.norm.ppf(1 - alpha / 2)), float(st.norm.ppf(target_power))
    root = z_a * math.sqrt(_null_unit_variance(base_rate, delta, treatment_share)) + z_b * math.sqrt(_unit_variance(base_rate, delta, treatment_share))
    n = math.ceil(root * root / (delta * delta))
    n_t = math.ceil(n * treatment_share)
    return {"n_total": n, "n_treatment": n_t, "n_control": n - n_t, "achieved_power": power(n, base_rate, delta, treatment_share, alpha)}


def minimum_detectable_effect(n_total: float, base_rate: float, treatment_share: float = 0.5, alpha: float = 0.05,
                              target_power: float = 0.8) -> float:
    """Smallest positive absolute effect detectable with the requested power (bisection on ``power``)."""
    lo, hi = 0.0, 1 - base_rate - 1e-9
    if power(n_total, base_rate, hi, treatment_share, alpha) < target_power:
        return float("nan")
    for _ in range(80):
        mid = (lo + hi) / 2
        if power(n_total, base_rate, mid, treatment_share, alpha) < target_power:
            lo = mid
        else:
            hi = mid
    return hi


def plan(base_rate: float, mde_relative: float, treatment_share: float = 0.5, alpha: float = 0.05, target_power: float = 0.8,
         users_per_day: float | None = None, observed_n: float | None = None) -> dict:
    """A complete design read-out for the experiment planner page."""
    delta = base_rate * mde_relative
    need = required_sample_size(base_rate, delta, treatment_share, alpha, target_power)
    balanced = required_sample_size(base_rate, delta, 0.5, alpha, target_power)
    n = need["n_total"]

    grid = sorted({max(100, round(n * f)) for f in (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0)})
    power_curve = [{"n_total": g, "power": power(g, base_rate, delta, treatment_share, alpha)} for g in grid]

    allocations = []
    for share in (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95):
        r = required_sample_size(base_rate, delta, share, alpha, target_power)
        allocations.append({"treatment_share": share, **r, "relative_to_balanced": r["n_total"] / balanced["n_total"]})

    out = {
        "inputs": {"base_rate": base_rate, "mde_relative": mde_relative, "mde_absolute": delta, "treatment_share": treatment_share,
                   "alpha": alpha, "power": target_power, "users_per_day": users_per_day},
        "required": need,
        "balanced_design": balanced,
        "allocation_cost": need["n_total"] / balanced["n_total"],
        "days_required": math.ceil(n / users_per_day) if users_per_day else None,
        "power_curve": power_curve,
        "allocations": allocations,
        "test": "Two-sided pooled two-proportion z-test (pooled SE under H0, unpooled SE under H1)",
    }
    if observed_n:
        mde = minimum_detectable_effect(observed_n, base_rate, treatment_share, alpha, target_power)
        out["observed_experiment"] = {
            "n_total": int(observed_n),
            "mde_absolute": mde,
            "mde_relative": mde / base_rate,
            "power_for_requested_effect": power(observed_n, base_rate, delta, treatment_share, alpha),
            "times_larger_than_required": observed_n / n,
        }
    return out
