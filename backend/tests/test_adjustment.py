"""Covariate-adjusted estimators: agreement with statsmodels and recovery of a known effect under confounding."""
import numpy as np
import pytest
import statsmodels.api as sm

from experimentos.stats import adjustment, balance


def _confounded(n=40_000, seed=11):
    """Assignment depends on x0, and x0 also drives the outcome: the naive difference is biased upward."""
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, 4)).astype(np.float32)
    e = 1 / (1 + np.exp(-(1.2 + 0.8 * X[:, 0])))
    t = (rng.random(n) < e).astype(np.uint8)
    true_ate = 0.05
    p = np.clip(0.10 + 0.06 * X[:, 0] + true_ate * t, 0.001, 0.999)
    y = (rng.random(n) < p).astype(np.uint8)
    return X, t, y, true_ate


def test_lin_estimator_matches_statsmodels_hc1():
    X, t, y, _ = _confounded(8_000)
    Z = (X.astype(float) - X.mean(0)) / X.std(0)
    D = np.column_stack([np.ones(len(t)), t, Z, Z * t[:, None]])
    ref = sm.OLS(y.astype(float), D).fit(cov_type="HC1")
    got = adjustment.lin_estimator(X, t, y, chunk=1_000)
    assert got["estimate"] == pytest.approx(ref.params[1], rel=1e-6)
    assert got["std_error"] == pytest.approx(ref.bse[1], rel=1e-5)


def test_adjustment_removes_confounding_bias():
    X, t, y, true_ate = _confounded()
    naive = y[t == 1].mean() - y[t == 0].mean()
    assert naive - true_ate > 0.02  # the raw comparison is visibly biased
    lin = adjustment.lin_estimator(X, t, y)
    assert lin["ci_low"] <= true_ate <= lin["ci_high"]
    nuis = adjustment.cross_fit_nuisances(X, t, {"y": y}, np.arange(len(t)))
    dr = adjustment.aipw(t, y, nuis["propensity"], nuis["mu1"]["y"], nuis["mu0"]["y"])
    assert abs(dr["estimate"] - true_ate) < abs(naive - true_ate) / 2
    assert dr["estimate"] - 4 * dr["std_error"] <= true_ate <= dr["estimate"] + 4 * dr["std_error"]


def test_cross_fitting_is_out_of_fold_and_deterministic():
    X, t, y, _ = _confounded(6_000)
    ids = np.arange(len(t))
    a = adjustment.cross_fit_nuisances(X, t, {"y": y}, ids)
    b = adjustment.cross_fit_nuisances(X, t, {"y": y}, ids)
    np.testing.assert_array_equal(a["propensity"], b["propensity"])
    assert np.all((a["propensity"] > 0) & (a["propensity"] < 1))


def test_dr_scores_average_to_difference_in_means_with_constant_nuisances():
    rng = np.random.default_rng(0)
    t = (rng.random(5_000) < 0.85).astype(np.uint8)
    y = (rng.random(5_000) < 0.1).astype(np.uint8)
    e = np.full(5_000, t.mean())
    psi = adjustment.dr_scores(t, y, e, np.full(5_000, y[t == 1].mean()), np.full(5_000, y[t == 0].mean()))
    assert psi.mean() == pytest.approx(y[t == 1].mean() - y[t == 0].mean(), abs=1e-12)


def test_omnibus_f_matches_statsmodels():
    X, t, _, _ = _confounded(5_000)
    ref = sm.OLS(t.astype(float), sm.add_constant(X.astype(float))).fit()
    got = balance.omnibus_f_test(X, t, chunk=700)
    assert got["f_statistic"] == pytest.approx(ref.fvalue, rel=1e-6)
    assert got["r_squared"] == pytest.approx(ref.rsquared, rel=1e-6)


def test_balance_diagnostics_separate_random_from_confounded():
    rng = np.random.default_rng(5)
    X = rng.normal(size=(20_000, 4)).astype(np.float32)
    t_random = (rng.random(20_000) < 0.85).astype(np.uint8)
    assert balance.omnibus_f_test(X, t_random)["p_value"] > 0.001
    Xc, tc, _, _ = _confounded(20_000)
    assert balance.omnibus_f_test(Xc, tc)["p_value"] < 1e-10
    row = balance.balance_row("x0", (tc == 1).sum(), Xc[tc == 1, 0].mean(), Xc[tc == 1, 0].var(ddof=1),
                              (tc == 0).sum(), Xc[tc == 0, 0].mean(), Xc[tc == 0, 0].var(ddof=1))
    assert row["std_mean_diff"] > 0.1 and row["p_value"] < 1e-10
