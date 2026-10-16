"""FastAPI service. Serves cached analytical artifacts and runs the decision simulator.

The browser only ever receives aggregates: row-level data never leaves the server.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .. import artifacts, brief, config, insights
from ..simulator.decision import RISK_LABELS, Scenario, simulate

app = FastAPI(title="ExperimentOS API", version=config.CODE_VERSION,
              description="Experiment read-outs, uplift model evaluation and decision simulation on the Criteo uplift dataset.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("EXPERIMENTOS_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["*"], allow_headers=["*"],
)

@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cache-Control", "no-store" if request.method != "GET" else "public, max-age=60")
    return response


# On-demand training is CPU-heavy and unauthenticated: disable it on any shared deployment.
TRAINING_ENABLED = os.environ.get("EXPERIMENTOS_ENABLE_TRAINING", "1") != "0"

_cache: dict = {}
_cache_lock = threading.Lock()


def _read(scope: str, name: str) -> dict:
    """Read an artifact, cached until the file changes on disk."""
    p = artifacts.path(scope, name)
    if not p.exists():
        raise HTTPException(404, f"Artifact '{name}' is not available for scope '{scope}'. Run the pipeline for this scope.")
    key, mtime = (scope, name), p.stat().st_mtime
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] == mtime:
            return hit[1]
    data = artifacts.read(scope, name)
    with _cache_lock:
        _cache[key] = (mtime, data)
    return data


def _scope(scope: Optional[str]) -> str:
    available = [s["name"] for s in artifacts.available_scopes()]
    if not available:
        raise HTTPException(503, "No artifacts found. Run `python -m experimentos.pipeline all --scope dev_sample` first.")
    if scope is None:
        return "full" if "full" in available else available[0]
    if scope not in config.SCOPES:
        raise HTTPException(422, f"Unknown scope '{scope}'. Choose from {sorted(config.SCOPES)}.")
    if scope not in available:
        raise HTTPException(404, f"Scope '{scope}' has no artifacts yet.")
    return scope


def _outcome(outcome: str) -> str:
    if outcome not in config.OUTCOMES:
        raise HTTPException(422, f"Unknown outcome '{outcome}'. Choose from {config.OUTCOMES}.")
    return outcome


ScopeQ = Query(None, description="'full' or 'dev_sample'. Defaults to full when available.")


class ScenarioIn(BaseModel):
    outcome: str = "visit"
    strategy: str = "champion"
    population: int = Field(1_000_000, gt=0, le=10_000_000_000)
    cost_per_user: float = Field(0.05, ge=0)
    value_per_outcome: float = Field(5.0, ge=0)
    targeting_pct: float = Field(20.0, ge=0, le=100)
    budget: Optional[float] = Field(None, ge=0)
    risk: str = "moderate"
    basis: str = "adjusted"

    def to_scenario(self) -> Scenario:
        return Scenario(**self.model_dump())


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": config.CODE_VERSION, "scopes": [s["name"] for s in artifacts.available_scopes()]}


@app.get("/api/meta")
def meta() -> dict:
    scopes = artifacts.available_scopes()
    for s in scopes:
        s["meta"] = _read(s["name"], "dataset")["meta"]
    return {
        "dataset": config.DATASET,
        "scopes": scopes,
        "default_scope": _scope(None),
        "outcomes": config.OUTCOMES,
        "features": config.FEATURES,
        "design_treatment_ratio": config.DESIGN_TREATMENT_RATIO,
        "risk_options": [{"id": k, "label": v} for k, v in RISK_LABELS.items()],
        "seed": config.SEED,
    }


@app.get("/api/overview")
def overview(scope: Optional[str] = ScopeQ) -> dict:
    s = _scope(scope)
    exp, dq, diag = _read(s, "experiment"), _read(s, "data_quality"), _read(s, "diagnostics")
    from ..stats import adjustment, bayes

    arms = {a["arm"]: a for a in exp["data"]["arms"]}
    posterior = {
        o: bayes.beta_binomial(arms["treatment"][c], arms["treatment"]["n_users"], arms["control"][c], arms["control"]["n_users"], draws=200_000)
        for o, c in (("visit", "visits"), ("conversion", "conversions"))
    }
    vr = {}
    for o, v in ((diag["data"].get("adjusted") or {}).get("outcomes") or {}).items():
        unadj, lin = v["estimators"][0], next(x for x in v["estimators"] if x["method"].startswith("Regression"))
        vr[o] = {**adjustment.variance_reduction(unadj["std_error"], lin["std_error"]), "method": lin["method"]}
    return {
        "bayes": posterior,
        "variance_reduction": vr,
        "meta": exp["meta"],
        "experiment": exp["data"],
        "profile": dq["data"]["profile"],
        "columns": dq["data"]["columns"],
        "card_comparison": dq["data"]["dataset_card_comparison"],
        "balance_verdict": diag["data"]["verdict"],
        "adjusted": (diag["data"].get("adjusted") or {}).get("outcomes"),
        "quality_passed": dq["data"]["all_error_checks_passed"],
    }


@app.get("/api/diagnostics")
def diagnostics(scope: Optional[str] = ScopeQ) -> dict:
    s = _scope(scope)
    diag, exp = _read(s, "diagnostics"), _read(s, "experiment")
    return {"meta": diag["meta"], **diag["data"], "srm": exp["data"]["srm"], "outcomes": exp["data"]["outcomes"],
            "exposure": exp["data"]["exposure"]}


@app.get("/api/segments")
def segments(outcome: str = "visit", scope: Optional[str] = ScopeQ) -> dict:
    s = _scope(scope)
    seg = _read(s, "segments")
    d = seg["data"]
    return {"meta": seg["meta"], "outcome": _outcome(outcome), "segment_definition": d["segment_definition"],
            "min_control_for_reliable_segment": d["min_control_for_reliable_segment"],
            "has_adjusted_effects": d.get("has_adjusted_effects", False), "adjusted_definition": d.get("adjusted_definition"),
            **d["outcomes"][outcome]}


@app.get("/api/data-quality")
def data_quality(scope: Optional[str] = ScopeQ) -> dict:
    dq = _read(_scope(scope), "data_quality")
    return {"meta": dq["meta"], **dq["data"]}


@app.get("/api/models")
def models(outcome: str = "visit", scope: Optional[str] = ScopeQ) -> dict:
    m = _read(_scope(scope), "models")
    return {"meta": m["meta"], "outcome": _outcome(outcome), "run": m["data"]["run"], **m["data"]["outcomes"][outcome]}


@app.get("/api/curves")
def curves(outcome: str = "visit", scope: Optional[str] = ScopeQ) -> dict:
    c = _read(_scope(scope), "curves")
    return {"meta": c["meta"], "outcome": _outcome(outcome), **c["data"]["outcomes"][outcome]}


@app.post("/api/simulate")
def run_simulation(body: ScenarioIn, scope: Optional[str] = ScopeQ) -> dict:
    try:
        return simulate(_scope(scope), body.to_scenario())
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/brief")
def decision_brief(body: ScenarioIn, scope: Optional[str] = ScopeQ) -> dict:
    try:
        return brief.build(_scope(scope), body.to_scenario())
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/brief/markdown", response_class=PlainTextResponse)
def decision_brief_markdown(body: ScenarioIn, scope: Optional[str] = ScopeQ) -> str:
    return decision_brief(body, scope)["markdown"]


class PlanIn(BaseModel):
    outcome: str = "visit"
    base_rate: Optional[float] = Field(None, gt=0, lt=1, description="Defaults to the observed control rate for the outcome.")
    mde_relative: float = Field(0.05, gt=0, le=10)
    treatment_share: float = Field(0.5, gt=0, lt=1)
    alpha: float = Field(0.05, gt=0, lt=1)
    power: float = Field(0.8, gt=0, lt=1)
    users_per_day: Optional[float] = Field(None, gt=0)


@app.post("/api/plan")
def plan_experiment(body: PlanIn, scope: Optional[str] = ScopeQ) -> dict:
    """Experiment planner: sample size, power and allocation trade-offs for a future test."""
    from ..stats import power as pw

    s = _scope(scope)
    exp = _read(s, "experiment")
    observed = exp["data"]["outcomes"][_outcome(body.outcome)]
    base = body.base_rate if body.base_rate is not None else observed["rate_control"]
    try:
        out = pw.plan(base, body.mde_relative, body.treatment_share, body.alpha, body.power, body.users_per_day,
                      observed_n=None)
        # What the experiment in this scope could detect, at its own allocation.
        n_obs = observed["n_treatment"] + observed["n_control"]
        share_obs = observed["n_treatment"] / n_obs
        mde = pw.minimum_detectable_effect(n_obs, observed["rate_control"], share_obs, body.alpha, body.power)
        out["observed_experiment"] = {
            "n_total": n_obs, "treatment_share": share_obs, "base_rate": observed["rate_control"],
            "mde_absolute": mde, "mde_relative": mde / observed["rate_control"],
            "observed_effect": observed["absolute_effect"],
        }
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"meta": exp["meta"], "outcome": body.outcome, "base_rate_source": "user input" if body.base_rate is not None else "observed control rate", **out}


_insight_cache: dict = {}


@app.get("/api/insights")
def get_insights(scope: Optional[str] = ScopeQ) -> dict:
    """Evidence-linked findings generated from the cached artifacts (recomputed only when they change)."""
    s = _scope(scope)
    stamp = tuple(artifacts.path(s, n).stat().st_mtime if artifacts.exists(s, n) else 0 for n in artifacts.NAMES)
    hit = _insight_cache.get(s)
    if hit and hit[0] == stamp:
        return hit[1]
    try:
        data = insights.build(s)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    _insight_cache[s] = (stamp, data)
    return data


@app.get("/api/explain")
def explain(outcome: str = "visit", scope: Optional[str] = ScopeQ) -> dict:
    e = _read(_scope(scope), "explain")
    return {"meta": e["meta"], "outcome": _outcome(outcome), "importance_sample": e["data"]["importance_sample"], **e["data"]["outcomes"][outcome]}


class SequentialIn(BaseModel):
    n_looks: int = Field(10, ge=1, le=50)
    alpha: float = Field(0.05, gt=0, lt=0.5)
    power: float = Field(0.8, gt=0, lt=1)


@app.post("/api/sequential")
def sequential_design(body: SequentialIn) -> dict:
    """Peeking vs group-sequential boundaries, by seeded simulation (no data scope involved)."""
    from ..stats import sequential

    return sequential.simulate(body.n_looks, body.alpha, body.power, sims=60_000)


@app.get("/api/sql")
def sql_catalog(scope: Optional[str] = ScopeQ) -> dict:
    s = _read(_scope(scope), "sql")
    keep = ("id", "title", "technique", "question", "status", "row_count", "seconds", "reason")
    return {"meta": s["meta"], "engine": s["data"]["engine"], "queries": [{k: q.get(k) for k in keep} for q in s["data"]["queries"]]}


@app.get("/api/sql/{query_id}")
def sql_query(query_id: str, scope: Optional[str] = ScopeQ, limit: int = Query(200, ge=1, le=1000)) -> dict:
    s = _read(_scope(scope), "sql")
    for q in s["data"]["queries"]:
        if q["id"] == query_id:
            out = dict(q)
            if "rows" in out:
                out["truncated"] = len(out["rows"]) > limit
                out["rows"] = out["rows"][:limit]
            return {"meta": s["meta"], **out}
    raise HTTPException(404, f"No query with id '{query_id}'.")


# ---------------------------------------------------------------------------
# On-demand training (development sample only; the full run is a CLI job)
# ---------------------------------------------------------------------------
class TrainIn(BaseModel):
    seed: int = Field(config.SEED, ge=0, le=2**31 - 1)
    n_boot: int = Field(100, ge=20, le=500)


_job: dict = {"state": "idle"}
_job_lock = threading.Lock()


def _run_training(seed: int, n_boot: int) -> None:
    from ..data import ingest
    from ..uplift import train

    scope = config.get_scope("dev_sample")
    t0 = time.time()

    def progress(message: str, step: int, total: int) -> None:
        with _job_lock:
            _job.update(message=message, step=step, total=total, elapsed_seconds=round(time.time() - t0, 1))

    try:
        manifest = ingest.load_manifest()
        meta = artifacts.build_meta(scope, manifest["rows"][scope.name], manifest["rows"]["full"])
        out = train.train_and_evaluate(scope, seed=seed, n_boot=n_boot, progress=progress)
        train.save_outputs(scope, out, meta)
        with _job_lock:
            _job.update(state="completed", finished_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        elapsed_seconds=round(time.time() - t0, 1), message="Training finished")
    except Exception as exc:  # surfaced to the UI rather than swallowed
        with _job_lock:
            _job.update(state="failed", error=f"{type(exc).__name__}: {exc}")


@app.post("/api/train", status_code=202)
def start_training(body: TrainIn) -> dict:
    scope = config.get_scope("dev_sample")
    if not TRAINING_ENABLED:
        raise HTTPException(403, "On-demand training is disabled on this deployment (EXPERIMENTOS_ENABLE_TRAINING=0).")
    if not scope.parquet.exists():
        raise HTTPException(409, "Row-level data is not present on this server (artifact-only deployment). "
                                 "Run the download and ingest steps to enable training.")
    with _job_lock:
        if _job.get("state") == "running":
            raise HTTPException(409, "A training job is already running.")
        _job.clear()
        _job.update(state="running", scope="dev_sample", seed=body.seed, n_boot=body.n_boot, step=0, total=10,
                    message="Loading rows", started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    threading.Thread(target=_run_training, args=(body.seed, body.n_boot), daemon=True).start()
    return dict(_job)


@app.get("/api/train/status")
def training_status() -> dict:
    with _job_lock:
        job = dict(_job)
    job["can_train"] = TRAINING_ENABLED and config.get_scope("dev_sample").parquet.exists()
    job["trainable_scope"] = "dev_sample"
    return job
