"""Cached analytical outputs. Every artifact is stamped with the scope and dataset that produced it."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

from . import config

NAMES = ("dataset", "data_quality", "sql", "experiment", "diagnostics", "segments", "models", "curves", "explain")


def _clean(o: Any) -> Any:
    """Make a payload strict-JSON safe (NaN/inf -> null, NumPy -> Python)."""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    if isinstance(o, np.generic):
        return _clean(o.item())
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, (str, int, bool)) or o is None:
        return o
    if isinstance(o, Path):
        return str(o)
    try:
        return float(o)  # Decimal and friends
    except (TypeError, ValueError):
        return str(o)


def build_meta(scope: config.Scope, n_rows: int, full_rows: Optional[int] = None) -> dict:
    return {
        "scope": scope.name,
        "scope_label": scope.label,
        "is_sample": scope.is_sample,
        "n_rows": int(n_rows),
        "full_dataset_rows": int(full_rows) if full_rows is not None else config.DATASET["expected_rows"],
        "dataset": f"{config.DATASET['name']} {config.DATASET['version']}",
        "dataset_version": config.DATASET["version"],
        "raw_sha256": config.DATASET["raw_sha256"],
        "license": config.DATASET["license"],
        "seed": config.SEED,
        "code_version": config.CODE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def path(scope_name: str, name: str) -> Path:
    return config.ARTIFACTS_DIR / scope_name / f"{name}.json"


def write(scope: config.Scope, name: str, data: Any, meta: dict) -> Path:
    p = path(scope.name, name)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"meta": meta, "data": _clean(data)}, allow_nan=False, separators=(",", ":")))
    return p


def exists(scope_name: str, name: str) -> bool:
    return path(scope_name, name).exists()


def read(scope_name: str, name: str) -> dict:
    p = path(scope_name, name)
    if not p.exists():
        raise FileNotFoundError(f"Artifact {scope_name}/{name} not found. Run the pipeline for this scope.")
    return json.loads(p.read_text())


def available_scopes() -> list[dict]:
    out = []
    for s in config.SCOPES.values():
        present = [n for n in NAMES if exists(s.name, n)]
        if present:
            out.append({"name": s.name, "label": s.label, "is_sample": s.is_sample, "artifacts": present})
    return out
