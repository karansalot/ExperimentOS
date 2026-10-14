"""The inference primitives are checked against statsmodels / SciPy and by simulation."""
import numpy as np
import pytest
from scipy import stats as st
from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint, proportions_ztest

from experimentos.stats import proportions


@pytest.mark.parametrize("x_t,n_t,x_c,n_c", [(480, 10_000, 380, 9_000), (36_000, 11_800_000, 4_000, 2_100_000), (5, 400, 1, 300)])
def test_two_proportion_matches_statsmodels(x_t, n_t, x_c, n_c):
    r = proportions.two_proportion_test(x_t, n_t, x_c, n_c)
    z, p = proportions_ztest([x_t, x_c], [n_t, n_c])
    assert r["z_statistic"] == pytest.approx(z, rel=1e-9)
    assert r["p_value"] == pytest.approx(p, rel=1e-6, abs=1e-300)
    lo, hi = confint_proportions_2indep(x_t, n_t, x_c, n_c, method="newcomb", compare="diff")
    assert (r["ci_low"], r["ci_high"]) == pytest.approx((lo, hi), rel=1e-6)
    assert r["absolute_effect"] == pytest.approx(x_t / n_t - x_c / n_c)


def test_wilson_matches_statsmodels():
    for x, n in [(0, 50), (3, 50), (480, 10_000)]:
        assert proportions.wilson_interval(x, n) == pytest.approx(proportion_confint(x, n, method="wilson"), abs=1e-12)


def test_relative_effect_interval_brackets_point_estimate():
    r = proportions.two_proportion_test(480, 10_000, 380, 10_000)
    assert r["relative_effect"] == pytest.approx(480 / 380 - 1)
    assert r["relative_ci_low"] < r["relative_effect"] < r["relative_ci_high"]


def test_relative_effect_undefined_without_control_successes():
    r = proportions.two_proportion_test(5, 100, 0, 100)
    assert r["relative_effect"] is None and r["relative_ci_low"] is None


def test_confidence_interval_coverage_by_simulation():
    """A 95% interval should cover the true difference about 95% of the time."""
    rng = np.random.default_rng(1)
    p_t, p_c, n_t, n_c, sims = 0.05, 0.04, 8_500, 1_500, 4_000
    xt, xc = rng.binomial(n_t, p_t, sims), rng.binomial(n_c, p_c, sims)
    covered = 0
    for a, b in zip(xt, xc):
        r = proportions.two_proportion_test(a, n_t, b, n_c)
        covered += r["ci_low"] <= p_t - p_c <= r["ci_high"]
    assert 0.94 <= covered / sims <= 0.965


def test_false_positive_rate_under_null():
    rng = np.random.default_rng(2)
    sims = 4_000
    xt, xc = rng.binomial(8_500, 0.04, sims), rng.binomial(1_500, 0.04, sims)
    rejections = sum(proportions.two_proportion_test(a, 8_500, b, 1_500)["significant"] for a, b in zip(xt, xc))
    assert 0.04 <= rejections / sims <= 0.06


def test_srm_matches_scipy_and_flags_mismatch():
    ok = proportions.srm_test(85_050, 14_950, 0.85)
    chi2, p = st.chisquare([85_050, 14_950], [85_000, 15_000])
    assert ok["chi_square"] == pytest.approx(chi2) and ok["p_value"] == pytest.approx(p)
    assert not ok["mismatch_detected"]
    assert proportions.srm_test(86_000, 14_000, 0.85)["mismatch_detected"]


def test_mde_shrinks_with_sample_size():
    small = proportions.minimum_detectable_effect(8_500, 1_500, 0.04)
    large = proportions.minimum_detectable_effect(850_000, 150_000, 0.04)
    assert large["mde_absolute"] == pytest.approx(small["mde_absolute"] / 10, rel=1e-9)
