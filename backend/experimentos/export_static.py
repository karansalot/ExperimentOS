"""Export everything the dashboard needs into static files, for hosting without the Python API.

    python -m experimentos.export_static ../frontend/public/data

GET responses are captured from the real FastAPI app; the interactive calculators (simulator,
brief, planner, sequential lab) run in the browser from the raw artifacts and bootstrap arrays
written here. Parity fixtures let the frontend test suite prove its TypeScript port agrees with Python.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from . import artifacts, brief, config
from .api.main import app
from .simulator.decision import Scenario, simulate
from .stats import power

PARITY_SCENARIOS = [
    {},
    {"cost_per_user": 0.5, "value_per_outcome": 20, "targeting_pct": 30, "population": 100_000},
    {"budget": 8_000, "risk": "conservative", "targeting_pct": 40},
    {"outcome": "conversion", "value_per_outcome": 60, "strategy": "response", "risk": "neutral"},
    {"basis": "unadjusted", "strategy": "t_learner_gbm", "cost_per_user": 0.02},
    {"cost_per_user": 500.0},
]
PARITY_PLANS = [(0.0382, 0.05, 0.5, 0.05, 0.8), (0.0382, 0.1, 0.85, 0.05, 0.9), (0.2, 0.02, 0.3, 0.01, 0.8)]


def _dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False))


def export(out: Path) -> dict:
    if out.exists():
        shutil.rmtree(out)
    client = TestClient(app)

    def get(url: str):
        r = client.get(url)
        r.raise_for_status()
        return r.json()

    meta = get("/api/meta")
    _dump(out / "meta.json", meta)
    written = 1
    for s in meta["scopes"]:
        scope = s["name"]
        d = out / scope
        q = f"scope={scope}"
        pages = {
            "overview": f"/api/overview?{q}", "diagnostics": f"/api/diagnostics?{q}", "data-quality": f"/api/data-quality?{q}",
            "sql": f"/api/sql?{q}", "insights": f"/api/insights?{q}",
        }
        for o in config.OUTCOMES:
            for name in ("segments", "models", "curves", "explain"):
                pages[f"{name}.{o}"] = f"/api/{name}?outcome={o}&{q}"
        for name, url in pages.items():
            _dump(d / f"{name}.json", get(url))
            written += 1
        for qinfo in get(f"/api/sql?{q}")["queries"]:
            _dump(d / "sql" / f"{qinfo['id']}.json", get(f"/api/sql/{qinfo['id']}?{q}"))
            written += 1
        # Raw artifacts for the in-browser calculators.
        for name in ("experiment", "diagnostics", "models", "curves"):
            _dump(d / "raw" / f"{name}.json", artifacts.read(scope, name))
            written += 1
        # Bootstrap gain curves as little-endian float32: [model][replicate][grid point].
        index = {}
        for o in config.OUTCOMES:
            models = list(artifacts.read(scope, "curves")["data"]["outcomes"][o]["models"])
            for split, prefix in (("test", "bootstrap"), ("valid", "bootstrap_valid")):
                npz = np.load(config.SCOPES[scope].artifacts / f"{prefix}_{o}.npz")
                for basis in ("adjusted", "unadjusted"):
                    arr = np.stack([npz[f"{m}__{basis}"] for m in models]).astype("<f4")
                    name = f"boot.{o}.{split}.{basis}.bin"
                    (d / name).write_bytes(arr.tobytes())
                    index[f"{o}.{split}.{basis}"] = {"file": name, "models": models, "shape": list(arr.shape)}
                    written += 1
        _dump(d / "boot-index.json", index)
    return {"files": written, "scopes": [s["name"] for s in meta["scopes"]]}


def parity_fixtures(scope: str = "full") -> dict:
    """Reference outputs the TypeScript port must reproduce."""
    sims, briefs = [], []
    for kw in PARITY_SCENARIOS:
        sc = Scenario(**kw)
        r = simulate(scope, sc)
        sims.append({"scenario": kw, "selected": r["selected"], "recommendation": r["recommendation"], "break_even": r["break_even"],
                     "budget": r["budget"], "targeting_rule": r["targeting_rule"],
                     "strategies": [{k: x.get(k) for k in ("id", "profit", "incremental_outcomes", "profit_low", "profit_high", "feasible")} for x in r["strategies"]],
                     "sensitivity_corner": r["sensitivity"]["grid_rows_cost_cols_value"][0][-1], "tornado": r["sensitivity"]["tornado"]})
        b = brief.build(scope, sc)
        briefs.append({"scenario": kw, "decision": b["decision"], "action": b["action"], "key_numbers": b["key_numbers"],
                       "bullet_counts": [len(x["bullets"]) for x in b["sections"]]})
    plans = []
    for base, rel, share, alpha, pw in PARITY_PLANS:
        p = power.plan(base, rel, share, alpha, pw, users_per_day=10_000)
        plans.append({"args": [base, rel, share, alpha, pw], "required": p["required"], "allocation_cost": p["allocation_cost"],
                      "days_required": p["days_required"], "mde": power.minimum_detectable_effect(p["required"]["n_total"], base, share, alpha, pw)})
    return {"scope": scope, "simulate": sims, "brief": briefs, "plan": plans}


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else config.ROOT / "frontend" / "public" / "data")
    print(export(target))
    fx = config.ROOT / "frontend" / "src" / "lib" / "static" / "parity.fixture.json"
    _dump(fx, parity_fixtures())
    print(f"wrote {fx}")
