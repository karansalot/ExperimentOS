"""Tests for treatment-effect heterogeneity across segments."""
from __future__ import annotations

import numpy as np
from scipy import stats as st


def cochran_q(effects, std_errors) -> dict:
    """Cochran's Q test of H0: all segment effects are equal.

    Uses inverse-variance weights. I^2 describes the share of between-segment
    variation that is not explained by sampling error.
    """
    e = np.asarray(effects, dtype=float)
    se = np.asarray(std_errors, dtype=float)
    keep = np.isfinite(e) & np.isfinite(se) & (se > 0)
    e, se = e[keep], se[keep]
    k = e.size
    if k < 2:
        return {"q": None, "df": 0, "p_value": None, "i_squared": None, "segments_used": int(k)}
    w = 1 / se**2
    pooled = float(np.sum(w * e) / np.sum(w))
    q = float(np.sum(w * (e - pooled) ** 2))
    df = k - 1
    return {
        "q": q,
        "df": df,
        "p_value": float(st.chi2.sf(q, df)),
        "i_squared": max(0.0, (q - df) / q) if q > 0 else 0.0,
        "pooled_effect": pooled,
        "segments_used": int(k),
    }
