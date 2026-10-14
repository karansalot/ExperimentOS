"""Executes the SQL analytical layer (views + numbered queries) with DuckDB."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

from .. import config

VIEWS_DIR = config.SQL_DIR / "views"
QUERIES_DIR = config.SQL_DIR / "queries"
_HEADER = re.compile(r"^--\s*(title|technique|question|requires):\s*(.+)$")


@dataclass
class Query:
    id: str
    path: Path
    sql: str
    title: str = ""
    technique: str = ""
    question: str = ""
    requires: list[str] = field(default_factory=list)


def load_queries() -> list[Query]:
    out = []
    for path in sorted(QUERIES_DIR.glob("*.sql")):
        text = path.read_text()
        q = Query(id=path.stem, path=path, sql=text)
        for line in text.splitlines():
            m = _HEADER.match(line.strip())
            if not m:
                continue
            key, val = m.group(1), m.group(2).strip()
            if key == "requires":
                q.requires = [v.strip() for v in val.split(",")]
            else:
                setattr(q, key, val)
        out.append(q)
    return out


def default_params(scope: config.Scope, extra: dict | None = None) -> dict:
    params = {
        "parquet": str(scope.parquet),
        "train_hi": config.TRAIN_BUCKETS[1],
        "valid_hi": config.VALID_BUCKETS[1],
        "design_ratio": config.DESIGN_TREATMENT_RATIO,
        "dev_buckets": config.DEV_SAMPLE_BUCKETS,
        "min_control": 1000,
    }
    params.update(extra or {})
    return params


def render(sql: str, params: dict) -> str:
    def sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in params:
            raise KeyError(f"SQL template parameter {{{{{key}}}}} was not provided")
        return str(params[key])

    return re.sub(r"\{\{(\w+)\}\}", sub, sql)


def connect(scope: config.Scope, params: dict | None = None, materialize: bool = True) -> duckdb.DuckDBPyConnection:
    """Open an in-memory DuckDB session with all views for ``scope`` defined.

    ``materialize=False`` skips the feature_value_stats table (and dependent views),
    for callers that only need the base ``experiment`` view.
    """
    if not scope.parquet.exists():
        raise FileNotFoundError(f"{scope.parquet} missing. Run the ingest step first.")
    p = default_params(scope, params)
    con = duckdb.connect()
    for path in sorted(VIEWS_DIR.glob("*.sql")):
        if not materialize and path.name >= "04":
            break
        con.execute(render(path.read_text(), p))
    if scope.predictions.exists():
        con.execute(f"CREATE OR REPLACE VIEW predictions AS SELECT * FROM read_parquet('{scope.predictions}')")
    return con


def has_relation(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    return bool(
        con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[0]
    )


def run_query(con: duckdb.DuckDBPyConnection, query: Query, params: dict) -> dict:
    """Run one query; returns columns + rows + timing, or a skipped marker."""
    missing = [r for r in query.requires if not has_relation(con, r)]
    base = {
        "id": query.id,
        "title": query.title,
        "technique": query.technique,
        "question": query.question,
        "requires": query.requires,
    }
    if missing:
        return {**base, "sql": query.sql, "status": "skipped", "reason": f"requires {', '.join(missing)} (train models first)"}
    sql = render(query.sql, params)
    t0 = time.time()
    rel = con.sql(sql)
    columns = rel.columns
    rows = rel.fetchall()
    return {
        **base,
        "sql": sql,
        "status": "ok",
        "columns": columns,
        "rows": [list(r) for r in rows],
        "row_count": len(rows),
        "seconds": round(time.time() - t0, 3),
    }


def run_all(scope: config.Scope, extra_params: dict | None = None, con: duckdb.DuckDBPyConnection | None = None) -> list[dict]:
    params = default_params(scope, extra_params)
    con = con or connect(scope, extra_params)
    return [run_query(con, q, params) for q in load_queries()]
