"""Data validation and end-to-end pipeline tests on the synthetic fixture."""
import gzip
import json

import duckdb
import numpy as np
import pytest

from experimentos import artifacts, config
from experimentos.data import ingest
from experimentos.data.hashing import bucket, splitmix64
from experimentos.sql import runner

from .conftest import N_SYNTH


# ---- hashing / splits ---------------------------------------------------------
def test_splitmix64_reference_values():
    # First outputs of the reference splitmix64 generator seeded with 0 and 1.
    got = splitmix64(np.array([0, 0x9E3779B97F4A7C15], dtype=np.uint64))
    assert [int(v) for v in got] == [0xE220A8397B1DCDAF, 0x6E789E6AA1B965F4]


def test_buckets_are_deterministic_uniform_and_salt_dependent():
    ids = np.arange(200_000, dtype=np.uint64)
    a, b = bucket(ids, config.SPLIT_SALT), bucket(ids, config.SPLIT_SALT)
    np.testing.assert_array_equal(a, b)
    counts = np.bincount(a, minlength=100)
    assert counts.min() > 1_800 and counts.max() < 2_200
    assert (a != bucket(ids, config.SAMPLE_SALT)).mean() > 0.95


# ---- ingest -------------------------------------------------------------------
def test_ingest_preserves_rows_and_order(ingested, synth):
    assert ingested["rows"]["full"] == N_SYNTH
    con = duckdb.connect()
    p = config.SCOPES["full"].parquet
    got = con.sql(f"SELECT row_id, f0, treatment, visit FROM '{p}' ORDER BY row_id").fetchnumpy()
    np.testing.assert_array_equal(got["row_id"], np.arange(N_SYNTH))
    np.testing.assert_allclose(got["f0"], synth["X"][:, 0], atol=1e-9)
    np.testing.assert_array_equal(got["treatment"], synth["t"])
    np.testing.assert_array_equal(got["visit"], synth["visit"])


def test_parquet_schema_is_exactly_as_documented(ingested):
    con = duckdb.connect()
    for scope in config.SCOPES.values():
        cols = [r[0] for r in con.sql(f"DESCRIBE SELECT * FROM '{scope.parquet}'").fetchall()]
        assert cols == ["row_id"] + config.RAW_COLUMNS + ["split_bucket", "sample_bucket"]


def test_dev_sample_is_a_labelled_subset(ingested):
    con = duckdb.connect()
    full, sample = config.SCOPES["full"].parquet, config.SCOPES["dev_sample"].parquet
    n_s, max_b = con.sql(f"SELECT count(*), max(sample_bucket) FROM '{sample}'").fetchone()
    assert max_b < config.DEV_SAMPLE_BUCKETS
    assert n_s == con.sql(f"SELECT count(*) FROM '{full}' WHERE sample_bucket < {config.DEV_SAMPLE_BUCKETS}").fetchone()[0]
    assert 0.04 < n_s / N_SYNTH < 0.06
    assert config.SCOPES["dev_sample"].is_sample and not config.SCOPES["full"].is_sample


def test_schema_validation_rejects_wrong_columns(tmp_path):
    bad = tmp_path / "bad.csv.gz"
    with gzip.open(bad, "wt") as f:
        f.write("f0,f1,treatment,visit\n1.0,2.0,1,0\n")
    with pytest.raises(ingest.SchemaError):
        ingest.validate_raw_schema(duckdb.connect(), bad)


def test_schema_validation_rejects_non_numeric_label(tmp_path):
    bad = tmp_path / "bad2.csv.gz"
    with gzip.open(bad, "wt") as f:
        f.write(",".join(config.RAW_COLUMNS) + "\n")
        f.write(",".join(["1.0"] * 12 + ["yes", "0", "0", "0"]) + "\n")
    with pytest.raises(ingest.SchemaError):
        ingest.validate_raw_schema(duckdb.connect(), bad)


def test_checksum_mismatch_is_refused(ingested):
    from experimentos.data.download import verify_raw

    with pytest.raises(ValueError, match="Checksum mismatch"):
        verify_raw(config.RAW_DIR / config.RAW_FILENAME)  # the synthetic file is not the pinned Criteo file


# ---- SQL layer ----------------------------------------------------------------
def test_there_are_at_least_15_documented_queries():
    qs = runner.load_queries()
    assert len(qs) >= 15
    assert all(q.title and q.technique and q.question for q in qs)


def test_every_query_runs(pipeline_run):
    sql = artifacts.read("full", "sql")["data"]["queries"]
    assert [q["id"] for q in sql if q["status"] != "ok"] == []
    assert all(q["row_count"] > 0 for q in sql)


def test_sql_effect_matches_python_engine(pipeline_run):
    sql = {q["id"]: q for q in artifacts.read("full", "sql")["data"]["queries"]}
    q = sql["05_ate_two_proportion"]
    row = dict(zip(q["columns"], next(r for r in q["rows"] if r[0] == "visit"), strict=False))
    eff = artifacts.read("full", "experiment")["data"]["outcomes"]["visit"]
    assert row["absolute_effect"] == pytest.approx(eff["absolute_effect"], abs=1e-6)
    assert row["z_statistic"] == pytest.approx(eff["z_statistic"], abs=0.01)
    assert row["ci95_low"] == pytest.approx(eff["wald_ci_low"], abs=1e-6)


def test_missing_template_parameter_fails_loudly():
    with pytest.raises(KeyError):
        runner.render("SELECT {{not_a_param}}", {})


# ---- data quality -------------------------------------------------------------
def test_quality_checks_on_clean_synthetic_data(pipeline_run):
    dq = artifacts.read("full", "data_quality")["data"]
    by = {c["check_name"]: c for c in dq["checks"]}
    for name in ("no_null_values", "features_are_finite", "treatment_is_binary", "row_id_is_unique",
                 "conversion_implies_visit", "control_is_never_exposed", "row_count_matches_ingest_manifest"):
        assert by[name]["passed"], name
    # The synthetic file is deliberately not the Criteo file: identity checks must catch that.
    assert not by["row_count_matches_dataset_card_key_figure"]["passed"]
    assert not by["raw_file_sha256_matches_pinned_revision"]["passed"]
    assert not dq["all_error_checks_passed"]


def test_split_integrity(pipeline_run):
    rows = artifacts.read("full", "data_quality")["data"]["split_integrity"]
    assert {r["split"] for r in rows} == {"train", "valid", "test"}
    assert sum(r["n_users"] for r in rows) == N_SYNTH
    assert all(r["duplicate_row_ids"] == 0 for r in rows)
    share = {r["split"]: r["share_of_rows"] for r in rows}
    assert share["train"] == pytest.approx(0.6, abs=0.02) and share["test"] == pytest.approx(0.2, abs=0.02)


# ---- statistics on known ground truth -------------------------------------------
def test_experiment_recovers_true_effect(pipeline_run, synth):
    eff = artifacts.read("full", "experiment")["data"]["outcomes"]["visit"]
    assert eff["ci_low"] <= synth["true_ate_visit"] <= eff["ci_high"]
    assert eff["significant"]
    srm = artifacts.read("full", "experiment")["data"]["srm"]
    assert not srm["mismatch_detected"]


def test_randomised_synthetic_data_passes_balance(pipeline_run):
    d = artifacts.read("full", "diagnostics")["data"]
    assert d["verdict"]["status"] == "pass"
    assert d["verdict"]["max_abs_smd"] < 0.05
    assert d["adjusted"]["classifier_two_sample_test"]["p_value"] > 0.001
    for o in config.OUTCOMES:
        assert d["adjusted"]["outcomes"][o]["max_relative_shift"] < 0.25


def test_segments_find_the_planted_heterogeneity(pipeline_run):
    feats = {f["feature"]: f for f in artifacts.read("full", "segments")["data"]["outcomes"]["visit"]["features"]}
    f0 = {s["segment_id"]: s for s in feats["f0"]["segments"]}
    assert abs(f0[0]["absolute_effect"]) < 0.02  # modal value of f0: no responders
    assert f0[1]["absolute_effect"] > 0.03
    assert feats["f0"]["heterogeneity"]["p_value_holm"] < 0.01
    # Holm-adjusted p can never be smaller than the raw p, and a tiny raw p must not be turned into 1.
    for f in feats.values():
        h = f["heterogeneity"]
        assert h["p_value"] <= h["p_value_holm"] <= min(1.0, h["p_value"] * 12 + 1e-12)
    assert all(0 <= s["p_value"] <= s["p_value_bh"] <= s["p_value_holm"] <= 1 for f in feats.values() for s in f["segments"])


def test_adjusted_segment_effects_match_python_dr_scores(pipeline_run):
    """The SQL doubly-robust segment effect must equal the mean of the Python DR scores for the same users."""
    import duckdb as ddb

    from experimentos.data.loader import load_frame
    from experimentos.stats import adjustment

    seg = artifacts.read("full", "segments")["data"]
    assert seg["has_adjusted_effects"]
    d = load_frame(pipeline_run)
    nuis = adjustment.load_nuisances(pipeline_run, d["row_id"])
    psi = adjustment.dr_scores(d["treatment"], d["visit"], nuis["propensity"], nuis["mu1"]["visit"], nuis["mu0"]["visit"])
    f0 = next(f for f in seg["outcomes"]["visit"]["features"] if f["feature"] == "f0")
    modal = next(s for s in f0["segments"] if s["segment_id"] == 0)
    mask = d["X"][:, 0] == np.float32(modal["value_min"])
    assert mask.sum() == modal["n_users"]
    assert modal["adjusted_effect"] == pytest.approx(psi[mask].mean(), abs=1e-6)
    assert modal["adjusted_ci_low"] < modal["adjusted_effect"] < modal["adjusted_ci_high"]
    # planted truth: no effect at the modal value of f0, a clear effect in the first non-modal tercile
    assert abs(modal["adjusted_effect"]) < 0.02
    assert next(s for s in f0["segments"] if s["segment_id"] == 1)["adjusted_effect"] > 0.03
    del ddb


# ---- uplift models ---------------------------------------------------------------
def test_no_train_rows_in_predictions(pipeline_run):
    con = duckdb.connect()
    splits = {r[0] for r in con.sql(f"SELECT DISTINCT split FROM '{pipeline_run.predictions}'").fetchall()}
    assert splits == {"valid", "test"}
    leaked = con.sql(
        f"SELECT count(*) FROM '{pipeline_run.predictions}' p JOIN '{pipeline_run.parquet}' e USING (row_id) "
        f"WHERE e.split_bucket < {config.TRAIN_BUCKETS[1]}"
    ).fetchone()[0]
    assert leaked == 0


def test_uplift_models_beat_random_on_planted_signal(pipeline_run):
    m = artifacts.read("full", "models")["data"]["outcomes"]["visit"]
    cards = {c["id"]: c for c in m["models"]}
    assert set(cards) == {"random", "response", "two_model_logit", "t_learner_gbm", "s_learner_gbm"}
    assert cards["t_learner_gbm"]["test_metrics"]["qini_coefficient"]["low"] > 0
    assert cards["random"]["test_metrics"]["qini_coefficient"]["value"] == pytest.approx(0, abs=1e-12)
    assert m["champion"] in ("two_model_logit", "t_learner_gbm", "s_learner_gbm")
    assert sum(c["is_champion"] for c in m["models"]) == 1
    assert len({c["version"] for c in m["models"]}) == 5


def test_training_is_reproducible(pipeline_run):
    from experimentos.uplift import train

    a = train.train_and_evaluate(pipeline_run, n_boot=5, save_models=False)
    b = train.train_and_evaluate(pipeline_run, n_boot=5, save_models=False)
    assert json.dumps(a["curves"], sort_keys=True) == json.dumps(b["curves"], sort_keys=True)
    va = [c["version"] for c in a["models"]["outcomes"]["visit"]["models"]]
    stored = [c["version"] for c in artifacts.read("full", "models")["data"]["outcomes"]["visit"]["models"]]
    assert va == stored  # the version id is a pure function of data + config + seed


def test_different_seed_changes_model_version(pipeline_run):
    from experimentos.uplift.train import model_version

    assert model_version(pipeline_run, "visit", "t_learner_gbm", {}, 1) != model_version(pipeline_run, "visit", "t_learner_gbm", {}, 2)


def test_artifacts_are_stamped_and_strict_json(pipeline_run):
    for name in artifacts.NAMES:
        raw = artifacts.path("full", name).read_text()
        assert "NaN" not in raw and "Infinity" not in raw
        meta = json.loads(raw)["meta"]
        assert meta["scope"] == "full" and meta["n_rows"] == N_SYNTH and meta["seed"] == config.SEED
