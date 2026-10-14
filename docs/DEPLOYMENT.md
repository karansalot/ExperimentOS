# Deployment guide

ExperimentOS has two processes: a FastAPI service that serves cached artifacts and runs the simulator, and a Next.js dashboard that proxies `/api/*` to it. The browser never talks to the data directly and never receives row-level data.

## What needs to be deployed

| Component | Needs | Stateless? |
|---|---|---|
| API (`backend/`) | Python 3.9+, the `artifacts/` directory (about 6 MB for both scopes) | Yes. Artifacts are read-only files, cached in memory by modification time |
| Dashboard (`frontend/`) | Node 20+, `API_URL` pointing at the API | Yes |
| Pipeline (batch) | The 311 MB raw file, about 6 GB RAM, about 6 minutes on 10 cores | Run offline; produces `artifacts/` |

The API does not need the dataset. Without `data/`, everything works except on-demand retraining, which returns HTTP 409 with an explanation and is disabled in the UI.

## Local

```bash
make setup
make api          # http://127.0.0.1:8765  (docs at /docs)
make web          # http://localhost:3000
```

## Containers

`backend/Dockerfile`, `frontend/Dockerfile` and `docker-compose.yml` are provided:

```bash
docker compose up --build     # dashboard on :3000, API on :8765
```

These files were written but **not built or run in the development environment** (Docker was not installed there). Treat them as a starting point and build once before relying on them.

`API_URL` is consumed by the Next.js rewrite at **build** time, so it is a build argument of the frontend image, not a runtime variable.

## Configuration

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `API_URL` | frontend (build) | `http://127.0.0.1:8765` | where `/api/*` is proxied |
| `EXPERIMENTOS_ROOT` | backend | repository root | base for `data/` and `artifacts/` |
| `EXPERIMENTOS_ARTIFACTS_DIR` | backend | `$ROOT/artifacts` | cached outputs served by the API |
| `EXPERIMENTOS_DATA_DIR` | backend | `$ROOT/data` | raw + Parquet (pipeline and retraining only) |
| `EXPERIMENTOS_CORS_ORIGINS` | backend | `http://localhost:3000,http://127.0.0.1:3000` | only relevant if the browser calls the API directly |

## Hosting options

- **Single VM or container host:** run both containers behind a reverse proxy that terminates TLS and forwards everything to the dashboard.
- **Split hosting:** dashboard on a Node host (for example Vercel) with `API_URL` set to the API's URL at build time; API on any container platform. Because the dashboard proxies `/api/*`, no CORS setup is needed.
- **Refreshing results:** run the pipeline as a batch job, then ship the new `artifacts/` directory (rebuild the API image or mount a volume). The API picks up changed files without a restart.

## Before exposing it publicly

- **License.** The dataset is CC BY-NC-SA 4.0: non-commercial use, attribution, share-alike. The dashboard footer and README carry the attribution.
- **Authentication.** There is none. Put the app behind your identity proxy if it should not be public.
- **`POST /api/train`** starts a CPU-bound background job (development sample only, one at a time). Disable it in public deployments by not shipping `data/`, which is the default for the container image.
- **Model files** (`artifacts/*/models/*.joblib`) are pickles: they are git-ignored, not served, and should only ever be loaded from a pipeline run you performed yourself.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Backend** on Python 3.9 and 3.12: ruff, then pytest. The suite generates a synthetic dataset with a known treatment effect and pushes it through the real ingest → SQL → statistics → uplift → simulator → API path, so CI never downloads the 311 MB file.
2. **Artifact check:** every committed artifact is strict JSON and correctly labelled full vs sample.
3. **Frontend:** type-check, ESLint, production build, then Playwright end-to-end tests against the real API serving the committed artifacts.

The workflow has not been executed on GitHub yet (the repository has no remote); the same commands pass locally.
