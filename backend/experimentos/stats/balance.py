"""Covariate balance diagnostics for a randomised experiment."""
from __future__ import annotations

import math

import numpy as np
from scipy import stats as st
from sklearn.metrics import roc_auc_score


def balance_row(feature: str, n_t: float, mean_t: float, var_t: float, n_c: float, mean_c: float, var_c: float) -> dict:
    """Standardised mean difference, variance ratio and a Welch z-test for one covariate."""
    pooled_sd = math.sqrt((var_t + var_c) / 2)
    smd = (mean_t - mean_c) / pooled_sd if pooled_sd > 0 else 0.0
    se = math.sqrt(var_t / n_t + var_c / n_c)
    z = (mean_t - mean_c) / se if se > 0 else 0.0
    return {
        "feature": feature,
        "mean_treatment": mean_t,
        "mean_control": mean_c,
        "std_mean_diff": smd,
        "variance_ratio": var_t / var_c if var_c > 0 else None,
        "z_statistic": z,
        "p_value": float(2 * st.norm.sf(abs(z))),
    }


def omnibus_f_test(X: np.ndarray, t: np.ndarray, chunk: int = 1_000_000) -> dict:
    """Joint test that no covariate predicts assignment: OLS of treatment on all features.

    Under randomisation the F statistic follows F(k, n-k-1). Computed from
    sufficient statistics accumulated in chunks, so it scales to the full data.
    """
    n, k = X.shape
    mu = X.mean(axis=0, dtype=np.float64)
    sd = X.std(axis=0, dtype=np.float64)
    sd[sd == 0] = 1.0
    xtx = np.zeros((k + 1, k + 1))
    xty = np.zeros(k + 1)
    # Apple Accelerate raises spurious floating-point flags inside matmul; the result is checked below.
    with np.errstate(all="ignore"):
        for i in range(0, n, chunk):
            Z = np.column_stack([np.ones(min(chunk, n - i)), (X[i : i + chunk].astype(np.float64) - mu) / sd])
            y = t[i : i + chunk].astype(np.float64)
            xtx += Z.T @ Z
            xty += Z.T @ y
        beta = np.linalg.solve(xtx, xty)
        fitted_ss = float(beta @ xty)
    if not np.isfinite(fitted_ss):
        raise FloatingPointError("Omnibus balance regression produced non-finite values")
    t_mean = float(t.mean(dtype=np.float64))
    sst = float(n * t_mean * (1 - t_mean))  # binary outcome
    ssr = sst + n * t_mean**2 - fitted_ss  # y'y - b'X'y
    r2 = 1 - ssr / sst
    df1, df2 = k, n - k - 1
    f = (r2 / df1) / ((1 - r2) / df2)
    return {"f_statistic": float(f), "df_num": int(df1), "df_den": int(df2), "r_squared": float(r2), "p_value": float(st.f.sf(f, df1, df2))}


def classifier_two_sample_test(t: np.ndarray, out_of_fold_propensity: np.ndarray) -> dict:
    """Classifier two-sample test: can a flexible model tell the arms apart from features?

    AUC = 0.5 means the arms are indistinguishable. The null standard error is the
    Mann-Whitney one, sqrt((n1 + n0 + 1) / (12 n1 n0)).
    """
    n1 = float(t.sum())
    n0 = float(t.size - n1)
    auc = float(roc_auc_score(t, out_of_fold_propensity))
    se = math.sqrt((n1 + n0 + 1) / (12 * n1 * n0))
    z = (auc - 0.5) / se
    q = np.quantile(out_of_fold_propensity, [0.0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 1.0])
    return {
        "auc": auc,
        "null_std_error": se,
        "z_statistic": z,
        "p_value": float(st.norm.sf(z)),  # one-sided: AUC > 0.5
        "n_scored": int(t.size),
        "propensity_quantiles": {
            k: float(v) for k, v in zip(["min", "p01", "p05", "p25", "p50", "p75", "p95", "p99", "max"], q)
        },
    }
