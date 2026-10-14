"""Test fixtures.

The suite never needs the 311 MB Criteo file. It generates a small SYNTHETIC
dataset with the same schema and a known ground-truth treatment effect, pushes
it through the real ingest and pipeline code into a temporary directory, and
checks the estimators against that ground truth. Synthetic numbers never reach
the application's artifacts/ directory.
"""
from __future__ import annotations

import gzip
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest

_TMP = Path(tempfile.mkdtemp(prefix="experimentos_test_"))
os.environ["EXPERIMENTOS_DATA_DIR"] = str(_TMP / "data")
os.environ["EXPERIMENTOS_ARTIFACTS_DIR"] = str(_TMP / "artifacts")

from experimentos import config  # noqa: E402

N_SYNTH = 60_000
TRUE_BASE = 0.04


def synthetic_arrays(n: int = N_SYNTH, seed: int = 7) -> dict:
    """Randomised experiment with heterogeneous, known effects.

    The visit effect is +0.10 for 'responders' (f0 above its mode and f2 above its mode)
    and 0 for everyone else, so the true ATE is 0.10 * P(responder).
    """
    rng = np.random.default_rng(seed)
    X = np.empty((n, 12))
    for j in range(12):
        at_mode = rng.random(n) < (0.3 + 0.05 * j if j < 6 else 0.9)
        X[:, j] = np.where(at_mode, 10.0 + j, 10.0 + j + rng.gamma(2.0, 1.0, n))
    responder = (X[:, 0] > 10.0) & (X[:, 2] > 12.0)
    t = (rng.random(n) < 0.85).astype(int)
    base = TRUE_BASE + 0.03 * (X[:, 1] > 11.0)
    p_visit = base + 0.10 * responder * t
    visit = (rng.random(n) < p_visit).astype(int)
    conversion = (visit & (rng.random(n) < 0.2)).astype(int)
    exposure = (t & (rng.random(n) < 0.3)).astype(int)
    return {"X": X, "t": t, "visit": visit, "conversion": conversion, "exposure": exposure,
            "responder": responder, "true_ate_visit": 0.10 * responder.mean()}


def write_raw_csv(path: Path, d: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = np.column_stack([d["X"], d["t"], d["conversion"], d["visit"], d["exposure"]])
    fmt = ["%.10f"] * 12 + ["%d"] * 4
    with gzip.open(path, "wt") as f:
        f.write(",".join(config.RAW_COLUMNS) + "\n")
        np.savetxt(f, cols, delimiter=",", fmt=fmt)


@pytest.fixture(scope="session")
def synth() -> dict:
    return synthetic_arrays()


@pytest.fixture(scope="session")
def ingested(synth) -> dict:
    from experimentos.data import ingest

    raw = config.RAW_DIR / config.RAW_FILENAME
    write_raw_csv(raw, synth)
    return ingest.ingest(raw, verify_checksum=False)


@pytest.fixture(scope="session")
def pipeline_run(ingested) -> config.Scope:
    """Full pipeline on the synthetic data, written to the temporary artifacts dir."""
    from experimentos import pipeline

    pipeline.run_all("full", n_boot=30)
    return config.get_scope("full")


@pytest.fixture(scope="session")
def client(pipeline_run):
    from fastapi.testclient import TestClient

    from experimentos.api.main import app

    return TestClient(app)
