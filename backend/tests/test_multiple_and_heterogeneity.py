import numpy as np
import pytest
from statsmodels.stats.multitest import multipletests

from experimentos.stats import compliance, heterogeneity, multiple


@pytest.mark.parametrize("ours,theirs", [("bonferroni", "bonferroni"), ("holm", "holm"), ("bh", "fdr_bh")])
def test_adjustments_match_statsmodels(ours, theirs):
    rng = np.random.default_rng(0)
    p = np.concatenate([rng.uniform(0, 1, 40), rng.uniform(0, 0.001, 8), [0.0, 1.0]])
    np.testing.assert_allclose(multiple.adjust_pvalues(p, ours), multipletests(p, method=theirs)[1], rtol=1e-12)


def test_adjusted_pvalues_never_below_raw():
    p = np.array([0.01, 0.04, 0.03, 0.2])
    for m in multiple.METHODS:
        assert np.all(multiple.adjust_pvalues(p, m) >= p - 1e-15)


def test_unknown_method_raises():
    with pytest.raises(ValueError):
        multiple.adjust_pvalues([0.1], "nope")


def test_cochran_q_zero_for_identical_effects():
    q = heterogeneity.cochran_q([0.01, 0.01, 0.01], [0.002, 0.003, 0.001])
    assert q["q"] == pytest.approx(0) and q["p_value"] == pytest.approx(1) and q["i_squared"] == 0


def test_cochran_q_detects_heterogeneity():
    q = heterogeneity.cochran_q([0.00, 0.03, 0.01], [0.002, 0.002, 0.002])
    assert q["p_value"] < 1e-6 and q["i_squared"] > 0.9 and q["df"] == 2


def test_cochran_q_needs_two_segments():
    assert heterogeneity.cochran_q([0.01], [0.001])["p_value"] is None


def test_wald_cace_recovers_effect_per_exposed_user():
    """Simulated one-sided non-compliance: only exposed treated users get a +0.2 effect."""
    rng = np.random.default_rng(3)
    n_t, n_c, pi, effect, base = 400_000, 100_000, 0.1, 0.2, 0.05
    exposed = rng.random(n_t) < pi
    y_t = rng.random(n_t) < base + effect * exposed
    y_c = rng.random(n_c) < base
    itt = y_t.mean() - y_c.mean()
    se = np.sqrt(y_t.mean() * (1 - y_t.mean()) / n_t + y_c.mean() * (1 - y_c.mean()) / n_c)
    r = compliance.wald_cace(itt, se, n_t, exposed.sum(), (exposed & y_t).sum(), y_t.mean())
    assert r["identified"] and r["ci_low"] <= effect <= r["ci_high"]
    assert r["cace"] == pytest.approx(itt / exposed.mean())


def test_wald_cace_not_identified_with_control_exposure():
    assert not compliance.wald_cace(0.01, 0.001, 1000, 100, 10, 0.05, exposed_c=5)["identified"]
