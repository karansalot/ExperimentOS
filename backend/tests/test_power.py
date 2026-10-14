import numpy as np
import pytest

from experimentos.stats import power as pw
from experimentos.stats import proportions


def test_required_sample_size_reaches_target_power_by_simulation():
    """At the computed n, a simulated test should reject about `power` of the time."""
    base, delta, share = 0.05, 0.01, 0.85
    need = pw.required_sample_size(base, delta, share, alpha=0.05, target_power=0.8)
    rng = np.random.default_rng(0)
    sims = 4_000
    xt = rng.binomial(need["n_treatment"], base + delta, sims)
    xc = rng.binomial(need["n_control"], base, sims)
    rejected = sum(proportions.two_proportion_test(a, need["n_treatment"], b, need["n_control"])["significant"] for a, b in zip(xt, xc))
    assert rejected / sims == pytest.approx(0.8, abs=0.025)
    assert need["achieved_power"] >= 0.8 - 1e-9 and need["n_treatment"] + need["n_control"] == need["n_total"]


def test_power_equals_alpha_as_effect_vanishes_and_one_when_large():
    assert pw.power(10_000, 0.05, 1e-9, 0.5) == pytest.approx(0.05, abs=1e-4)
    assert pw.power(10_000_000, 0.05, 0.01, 0.5) == pytest.approx(1.0)
    assert pw.power(0, 0.05, 0.01) == 0.0


def test_sample_size_scales_inverse_square_with_effect():
    a = pw.required_sample_size(0.05, 0.001)["n_total"]  # small effects: variance ~ constant
    b = pw.required_sample_size(0.05, 0.0005)["n_total"]
    assert b / a == pytest.approx(4, rel=0.03)


def test_unbalanced_allocation_costs_sample():
    balanced = pw.required_sample_size(0.04, 0.004, 0.5)["n_total"]
    skewed = pw.required_sample_size(0.04, 0.004, 0.85)["n_total"]
    # for equal variances the inflation factor is 1 / (4 r (1 - r)) = 1.96 at r = 0.85
    assert skewed / balanced == pytest.approx(1 / (4 * 0.85 * 0.15), rel=0.08)


def test_mde_inverts_sample_size():
    need = pw.required_sample_size(0.04, 0.004, 0.85)
    assert pw.minimum_detectable_effect(need["n_total"], 0.04, 0.85) == pytest.approx(0.004, rel=0.01)
    assert np.isnan(pw.minimum_detectable_effect(3, 0.04, 0.5))


def test_plan_payload_is_consistent():
    p = pw.plan(0.04, 0.10, 0.85, users_per_day=50_000, observed_n=1_000_000)
    assert p["inputs"]["mde_absolute"] == pytest.approx(0.004)
    assert p["days_required"] == -(-p["required"]["n_total"] // 50_000)
    powers = [x["power"] for x in p["power_curve"]]
    assert powers == sorted(powers)
    assert min(a["n_total"] for a in p["allocations"]) == p["balanced_design"]["n_total"]
    assert p["observed_experiment"]["times_larger_than_required"] == pytest.approx(1_000_000 / p["required"]["n_total"])


@pytest.mark.parametrize("kw", [dict(base_rate=0), dict(base_rate=1.2), dict(delta=0), dict(treatment_share=1), dict(alpha=0), dict(delta=0.99)])
def test_invalid_design_inputs_raise(kw):
    args = {"base_rate": 0.05, "delta": 0.01, "treatment_share": 0.5, "alpha": 0.05, **kw}
    with pytest.raises(ValueError):
        pw.required_sample_size(**args)
