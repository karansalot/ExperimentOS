import numpy as np
import pytest

from experimentos.simulator.decision import Scenario, load_curves, simulate


@pytest.fixture(scope="module")
def base(pipeline_run):
    return simulate("full", Scenario(outcome="visit", population=100_000, cost_per_user=0.5, value_per_outcome=20, targeting_pct=30))


def test_profit_arithmetic(base):
    s = base["selected"]
    assert s["targeted_users"] == pytest.approx(30_000)
    assert s["treatment_cost"] == pytest.approx(15_000)
    assert s["incremental_value"] == pytest.approx(20 * s["incremental_outcomes"])
    assert s["profit"] == pytest.approx(s["incremental_value"] - s["treatment_cost"])
    assert s["roi"] == pytest.approx(s["profit"] / s["treatment_cost"])
    assert s["profit_low"] <= s["profit"] <= s["profit_high"]


def test_incremental_outcomes_match_curve(pipeline_run, base):
    cs = load_curves("full", "visit", "adjusted")
    assert base["selected"]["incremental_outcomes"] == pytest.approx(100_000 * cs.point[cs.champion][30])


def test_reference_strategies(base):
    rows = {r["id"]: r for r in base["strategies"]}
    assert rows["none"]["profit"] == 0 and rows["none"]["targeted_users"] == 0
    assert rows["all"]["targeting_pct"] == 100
    # random targeting earns the population-average effect on the treated fraction
    assert rows["random"]["incremental_outcomes"] == pytest.approx(0.3 * rows["all"]["incremental_outcomes"], rel=1e-6)


def test_break_even_is_consistent(base, pipeline_run):
    be, sc = base["break_even"], base["scenario"]
    at_be = simulate("full", Scenario(**{**{k: sc[k] for k in Scenario().__dict__}, "value_per_outcome": be["break_even_value_per_outcome"]}))
    assert at_be["selected"]["profit"] == pytest.approx(0, abs=1e-6)
    assert be["required_effect_per_targeted_user"] == pytest.approx(0.5 / 20)


def test_budget_caps_targeting(pipeline_run):
    r = simulate("full", Scenario(population=100_000, cost_per_user=0.5, value_per_outcome=20, targeting_pct=50, budget=5_000))
    assert r["budget"]["capped_by_budget"] and r["budget"]["applied_pct"] == pytest.approx(10)
    assert r["selected"]["treatment_cost"] <= 5_000 + 1e-6
    assert r["recommendation"]["treatment_cost"] <= 5_000 + 1e-6
    assert not {x["id"]: x for x in r["strategies"]}["all"]["feasible"]


def test_free_treatment_with_positive_effects_is_worth_scaling(pipeline_run):
    r = simulate("full", Scenario(cost_per_user=0.0, value_per_outcome=10, risk="neutral"))
    assert r["recommendation"]["action"] in ("target", "roll_out") and r["recommendation"]["profit"] > 0


def test_prohibitive_cost_recommends_holding(pipeline_run):
    r = simulate("full", Scenario(cost_per_user=1_000.0, value_per_outcome=1.0))
    assert r["recommendation"]["action"] == "hold" and r["recommendation"]["profit"] == 0


def test_risk_aversion_never_increases_risk_adjusted_profit(pipeline_run):
    vals = [simulate("full", Scenario(risk=k, cost_per_user=0.5, value_per_outcome=20))["selected"]["profit_risk_adjusted"]
            for k in ("conservative", "moderate")]
    assert vals[0] <= vals[1]


def test_coverage_is_chosen_on_validation_and_measured_on_test(pipeline_run):
    sc = Scenario(population=100_000, cost_per_user=0.5, value_per_outcome=20, risk="neutral")
    r = simulate("full", sc)
    cs = load_curves("full", "visit", "adjusted")
    assert cs.valid_point is not None and r["recommendation"]["coverage_selected_on"] == "validation"
    m = cs.champion
    valid_profit = 20 * 100_000 * cs.valid_point[m] - 0.5 * 100_000 * cs.fraction
    k = int(np.argmax(valid_profit))
    assert r["selected_optimum"]["targeting_pct"] == pytest.approx(cs.fraction[k] * 100)
    # ... while the profit reported for that coverage comes from the test curve
    assert r["selected_optimum"]["profit"] == pytest.approx(20 * 100_000 * cs.point[m][k] - 0.5 * 100_000 * cs.fraction[k])


def test_score_cutoffs_are_monotone_and_reported(pipeline_run, base):
    cs = load_curves("full", "visit", "adjusted")
    t = cs.thresholds[cs.champion]
    assert t[0] is None and all(a >= b for a, b in zip(t[1:], t[2:], strict=False))
    rule = base["targeting_rule"]
    assert rule["score_kind"] == "predicted uplift" and rule["selected_cutoff"] == t[30]
    assert "random" not in cs.thresholds


def test_sensitivity_grid_centre_equals_base(base):
    m = base["sensitivity"]["multipliers"]
    centre = base["sensitivity"]["grid_rows_cost_cols_value"][m.index(1.0)][m.index(1.0)]
    assert centre["profit_at_selected"] == pytest.approx(base["selected"]["profit"])
    assert len(base["sensitivity"]["tornado"]) == 4


@pytest.mark.parametrize("bad", [{"outcome": "revenue"}, {"risk": "yolo"}, {"basis": "magic"}, {"population": 0},
                                 {"targeting_pct": 120}, {"cost_per_user": -1}, {"strategy": "nope"}])
def test_invalid_scenarios_are_rejected(pipeline_run, bad):
    with pytest.raises(ValueError):
        simulate("full", Scenario(**bad))


# ---- API ------------------------------------------------------------------------
@pytest.mark.parametrize("url", ["/api/health", "/api/meta", "/api/overview", "/api/diagnostics", "/api/segments?outcome=conversion",
                                 "/api/data-quality", "/api/models?outcome=visit", "/api/curves?outcome=conversion", "/api/sql",
                                 "/api/sql/05_ate_two_proportion", "/api/train/status"])
def test_get_endpoints(client, url):
    r = client.get(url)
    assert r.status_code == 200, r.text


def test_every_data_response_carries_scope_metadata(client):
    for url in ["/api/overview", "/api/diagnostics", "/api/segments", "/api/models", "/api/curves", "/api/sql", "/api/data-quality"]:
        meta = client.get(url).json()["meta"]
        assert {"scope", "is_sample", "n_rows", "full_dataset_rows", "raw_sha256"} <= set(meta)


def test_simulate_and_brief_endpoints(client):
    body = {"outcome": "visit", "population": 50_000, "cost_per_user": 0.5, "value_per_outcome": 20, "targeting_pct": 25}
    sim = client.post("/api/simulate", json=body)
    assert sim.status_code == 200 and sim.json()["selected"]["targeted_users"] == pytest.approx(12_500)
    b = client.post("/api/brief", json=body).json()
    assert [s["id"] for s in b["sections"]] == ["findings", "interpretation", "recommendation", "limitations"]
    assert b["markdown"].startswith("# ExperimentOS decision brief")
    md = client.post("/api/brief/markdown", json=body)
    assert md.status_code == 200 and "scenario" in md.text.lower()


def test_segments_endpoint_exposes_adjusted_effects(client):
    d = client.get("/api/segments?outcome=visit").json()
    assert d["has_adjusted_effects"] is True and "doubly-robust" in d["adjusted_definition"]
    assert all("adjusted_effect" in s for f in d["features"] for s in f["segments"])


def test_plan_endpoint(client):
    r = client.post("/api/plan", json={"outcome": "visit", "mde_relative": 0.1, "treatment_share": 0.85, "users_per_day": 10_000})
    assert r.status_code == 200
    p = r.json()
    assert p["base_rate_source"] == "observed control rate" and p["required"]["n_total"] > 0
    assert p["allocation_cost"] > 1.5 and p["days_required"] >= 1
    assert p["observed_experiment"]["mde_absolute"] > 0
    custom = client.post("/api/plan", json={"base_rate": 0.2, "mde_relative": 0.1}).json()
    assert custom["base_rate_source"] == "user input" and custom["inputs"]["base_rate"] == 0.2
    assert client.post("/api/plan", json={"base_rate": 0.9, "mde_relative": 0.5}).status_code == 422
    assert client.post("/api/plan", json={"mde_relative": 0}).status_code == 422


def test_api_validation_errors(client):
    assert client.post("/api/simulate", json={"targeting_pct": 500}).status_code == 422
    assert client.post("/api/simulate", json={"outcome": "revenue"}).status_code == 422
    assert client.get("/api/overview?scope=nope").status_code == 422
    assert client.get("/api/segments?outcome=revenue").status_code == 422
    assert client.get("/api/sql/does_not_exist").status_code == 404
    assert client.get("/api/overview?scope=dev_sample").status_code == 404  # no artifacts for that scope in the test run


def test_api_never_returns_row_level_data(client):
    """Payloads are aggregates: nothing should scale with the number of rows."""
    for url in ["/api/overview", "/api/segments", "/api/models", "/api/curves", "/api/diagnostics"]:
        assert len(client.get(url).content) < 400_000


def test_api_sets_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_training_can_be_disabled(client, monkeypatch):
    from experimentos.api import main

    monkeypatch.setattr(main, "TRAINING_ENABLED", False)
    assert client.post("/api/train", json={}).status_code == 403
    assert client.get("/api/train/status").json()["can_train"] is False


def test_manifests_never_contain_absolute_paths(pipeline_run):
    from experimentos import artifacts

    raw = artifacts.path("full", "dataset").read_text()
    assert '"path":"/' not in raw.replace(" ", "")
