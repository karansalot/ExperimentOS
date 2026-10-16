# Security

## Reporting a vulnerability

Please report security issues privately via GitHub's **Report a vulnerability** (Security tab → Advisories), or by email to the maintainer listed on the GitHub profile. Do not open a public issue. You can expect an acknowledgement within a few days.

## What is deployed, and its attack surface

| Component | Exposure | Notes |
|---|---|---|
| Hosted demo (Netlify) | Public, static files only | No server code, no database, no user accounts, no cookies, no third-party scripts or trackers. All data is aggregate and public (Criteo, CC BY-NC-SA 4.0). |
| FastAPI service | Local / self-hosted only | Read-only artifact serving plus pure-function calculators with validated (Pydantic) inputs. No SQL is built from user input: query ids are looked up in a fixed catalogue. |
| `POST /api/train` | Local only | Unauthenticated and CPU-heavy. Disable on any shared deployment with `EXPERIMENTOS_ENABLE_TRAINING=0` (the docker-compose file does). |
| Model files (`*.joblib`) | Never committed or served | Pickle files execute code on load; they are only loaded from a pipeline run on the same machine. |

## Controls in place

- **HTTP security headers on the hosted site** (`netlify.toml`): Content-Security-Policy restricting every resource to the site's own origin, `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. The API sets equivalent headers in a middleware.
- **Dependency hygiene:** `make audit` runs `pip-audit` and `pnpm audit --prod`; CI runs both on every push; Dependabot opens weekly update PRs for Python, npm and GitHub Actions. Security floors are pinned in `backend/pyproject.toml`, and the `pnpm.overrides` in `frontend/package.json` force patched transitive packages.
- **CI least privilege:** the workflow token is read-only (`permissions: contents: read`).
- **No secrets in the repository:** no API keys are needed to build, test or deploy the static site. A full-history secret scan was clean as of 2026-10-15.
- **Data integrity:** the raw dataset is pinned to a Hugging Face commit and refused unless its SHA-256 matches.
- **Export safety:** CSV downloads neutralise spreadsheet formulas (cells starting with `=`, `+`, `-`, `@`).
- **Privacy:** no analytics, no cookies, and browser storage holds only UI preferences (theme, scope, saved scenarios).

## Known, accepted findings

- `braces` (high, ReDoS) via `eslint-config-next` → `fast-glob`. Development-only linting tool; no patched release exists; it never processes untrusted input.
- `script-src 'unsafe-inline'` in the CSP: required by Next.js's inline hydration payload in a static export. Mitigated by `default-src 'self'`, no user-generated HTML anywhere in the app (React escapes all output), and no third-party origins allowed.
