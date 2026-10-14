"""Checks against the real Criteo file. Skipped automatically when it has not been downloaded."""
import json
from pathlib import Path

import duckdb
import pytest

from experimentos import config

REPO = Path(__file__).resolve().parents[2]
REAL_PARQUET = REPO / "data" / "processed" / "criteo_uplift_v2_1.full.parquet"
REAL_ARTIFACTS = REPO / "artifacts" / "full"

pytestmark = pytest.mark.real_data
needs_parquet = pytest.mark.skipif(not REAL_PARQUET.exists(), reason="real Criteo Parquet not present")
needs_artifacts = pytest.mark.skipif(not (REAL_ARTIFACTS / "experiment.json").exists(), reason="full-scope artifacts not present")


@needs_parquet
def test_row_count_and_key_figures_match_dataset_card():
    con = duckdb.connect()
    n, tr, visit, conv = con.sql(
        f"SELECT count(*), avg(treatment), avg(visit), avg(conversion) FROM '{REAL_PARQUET}'"
    ).fetchone()
    assert n == config.DATASET["expected_rows"] == 13_979_592
    assert round(tr, 2) == 0.85
    assert round(visit, 6) == 0.046992
    assert round(conv, 5) == 0.00292


@needs_parquet
def test_schema_and_domains():
    con = duckdb.connect()
    cols = [r[0] for r in con.sql(f"DESCRIBE SELECT * FROM '{REAL_PARQUET}'").fetchall()]
    assert cols == ["row_id"] + config.RAW_COLUMNS + ["split_bucket", "sample_bucket"]
    bad = con.sql(
        f"SELECT sum((treatment > 1)::INT + (visit > 1)::INT + (conversion > 1)::INT + (exposure > 1)::INT), "
        f"sum((conversion > visit)::INT), sum((exposure > treatment)::INT), count(*) - count(DISTINCT row_id) FROM '{REAL_PARQUET}'"
    ).fetchone()
    assert bad == (0, 0, 0, 0)


@needs_artifacts
def test_committed_full_artifacts_are_full_dataset_results():
    for name in ("experiment", "diagnostics", "segments", "models", "curves", "sql", "data_quality"):
        meta = json.loads((REAL_ARTIFACTS / f"{name}.json").read_text())["meta"]
        assert meta["scope"] == "full" and meta["is_sample"] is False
        assert meta["n_rows"] == 13_979_592
        assert meta["raw_sha256"] == config.DATASET["raw_sha256"]


@needs_artifacts
def test_committed_dev_sample_artifacts_are_labelled_as_sample():
    p = REPO / "artifacts" / "dev_sample" / "experiment.json"
    if not p.exists():
        pytest.skip("dev sample artifacts not present")
    meta = json.loads(p.read_text())["meta"]
    assert meta["is_sample"] is True and meta["n_rows"] < meta["full_dataset_rows"]
