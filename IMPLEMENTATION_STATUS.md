# Implementation status

Last updated: 2026-10-15. Scope of verified results: **full dataset, 13,979,592 rows** (plus a labelled ~5% development sample).

## Verification state

| Check | Result | How to reproduce |
|---|---|---|
| Raw file checksum | matches pinned SHA-256 `2716e1bf…f616dc` | `make data` |
| Row count / rates vs dataset card | 13,979,592 rows; treatment 0.85; visit 0.046992; conversion 0.00292 | `pytest backend/tests/test_real_data.py` |
| Data-quality rules | 12 of 12 pass on the full dataset | `artifacts/full/data_quality.json` |
| SQL layer | 20 of 20 queries run on full and sample | `make pipeline-full` |
| Backend tests | 123 pass (synthetic ground-truth fixture + real-data checks) |
| Frontend unit tests | 16 pass, incl. 15 parity tests: the in-browser simulator, brief and planner match Python to 1e-6 | `cd frontend && pnpm test` | `make test` |
| Lint / types | ruff, tsc, ESLint clean | `make lint` |
| Production build | succeeds | `cd frontend && pnpm build` |
| End-to-end tests | 23 pass against the Python-backed app, the static build, and the live Netlify site | `make test-e2e` |
| GitHub Actions | workflow written, **not yet executed**: runs on the first push | push to GitHub |
| Docker images | files written, **not built** (Docker unavailable locally) | `docker compose up --build` |
| Hosting | **live** at https://experimentos-karansalot.netlify.app (static build) | `make static && netlify deploy --prod --dir frontend/out` |

## Phases

| Phase | Status | Notes |
|---|---|---|
| 1. Verify and ingest the real dataset | Done | Full file downloaded (311 MB) from Hugging Face revision `2424920019e4`, license CC BY-NC-SA 4.0. Dataset card inconsistencies documented. |
| 2. Data quality and SQL layer | Done | 6 views, 20 queries, generated data-quality report. |
| 3. Experimentation statistics | Done | Effects, intervals, tests, SRM, balance, adjusted estimators, non-compliance, segments with multiple-testing control. |
| 4. Uplift modelling | Done | 5 strategies, held-out evaluation, paired bootstrap, calibration, model versioning. Causal forest deliberately not built. |
| 5. Business simulator | Done | Cost, value, coverage, budget, risk; break-even; sensitivity. |
| 6. Dashboard | Done | 10 pages: Insights, the 5 required pages, Experiment planner, Sequential testing lab, SQL & data quality (plus Explainability inside the Model lab). |
| 7. Tests, documentation, deployment | Done, with the two unexecuted items above | |

## Requirements traceability

| Requirement | Where |
|---|---|
| Reproducible pipeline, Parquet, quality report | `backend/experimentos/data/`, `pipeline.py`, `docs/DATA_QUALITY_REPORT.md` |
| Never present sample metrics as full results | `Scope` in `config.py`; `meta` on every artifact and API response; scope badge + banner in the UI; `test_real_data.py`, e2e "development sample" tests |
| Effects, CIs, tests, SRM, balance, multiple testing, segments | `stats/` |
| Random, response, two-model, T-, S-learner | `uplift/models.py` |
| Uplift curves, Qini, AUUC, calibration, uncertainty | `uplift/metrics.py` |
| No train/test leakage | hash splits, `uplift/train.py`, `test_no_train_rows_in_predictions` |
| Simulator: incremental outcomes, cost, profit, break-even, strategies, sensitivity | `simulator/decision.py` |
| Monetary outputs labelled as scenarios; no fabricated revenue/cost fields | simulator `caveats`, UI disclaimer, brief assumptions table |
| Five dashboard pages | `frontend/src/app/{page,diagnostics,models,simulator,brief}` |
| Exportable report | Decision Brief: Markdown download, copy, print-to-PDF; `POST /api/brief/markdown` |
| Fixed seeds, model + dataset versioning | `config.SEED`, `model_version()`, pinned revision + SHA-256, ingest manifest |
| Cached analytical outputs | `artifacts/`; API reads files, caches by mtime |
| Browser never loads the dataset | API returns aggregates only; asserted in pytest and Playwright (largest response < 500 KB) |
| At least 15 meaningful SQL queries | 20, see `docs/SQL_CATALOG.md` |
| Model evaluation report, methodology, README, deployment guide, case study, demo script | `docs/` |

## Added after the first delivery (2026-10-13)

| Feature | Where | Verified by |
|---|---|---|
| Experiment planner: sample size, power curve, duration, allocation cost, and what the existing test could detect | `stats/power.py`, `POST /api/plan`, `/planner` page | `tests/test_power.py` (power checked by simulation), e2e |
| Covariate-adjusted segment effects (mean doubly-robust score per segment, computed in DuckDB) | `stats/experiment.py::adjusted_segment_stats`, Diagnostics toggle | test compares the SQL result with Python DR scores |
| Honest coverage selection: depth chosen on the validation split, profit reported on test | `uplift/train.py` (validation bootstrap), `simulator/decision.py` | `test_coverage_is_chosen_on_validation_and_measured_on_test` |
| Deployable targeting rule: model-score cut-off for the selected and recommended coverage | `uplift/metrics.py::score_thresholds`, simulator, brief | unit test, e2e |
| Saved-scenario comparison in the simulator (browser-local) | `components/saved-scenarios.tsx` | e2e |

Effects and model metrics were unchanged by the rerun (same seed). The default-scenario recommendation moved from 12% to 14% coverage because it is now chosen on validation rather than on the test curve.

## Added in the third iteration (2026-10-13)

| Feature | Where | Verified by |
|---|---|---|
| Insights engine and landing page: ten evidence-linked findings generated from artifacts, concentration curve | `insights.py`, `GET /api/insights`, `/` | API test, e2e, `docs/INSIGHTS.md` generated |
| Bayesian read-out: P(better), credible intervals, threshold probabilities, expected loss | `stats/bayes.py`, Overview | tests vs normal approximation and symmetry |
| CUPED-style variance reduction from regression adjustment | `stats/adjustment.py::variance_reduction`, Diagnostics | unit test, e2e |
| Sequential testing lab: naive peeking vs Pocock / O'Brien-Fleming, by simulation | `stats/sequential.py`, `POST /api/sequential`, `/sequential` | tests against published boundary constants and alpha control on fresh simulations |
| Explainability: permutation importance, predicted-vs-observed segment agreement, persuadables profile | `uplift/explain.py`, `GET /api/explain`, Model lab | synthetic test recovers the planted drivers |
| README with screenshots, architecture diagram, interview guide, MIT license, screenshot script | `README.md`, `docs/`, `frontend/scripts/screenshots.mjs` | |

The Overview page moved from `/` to `/overview`.

## Added in the fourth iteration (2026-10-14)

| Feature | Where | Verified by |
|---|---|---|
| Static hosting: export of every API response, raw artifacts and bootstrap arrays | `export_static.py`, `frontend/public/data/` | `test_static_export_mirrors_the_api` |
| TypeScript port of the decision simulator, brief, planner and sequential lab | `frontend/src/lib/static/` | 15 Vitest parity tests against Python fixtures |
| Netlify deployment with cache and security headers | `netlify.toml` | e2e suite run against the live URL |
| Usability: plain-English summaries, glossary popovers and page, first-visit guide, next-step links, theme switch, mobile drawer, presets, CSV export, skeleton loaders, skip link | `frontend/src/components/` | 7 usability e2e tests |

## Security hardening (2026-10-15)

- Next.js 14.2.15 → 15.5.28 and React 19 (cleared 6 critical advisories); `pnpm audit --prod` clean.
- Backend moved to Python ≥ 3.10 (3.12 locally) with security floors for Starlette, anyio, pyarrow, python-dotenv and pytest; `pip-audit` clean.
- Security headers on the hosted site (CSP, HSTS, frame denial, Permissions-Policy, COOP) and in the API; on-demand training can be disabled (`EXPERIMENTOS_ENABLE_TRAINING=0`).
- CSV formula-injection guard; manifests store project-relative paths; read-only CI token; Dependabot; dependency-audit CI job; `SECURITY.md`.
- Fixed a `.gitignore` rule that had excluded `backend/experimentos/data/` and `frontend/public/data/` from the repository.
- Host-injected markup (Netlify) no longer causes React hydration errors; a test asserts zero page errors.

## Deviations from the brief, and why

- **Polars / Pandas not used directly.** DuckDB does all tabular work and NumPy/PyArrow carry arrays; adding a dataframe library would have been decoration. (pandas is installed only as a statsmodels dependency.)
- **statsmodels is the test oracle, not the runtime.** The estimators run on streamed sufficient statistics so they scale to 14M rows; the test suite checks them against statsmodels and SciPy.
- **No EconML / CausalML and no causal forest.** The learners are a few lines of scikit-learn each, and a forest would not change the decision. The brief marked both as optional.
- **No PostgreSQL.** There is no application metadata that needs a database; artifacts are files.
- **shadcn/ui** components are hand-written in the shadcn style (Radix primitives, `cva`, `cn`) rather than generated by the CLI.
- **API port defaults to 8765**, not 8000, because 8000 was occupied on the development machine. Configurable via `API_PORT`.
- **An extra evaluation basis was added.** The data showed covariate imbalance between arms, so uplift curves and the simulator support a doubly-robust basis in addition to the classic unadjusted one. This was not in the brief but the finding required it.

## Known gaps and honest caveats

- **Docker images are unbuilt** (see table above).
- **The GitHub repository has not received a push from this machine**: no GitHub credentials are stored here; the push must be authenticated by the owner.
- **Permutation importance uses a labelled 300,000-row sample** of the test split; everything else uses all rows.
- **On-demand training is development-sample only.** Full-data training is a CLI job by design. A retrain with a non-default seed reuses the cached cross-fitted nuisance scores.
- **Segment p-values and the heterogeneity test use the unadjusted effect**; the adjusted segment effect is shown with its own interval only.
- **The planner covers a fixed-horizon, single-metric test**; no sequential or multi-metric designs.
- **Saved scenarios live in browser storage**, not on the server.
- **Bootstrap bin edges are fixed** at the point-estimate ranking (scores are not re-ranked per replicate, which is correct for fixed models, but model-fitting variance is not included).
- **Dark and light themes** follow the operating system; there is no manual toggle.
- **No authentication.**

## Timings (10-core Apple Silicon laptop, 24 GB RAM)

| Step | Time |
|---|---|
| Download 311 MB | under 1 minute |
| Ingest to Parquet (full + sample) | 9 to 15 s |
| Full pipeline: SQL views, statistics with cross-fitting and adjusted segments, 10 model fits, 200-replicate bootstrap on validation and test, 20 queries | about 12 min |
| Development-sample pipeline | about 20 s |
| Backend test suite | about 45 s |

## Possible next steps

1. Push to GitHub and confirm the workflow passes; build the Docker images once.
2. Prospective validation: a new randomised test of targeted vs blanket vs held-out.
3. Sequential-testing support in the planner (alpha spending) and a CUPED-style variance-reduction estimate.
4. Heterogeneity tests on the adjusted segment effects.
