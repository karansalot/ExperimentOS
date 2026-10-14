import numpy as np
import pytest

from experimentos.uplift import metrics


def _data(n=40_000, seed=0):
    rng = np.random.default_rng(seed)
    responder = rng.random(n) < 0.2
    t = (rng.random(n) < 0.85).astype(np.uint8)
    y = (rng.random(n) < 0.05 + 0.2 * responder * t).astype(np.uint8)
    return responder, t, y


def test_rank_bins_are_equal_size_and_ordered():
    score = np.random.default_rng(0).normal(size=10_000)
    b = metrics.rank_bins(score, 10, seed=1)
    assert np.bincount(b).tolist() == [1000] * 10
    assert score[b == 0].min() >= score[b == 1].max()


def test_rank_bins_break_ties_randomly_but_reproducibly():
    score = np.zeros(10_000)
    a, b = metrics.rank_bins(score, 4, seed=1), metrics.rank_bins(score, 4, seed=1)
    np.testing.assert_array_equal(a, b)
    # with all scores tied, file position must not determine the bin
    assert abs(np.corrcoef(np.arange(10_000), a)[0, 1]) < 0.05


def test_qini_matches_hand_calculation():
    # 2 bins of 4 users; bin 0: treated 1/2 respond, control 0/2; bin 1: treated 0/2, control 1/2
    bins = np.array([0, 0, 0, 0, 1, 1, 1, 1])
    t = np.array([1, 1, 0, 0, 1, 1, 0, 0])
    y = np.array([1, 0, 0, 0, 0, 0, 1, 0])
    c = metrics.curves(metrics.bin_stats(bins, t, y, None, 2))
    np.testing.assert_allclose(c["qini"], [0, (1 - 0 * 2 / 2) / 4, (1 - 1 * 4 / 4) / 4])
    np.testing.assert_allclose(c["unadjusted"], [0, (0.5 - 0) * 4 / 8, (0.25 - 0.25) * 8 / 8])


def test_curve_endpoint_equals_overall_difference_in_rates():
    responder, t, y = _data()
    r = metrics.evaluate({"m": responder.astype(float)}, t, y, None, n_bins=20, n_boot=0)
    ate = y[t == 1].mean() - y[t == 0].mean()
    for m in ("m", "random"):
        assert r["models"][m]["curves"]["unadjusted"]["value"][-1] == pytest.approx(ate)


def test_oracle_beats_random_and_noise_does_not():
    responder, t, y = _data()
    noise = np.random.default_rng(9).normal(size=len(t))
    r = metrics.evaluate({"oracle": responder.astype(float), "noise": noise}, t, y, None, n_bins=50, n_boot=100, seed=3)
    q_oracle = r["models"]["oracle"]["metrics"]["qini_coefficient"]
    q_noise = r["models"]["noise"]["metrics"]["qini_coefficient"]
    assert q_oracle["low"] > 0
    assert q_noise["low"] < 0 < q_noise["high"]
    assert r["models"]["random"]["metrics"]["qini_coefficient"]["value"] == pytest.approx(0, abs=1e-12)
    # the oracle's top 20% are exactly the responders: effect there should be ~0.2
    assert r["models"]["oracle"]["metrics"]["uplift_at_20_unadjusted"]["value"] == pytest.approx(0.2, abs=0.03)


def test_adjusted_curve_is_cumulative_mean_of_scores():
    rng = np.random.default_rng(0)
    n = 1_000
    psi = rng.normal(size=n)
    score = -np.arange(n, dtype=float)  # row 0 ranked first
    t = (rng.random(n) < 0.5).astype(np.uint8)
    y = (rng.random(n) < 0.5).astype(np.uint8)
    r = metrics.evaluate({"m": score}, t, y, psi, n_bins=10, n_boot=0)
    np.testing.assert_allclose(r["models"]["m"]["curves"]["adjusted"]["value"][3], psi[:300].sum() / n)


def test_bootstrap_is_reproducible_and_paired():
    responder, t, y = _data(10_000)
    kw = dict(n_bins=20, n_boot=30, seed=5, reference_id="a")
    s = {"a": responder.astype(float), "b": responder.astype(float)}
    r1, r2 = metrics.evaluate(s, t, y, None, **kw), metrics.evaluate(s, t, y, None, **kw)
    assert r1["models"]["a"]["metrics"] == r2["models"]["a"]["metrics"]
    # identical scores evaluated on identical resamples must differ by exactly zero
    d = r1["models"]["b"]["metrics"]["qini_coefficient"]["vs_reference"]
    assert d["difference"] == 0 and d["low"] == 0 and d["high"] == 0


def test_calibration_groups_recover_group_effects():
    responder, t, y = _data(60_000)
    pred = np.where(responder, 0.2, 0.0)
    rows = metrics.uplift_calibration(pred, t, y, None, n_groups=5)
    assert rows[0]["observed_uplift"] == pytest.approx(0.2, abs=0.03)
    assert abs(rows[-1]["observed_uplift"]) < 0.02
    assert sum(r["n_users"] for r in rows) == 60_000
