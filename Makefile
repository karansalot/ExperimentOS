PY ?= .venv/bin/python
API_PORT ?= 8765
WEB_PORT ?= 3000

.PHONY: help setup data pipeline-sample pipeline-full reports screenshots api web test test-e2e lint clean

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

setup: ## create the virtualenv and install backend + frontend dependencies
	python3 -m venv .venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -e "backend[dev]"
	cd frontend && pnpm install

data: ## download (311 MB, checksum-verified) and ingest the Criteo file to Parquet
	cd backend && ../$(PY) -m experimentos.pipeline download
	cd backend && ../$(PY) -m experimentos.pipeline ingest

pipeline-sample: ## statistics + models + SQL on the ~5% development sample (~20 s)
	cd backend && ../$(PY) -m experimentos.pipeline all --scope dev_sample

pipeline-full: ## statistics + models + SQL on all 13,979,592 rows (~12 min, ~6 GB RAM)
	cd backend && ../$(PY) -m experimentos.pipeline all --scope full

reports: ## regenerate docs/*_REPORT.md and docs/RESULTS.md from full-scope artifacts
	cd backend && ../$(PY) -m experimentos.pipeline reports

screenshots: ## regenerate docs/images from the running dashboard (WEB_PORT)
	cd frontend && node scripts/screenshots.mjs http://localhost:$(WEB_PORT)

api: ## run the FastAPI service
	cd backend && ../$(PY) -m uvicorn experimentos.api.main:app --port $(API_PORT) --reload

web: ## run the Next.js dashboard (expects the API on API_PORT)
	cd frontend && API_URL=http://127.0.0.1:$(API_PORT) pnpm dev -p $(WEB_PORT)

test: ## backend unit, statistical and integration tests
	cd backend && ../$(PY) -m pytest

test-e2e: ## Playwright end-to-end tests against the real API and committed artifacts
	cd frontend && API_PORT=$(API_PORT) WEB_PORT=$(WEB_PORT) pnpm test:e2e

lint: ## ruff + TypeScript + ESLint
	cd backend && ../$(PY) -m ruff check .
	cd frontend && pnpm typecheck && pnpm lint

clean: ## remove derived data (keeps the raw download and committed artifacts)
	rm -rf data/processed backend/.pytest_cache frontend/.next
