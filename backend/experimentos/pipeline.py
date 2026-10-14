"""Command-line entry point for the reproducible pipeline.

    python -m experimentos.pipeline download
    python -m experimentos.pipeline ingest
    python -m experimentos.pipeline all --scope dev_sample
    python -m experimentos.pipeline all --scope full
    python -m experimentos.pipeline reports
"""
from __future__ import annotations

import argparse
import json
import time

from . import artifacts, config
from .data import download as dl
from .data import ingest as ing
from .data import quality
from .data.loader import load_frame
from .sql import runner
from .stats import experiment
from .uplift import train


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _champion_params(scope: config.Scope) -> dict:
    if not artifacts.exists(scope.name, "models"):
        return {}
    m = artifacts.read(scope.name, "models")["data"]["outcomes"]
    return {f"champion_{o}": f"{o}__{m[o]['champion']}" for o in m}


def run_sql(scope: config.Scope, meta: dict, con=None, manifest=None) -> list[dict]:
    """Run the SQL layer and rebuild the data quality report that is derived from it."""
    results = runner.run_all(scope, _champion_params(scope), con=con or runner.connect(scope))
    artifacts.write(scope, "sql", {"queries": results, "engine": "DuckDB", "dialect_note": "{{...}} placeholders are filled from config.py"}, meta)
    artifacts.write(scope, "data_quality", quality.build(results, manifest or ing.load_manifest(), scope), meta)
    return results


def run_all(scope_name: str, n_boot: int = 200, skip_train: bool = False) -> None:
    scope = config.get_scope(scope_name)
    manifest = ing.load_manifest()
    meta = artifacts.build_meta(scope, manifest["rows"][scope.name], manifest["rows"]["full"])
    _log(f"scope={scope.name} rows={meta['n_rows']:,}")

    artifacts.write(scope, "dataset", {"manifest": manifest, "scope": {"name": scope.name, "label": scope.label, "is_sample": scope.is_sample}}, meta)

    con = runner.connect(scope)
    _log("SQL views ready")
    frame = load_frame(scope)
    _log("rows loaded for modelling")

    res = experiment.analyze(scope, con, frame=frame)
    for name in ("experiment", "diagnostics", "segments"):
        artifacts.write(scope, name, res[name], meta)
    _log("experiment statistics written")

    if not skip_train:
        out = train.train_and_evaluate(scope, frame, n_boot=n_boot, progress=lambda m, i, n: _log(f"train [{i}/{n}] {m}"))
        train.save_outputs(scope, out, meta)
        _log("uplift models written")
        from .uplift import explain

        artifacts.write(scope, "explain", explain.explain(scope), meta)
        _log("model explanations written")
        con = runner.connect(scope)  # reconnect so the predictions view exists

    results = run_sql(scope, meta, con, manifest)
    _log(f"SQL layer: {sum(r['status'] == 'ok' for r in results)}/{len(results)} queries ok; data quality report written")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="experimentos.pipeline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download", help="download and checksum-verify the raw file")
    sub.add_parser("ingest", help="raw CSV -> validated Parquet (full + dev sample)")
    p = sub.add_parser("all", help="statistics, uplift models, SQL layer and data quality for one scope")
    p.add_argument("--scope", default="dev_sample", choices=sorted(config.SCOPES))
    p.add_argument("--n-boot", type=int, default=200)
    p.add_argument("--skip-train", action="store_true")
    p = sub.add_parser("sql", help="re-run only the SQL layer and the data quality report")
    p.add_argument("--scope", default="dev_sample", choices=sorted(config.SCOPES))
    p = sub.add_parser("explain", help="re-run only the model explanations (needs trained models)")
    p.add_argument("--scope", default="dev_sample", choices=sorted(config.SCOPES))
    sub.add_parser("reports", help="regenerate Markdown reports in docs/ from the cached artifacts")
    a = ap.parse_args(argv)

    if a.cmd == "download":
        print(json.dumps(dl.download(), indent=2))
    elif a.cmd == "ingest":
        m = ing.ingest()
        print(json.dumps({k: m[k] for k in ("rows", "matches_expected_rows", "files", "build_seconds")}, indent=2))
    elif a.cmd == "all":
        run_all(a.scope, a.n_boot, a.skip_train)
    elif a.cmd == "sql":
        scope = config.get_scope(a.scope)
        manifest = ing.load_manifest()
        run_sql(scope, artifacts.build_meta(scope, manifest["rows"][scope.name], manifest["rows"]["full"]))
    elif a.cmd == "explain":
        from .uplift import explain

        scope = config.get_scope(a.scope)
        meta = artifacts.read(scope.name, "models")["meta"]
        artifacts.write(scope, "explain", explain.explain(scope), meta)
        print(f"explanations written for {scope.name}")
    elif a.cmd == "reports":
        from . import reports

        for path in reports.write_all():
            print(f"wrote {path}")


if __name__ == "__main__":
    main()
