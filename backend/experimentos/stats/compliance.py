"""One-sided non-compliance: complier average causal effect via the Wald estimator."""
from __future__ import annotations

import math

from scipy import stats as st


def wald_cace(
    itt: float,
    se_itt: float,
    n_t: float,
    exposed_t: float,
    exposed_and_outcome_t: float,
    rate_t: float,
    exposed_c: float = 0.0,
    alpha: float = 0.05,
) -> dict:
    """Effect per *exposed* user implied by the intent-to-treat effect.

    CACE = ITT / (exposure rate among treated - exposure rate among control).
    Identification needs (1) randomised assignment, (2) the exclusion restriction:
    assignment changes the outcome only through exposure, and (3) monotonicity,
    which holds by construction when control is never exposed. The standard
    error uses the delta method, including the covariance between the outcome
    mean and the exposure mean in the treatment arm.
    """
    pi = exposed_t / n_t
    if exposed_c > 0 or pi <= 0:
        return {"identified": False, "reason": "requires exposure only in the treatment arm and a positive exposure rate"}
    cace = itt / pi
    var_pi = pi * (1 - pi) / n_t
    cov = (exposed_and_outcome_t / n_t - rate_t * pi) / n_t
    var = (se_itt**2 + cace**2 * var_pi - 2 * cace * cov) / pi**2
    se = math.sqrt(max(var, 0.0))
    z = float(st.norm.ppf(1 - alpha / 2))
    return {
        "identified": True,
        "exposure_rate_treatment": pi,
        "cace": cace,
        "std_error": se,
        "ci_low": cace - z * se,
        "ci_high": cace + z * se,
        "assumptions": [
            "Assignment is as good as random (see balance diagnostics for caveats).",
            "Exclusion restriction: being assigned to treatment affects the outcome only via exposure.",
            "No exposure in the control arm (verified in the data).",
        ],
    }
