"""Multiple-testing adjustments (implemented directly; validated against statsmodels in tests)."""
from __future__ import annotations

import numpy as np

METHODS = ("bonferroni", "holm", "bh")


def adjust_pvalues(pvalues, method: str = "bh") -> np.ndarray:
    """Return adjusted p-values.

    bonferroni / holm control the family-wise error rate; bh (Benjamini-Hochberg)
    controls the false discovery rate under independence or positive dependence.
    """
    p = np.asarray(pvalues, dtype=float)
    m = p.size
    if m == 0:
        return p
    if method == "bonferroni":
        return np.minimum(1.0, p * m)
    order = np.argsort(p)
    ranked = p[order]
    if method == "holm":
        adj = np.maximum.accumulate(ranked * (m - np.arange(m)))
    elif method == "bh":
        adj = np.minimum.accumulate((ranked * m / np.arange(1, m + 1))[::-1])[::-1]
    else:
        raise ValueError(f"Unknown method {method!r}; choose from {METHODS}")
    out = np.empty(m)
    out[order] = np.minimum(1.0, adj)
    return out
