"""Raw CSV -> validated, typed Parquet (full dataset + labelled development sample)."""
from __future__ import annotations

import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from .. import config
from .download import raw_path, verify_raw
from .hashing import bucket


class SchemaError(ValueError):
    """The raw file does not have the documented schema."""


def validate_raw_schema(con: duckdb.DuckDBPyConnection, csv: Path) -> list[dict]:
    """Check column names, order and inferred types against the documented schema."""
    described = con.sql(
        f"DESCRIBE SELECT * FROM read_csv('{csv}', header=true, sample_size=200000)"
    ).fetchall()
    names = [r[0] for r in described]
    if names != config.RAW_COLUMNS:
        raise SchemaError(f"Unexpected columns.\n got: {names}\n want: {config.RAW_COLUMNS}")
    numeric = {"DOUBLE", "FLOAT", "BIGINT", "INTEGER", "SMALLINT", "TINYINT", "HUGEINT"}
    integer = numeric - {"DOUBLE", "FLOAT"}
    out = []
    for name, dtype, *_ in described:
        want = integer if name in config.BINARY_COLUMNS else numeric
        if dtype not in want:
            raise SchemaError(f"Column {name} inferred as {dtype}, expected one of {sorted(want)}")
        out.append({"column": name, "raw_type": dtype})
    return out


def _select_typed(source: str) -> str:
    feats = ", ".join(f"CAST({f} AS DOUBLE) AS {f}" for f in config.FEATURES)
    bins = ", ".join(f"CAST({b} AS UTINYINT) AS {b}" for b in config.BINARY_COLUMNS)
    return f"SELECT {feats}, {bins} FROM {source}"


def ingest(csv: Path | None = None, verify_checksum: bool = True) -> dict:
    """Build the Parquet files and a manifest. Returns the manifest."""
    csv = csv or raw_path()
    t0 = time.time()
    checksum = verify_raw(csv) if verify_checksum else {"path": csv.name, "sha256": None}
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute("SET preserve_insertion_order = true")
    raw_schema = validate_raw_schema(con, csv)

    # 1) Typed staging file. Binary columns are cast to UTINYINT: a value that is
    #    not a small non-negative integer fails the cast loudly rather than being coerced.
    stage = config.PROCESSED_DIR / "_stage.parquet"
    explicit = ", ".join(
        f"'{c}': '{'BIGINT' if c in config.BINARY_COLUMNS else 'DOUBLE'}'" for c in config.RAW_COLUMNS
    )
    con.execute(
        f"""COPY ({_select_typed(f"read_csv('{csv}', header=true, columns={{{explicit}}})")})
            TO '{stage}' (FORMAT PARQUET, COMPRESSION ZSTD)"""
    )
    n_rows = con.sql(f"SELECT count(*) FROM '{stage}'").fetchone()[0]

    # 2) Deterministic hash buckets from the file position.
    row_id = np.arange(n_rows, dtype=np.uint64)
    buckets = config.PROCESSED_DIR / "_buckets.parquet"
    pq.write_table(
        pa.table(
            {
                "row_id": pa.array(row_id.astype(np.int64)),
                "split_bucket": pa.array(bucket(row_id, config.SPLIT_SALT)),
                "sample_bucket": pa.array(bucket(row_id, config.SAMPLE_SALT)),
            }
        ),
        buckets,
    )

    # 3) Final files. row_id is the 0-based row position in the raw file.
    full = config.SCOPES["full"].parquet
    con.execute(
        f"""COPY (
              SELECT s.*, b.split_bucket, b.sample_bucket
              FROM (SELECT row_number() OVER () - 1 AS row_id, * FROM '{stage}') s
              JOIN '{buckets}' b USING (row_id)
              ORDER BY s.row_id
            ) TO '{full}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)"""
    )
    sample = config.SCOPES["dev_sample"].parquet
    con.execute(
        f"""COPY (SELECT * FROM '{full}' WHERE sample_bucket < {config.DEV_SAMPLE_BUCKETS} ORDER BY row_id)
            TO '{sample}' (FORMAT PARQUET, COMPRESSION ZSTD)"""
    )
    stage.unlink()
    buckets.unlink()

    n_full = con.sql(f"SELECT count(*) FROM '{full}'").fetchone()[0]
    n_sample = con.sql(f"SELECT count(*) FROM '{sample}'").fetchone()[0]
    if n_full != n_rows:
        raise RuntimeError(f"Row count changed during ingest: {n_rows} -> {n_full}")

    manifest = {
        "dataset": config.DATASET,
        "raw_file": checksum,
        "raw_schema": raw_schema,
        "rows": {"full": n_full, "dev_sample": n_sample},
        "matches_expected_rows": n_full == config.DATASET["expected_rows"],
        "dev_sample_rule": f"sample_bucket < {config.DEV_SAMPLE_BUCKETS} (salted splitmix64 hash of row_id, 100 buckets)",
        "split_rule": {
            "train": list(config.TRAIN_BUCKETS),
            "valid": list(config.VALID_BUCKETS),
            "test": list(config.TEST_BUCKETS),
            "definition": "split_bucket in [lo, hi) from a salted splitmix64 hash of row_id",
        },
        "seed": config.SEED,
        "files": {
            "full": {"path": full.name, "bytes": full.stat().st_size},
            "dev_sample": {"path": sample.name, "bytes": sample.stat().st_size},
        },
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "build_seconds": round(time.time() - t0, 1),
        "tooling": {
            "python": platform.python_version(),
            "duckdb": duckdb.__version__,
            "pyarrow": pa.__version__,
            "numpy": np.__version__,
        },
    }
    (config.PROCESSED_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def load_manifest() -> dict:
    path = config.PROCESSED_DIR / "manifest.json"
    if not path.exists():
        raise FileNotFoundError("No manifest. Run `python -m experimentos.pipeline ingest` first.")
    return json.loads(path.read_text())
