"""Inference for binary outcomes from sufficient statistics (successes, trials).

Everything here works on counts, so the same functions serve 14 million rows or
a single segment, and never need row-level data.
"""
from __future__ import annotations

import math
from typing import Optional

from scipy import stats as st


def _z(alpha: float) -> float:
    return float(st.norm.ppf(1 - alpha / 2))


def wilson_interval(x: float, n: float, alpha: float = 0.05) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion."""
    if n <= 0:
        return (float("nan"), float("nan"))
    z = _z(alpha)
    p = x / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def two_proportion_test(x_t: float, n_t: float, x_c: float, n_c: float, alpha: float = 0.05) -> dict:
    """Treatment-vs-control comparison of two proportions.

    Returns the absolute effect with a Newcombe hybrid-score interval (and the
    Wald interval for reference), the relative effect with a log-scale (Katz)
    interval, and a two-sided pooled z-test of H0: p_t == p_c.
    """
    if min(n_t, n_c) <= 0:
        raise ValueError("Both arms need at least one user")
    p_t, p_c = x_t / n_t, x_c / n_c
    diff = p_t - p_c
    z_crit = _z(alpha)

    se = math.sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c)
    l_t, u_t = wilson_interval(x_t, n_t, alpha)
    l_c, u_c = wilson_interval(x_c, n_c, alpha)
    newcombe = (
        diff - math.sqrt((p_t - l_t) ** 2 + (u_c - p_c) ** 2),
        diff + math.sqrt((u_t - p_t) ** 2 + (p_c - l_c) ** 2),
    )

    p_pool = (x_t + x_c) / (n_t + n_c)
    se_pool = math.sqrt(p_pool * (1 - p_pool) * (1 / n_t + 1 / n_c))
    z_stat = diff / se_pool if se_pool > 0 else 0.0
    p_value = float(2 * st.norm.sf(abs(z_stat)))

    rel: Optional[float] = None
    rel_ci: Optional[tuple[float, float]] = None
    if x_c > 0:
        rel = p_t / p_c - 1
        if x_t > 0:
            se_log = math.sqrt((1 - p_t) / x_t + (1 - p_c) / x_c)
            log_rr = math.log(p_t / p_c)
            rel_ci = (math.exp(log_rr - z_crit * se_log) - 1, math.exp(log_rr + z_crit * se_log) - 1)

    return {
        "n_treatment": int(n_t),
        "n_control": int(n_c),
        "successes_treatment": int(x_t),
        "successes_control": int(x_c),
        "rate_treatment": p_t,
        "rate_control": p_c,
        "absolute_effect": diff,
        "std_error": se,
        "ci_low": newcombe[0],
        "ci_high": newcombe[1],
        "ci_method": "Newcombe hybrid score",
        "wald_ci_low": diff - z_crit * se,
        "wald_ci_high": diff + z_crit * se,
        "relative_effect": rel,
        "relative_ci_low": rel_ci[0] if rel_ci else None,
        "relative_ci_high": rel_ci[1] if rel_ci else None,
        "z_statistic": z_stat,
        "p_value": p_value,
        "alpha": alpha,
        "significant": p_value < alpha,
        "test": "Two-sided pooled two-proportion z-test",
    }


def srm_test(n_t: float, n_c: float, expected_treatment_share: float, alpha: float = 0.001) -> dict:
    """Chi-square goodness-of-fit test for sample ratio mismatch.

    The conventional SRM alarm threshold is strict (alpha = 0.001) because the
    check is run on every experiment and a false alarm halts analysis.
    """
    n = n_t + n_c
    e_t, e_c = n * expected_treatment_share, n * (1 - expected_treatment_share)
    chi2 = (n_t - e_t) ** 2 / e_t + (n_c - e_c) ** 2 / e_c
    p = float(st.chi2.sf(chi2, df=1))
    return {
        "n_treatment": int(n_t),
        "n_control": int(n_c),
        "expected_treatment_share": expected_treatment_share,
        "observed_treatment_share": n_t / n,
        "expected_treatment": e_t,
        "excess_treatment_users": n_t - e_t,
        "chi_square": chi2,
        "df": 1,
        "p_value": p,
        "alpha": alpha,
        "mismatch_detected": p < alpha,
    }


def minimum_detectable_effect(n_t: float, n_c: float, base_rate: float, alpha: float = 0.05, power: float = 0.8) -> dict:
    """Smallest absolute lift this design detects with the given power (two-sided z-test)."""
    se = math.sqrt(base_rate * (1 - base_rate) * (1 / n_t + 1 / n_c))
    mde = (_z(alpha) + float(st.norm.ppf(power))) * se
    return {
        "base_rate": base_rate,
        "alpha": alpha,
        "power": power,
        "mde_absolute": mde,
        "mde_relative": mde / base_rate if base_rate > 0 else None,
    }
