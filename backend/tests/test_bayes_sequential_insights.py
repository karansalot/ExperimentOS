import numpy as np
import pytest
from scipy import stats as st

from experimentos.stats import adjustment, bayes, sequential


def test_bayes_matches_frequentist_for_large_samples():
    r = bayes.beta_binomial(5_000, 100_000, 4_500, 100_000)
    se = np.sqrt(0.05 * 0.95 / 1e5 + 0.045 * 0.955 / 1e5)
    assert r["absolute_lift_mean"] == pytest.approx(0.005, abs=1e-4)
    assert r["absolute_lift_ci"][0] == pytest.approx(0.005 - 1.96 * se, abs=2e-4)
    assert r["prob_treatment_better"] == pytest.approx(st.norm.cdf(0.005 / se), abs=0.005)


def test_bayes_is_symmetric_and_reproducible_under_no_difference():
    a = bayes.beta_binomial(300, 10_000, 300, 10_000)
    assert a["prob_treatment_better"] == pytest.approx(0.5, abs=0.01)
    assert a["expected_loss_ship_treatment"] == pytest.approx(a["expected_loss_keep_control"], rel=0.05)
    assert a == bayes.beta_binomial(300, 10_000, 300, 10_000)


def test_bayes_threshold_probabilities_are_decreasing():
    p = bayes.beta_binomial(600, 10_000, 500, 10_000)["prob_relative_lift_above"]
    vals = [p[k] for k in sorted(p, key=float)]
    assert vals == sorted(vals, reverse=True)


def test_naive_peeking_inflates_false_positives_monotonically():
    r = sequential.simulate(n_looks=10, sims=40_000)
    curve = [c["false_positive_rate"] for c in r["naive_fpr_by_looks"]]
    assert curve[0] == pytest.approx(0.05, abs=0.006)
    assert all(b >= a - 0.005 for a, b in zip(curve, curve[1:], strict=False))
    assert next(c for c in r["naive_fpr_by_looks"] if c["looks"] == 10)["false_positive_rate"] == pytest.approx(0.193, abs=0.012)


def test_boundaries_control_alpha_on_fresh_simulations_and_match_textbook_values():
    r = sequential.simulate(n_looks=10, sims=60_000)
    d = {x["id"]: x for x in r["designs"]}
    for k in ("pocock", "obrien_fleming"):
        assert d[k]["false_positive_rate"] == pytest.approx(0.05, abs=0.006)
    # published constants for K = 10, two-sided alpha = 0.05: Pocock 2.555, O'Brien-Fleming final 2.087
    assert d["pocock"]["boundary_z"][0] == pytest.approx(2.555, abs=0.03)
    assert d["obrien_fleming"]["boundary_z"][-1] == pytest.approx(2.087, abs=0.03)
    # sequential designs trade a little power for stopping early when the effect is real
    assert d["obrien_fleming"]["expected_sample_fraction"] < 1 and d["obrien_fleming"]["power"] > d["pocock"]["power"]


def test_single_look_reduces_to_fixed_horizon():
    r = sequential.simulate(n_looks=1, sims=40_000)
    for d in r["designs"]:
        assert d["boundary_z"][0] == pytest.approx(1.96, abs=0.03)
        assert d["power"] == pytest.approx(0.8, abs=0.01)


def test_sequential_input_validation():
    with pytest.raises(ValueError):
        sequential.simulate(n_looks=0)


def test_variance_reduction():
    v = adjustment.variance_reduction(1.0, 0.8)
    assert v["variance_reduction"] == pytest.approx(0.36)
    assert v["effective_sample_multiplier"] == pytest.approx(1 / 0.64)


# ---- on the synthetic pipeline run -------------------------------------------------------
def test_explanations_find_the_planted_drivers(pipeline_run):
    from experimentos import artifacts

    ex = artifacts.read("full", "explain")["data"]["outcomes"]["visit"]
    # responders are defined by f0 and f2 off their modal values: they must be the top drivers
    assert {r["feature"] for r in ex["importance"][:2]} == {"f0", "f2"}
    # Only f0 and f2 carry heterogeneity in the fixture, so check agreement where there is signal:
    # predicted and observed uplift must both separate f0's modal segment (no responders) from the rest.
    f0 = {r["segment_id"]: r for r in ex["segment_agreement"] if r["feature"] == "f0"}
    assert f0[0]["mean_predicted"] < 0.01 and abs(f0[0]["observed"]) < 0.02
    assert f0[1]["mean_predicted"] > 0.02 and f0[1]["observed"] > 0.02
    assert ex["agreement_weighted_mae"] < 0.02
    pers = {r["feature"]: r for r in ex["persuadables"]}
    assert pers["f0"]["share_off_modal_top"] > pers["f0"]["share_off_modal_rest"]


def test_insights_are_complete_and_linked(client):
    r = client.get("/api/insights").json()
    ids = {i["id"] for i in r["insights"]}
    assert {"effect", "inflation", "concentration", "sophistication", "overpowered", "peeking", "file_order"} <= ids
    for i in r["insights"]:
        assert i["title"] and i["detail"] and i["value"] and i["href"].startswith("/")
        assert i["tone"] in {"good", "warning", "info"}
    share = r["concentration"]["series"]["random"]["share"]
    assert share[0] == 0 and share[-1] == pytest.approx(1.0)


def test_new_endpoints(client):
    o = client.get("/api/overview").json()
    assert 0 <= o["bayes"]["visit"]["prob_treatment_better"] <= 1 and "visit" in o["variance_reduction"]
    assert client.get("/api/explain?outcome=conversion").status_code == 200
    s = client.post("/api/sequential", json={"n_looks": 5}).json()
    assert [d["id"] for d in s["designs"]] == ["naive", "pocock", "obrien_fleming"]
    assert client.post("/api/sequential", json={"n_looks": 500}).status_code == 422


def test_static_export_mirrors_the_api(pipeline_run, tmp_path):
    """The hosted build reads these files instead of calling the API; they must cover every route."""
    import json

    import numpy as np

    from experimentos import export_static

    out = tmp_path / "data"
    export_static.export(out)
    meta = json.loads((out / "meta.json").read_text())
    assert [s["name"] for s in meta["scopes"]] == ["full"]
    d = out / "full"
    for name in ("overview", "diagnostics", "data-quality", "sql", "insights", "segments.visit", "models.conversion", "curves.visit", "explain.visit"):
        assert (d / f"{name}.json").exists(), name
    assert len(list((d / "sql").glob("*.json"))) >= 15
    index = json.loads((d / "boot-index.json").read_text())
    entry = index["visit.valid.adjusted"]
    arr = np.frombuffer((d / entry["file"]).read_bytes(), dtype="<f4").reshape(entry["shape"])
    npz = np.load(pipeline_run.artifacts / "bootstrap_valid_visit.npz")
    m = entry["models"].index("t_learner_gbm")
    np.testing.assert_array_equal(arr[m], npz["t_learner_gbm__adjusted"])
