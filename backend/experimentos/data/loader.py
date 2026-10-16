"""Row-level loading for the modelling steps (server-side only; never sent to the browser)."""
from __future__ import annotations

from typing import Optional

import duckdb
import numpy as np

from .. import config


def load_frame(scope: config.Scope, where: Optional[str] = None) -> dict:
    """Load features and labels as NumPy arrays, ordered by row_id.

    X is float32 (n, 12); the binary columns are uint8.
    """
    con = duckdb.connect()
    cols = ", ".join(["row_id", "split_bucket"] + config.FEATURES + config.BINARY_COLUMNS)
    clause = f"WHERE {where}" if where else ""
    d = con.sql(f"SELECT {cols} FROM read_parquet('{scope.parquet}') {clause} ORDER BY row_id").fetchnumpy()
    X = np.empty((len(d["row_id"]), len(config.FEATURES)), dtype=np.float32)
    for j, f in enumerate(config.FEATURES):
        X[:, j] = d.pop(f)
    b = d["split_bucket"]
    split = np.where(b < config.TRAIN_BUCKETS[1], "train", np.where(b < config.VALID_BUCKETS[1], "valid", "test"))
    return {
        "row_id": d["row_id"].astype(np.int64),
        "X": X,
        "treatment": d["treatment"].astype(np.uint8),
        "visit": d["visit"].astype(np.uint8),
        "conversion": d["conversion"].astype(np.uint8),
        "exposure": d["exposure"].astype(np.uint8),
        "split": split,
    }
