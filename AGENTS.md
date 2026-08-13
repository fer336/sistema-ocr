# Project Instructions

Track: app · Profile: A

Before making infrastructure changes, read:
INFRASTRUCTURE.md · infra.project.yml · backend/env.example · frontend/.env.example · docker-compose.yml · .github/workflows/

## Project shape

- Repository: `fer336/sistema-ocr`.
- Images: `ghcr.io/fer336/remitos-backend`, `ghcr.io/fer336/remitos-frontend`,
  `ghcr.io/fer336/remitos-postgres`, `ghcr.io/fer336/remitos-minio`.
- Services: `postgres`, `minio`, `backend`, `worker`, `frontend`.
- `worker` reuses the **same image** as `backend` (same `backend/Dockerfile`, only the
  `command:` differs). Never build or publish a separate worker image.
- `postgres`/`minio` are NOT the bare upstream images: `docker/postgres/` and
  `docker/minio/` wrap them with an entrypoint that loads `remitos_env` (Anexo B
  shell/entrypoint adapter) before starting the real process, so their credentials never
  sit as plain container environment variables either. Rebuild these two only when the
  wrapper script changes or the pinned upstream tag needs bumping — not on every app change.
- Backend: FastAPI + SQLAlchemy + Alembic (Python 3.12), `backend/`, migrations in
  `backend/alembic/versions/`, run at container startup before serving traffic
  (`migrations.strategy: entrypoint` in `infra.project.yml`) — `worker` never migrates.
- Frontend: Vite + React 19 + TypeScript, `frontend/`, linted with `oxlint`
  (`npm run lint`), served by nginx which proxies `/api` → `backend:8000`.
- `GET /health` → `{"status":"ok"}`, `GET /version` → `{"version":"vX.Y.Z"}` (backend only —
  `worker`/`frontend`/`postgres`/`minio` don't need their own, per INF-500/502).
- Production runtime config: a single Docker Secret `remitos_env`, declared `external: true`
  and mounted at `/run/secrets/remitos_env`. All four services that need config
  (`backend`, `worker`, `postgres`, `minio`) declare it — no INF-211 deviation, see
  `docs/DEVIATIONS.md`.

Key rules:

- Production is release-driven (SemVer tags), never push-driven.
- Never use `latest` or floating tags; images are immutable, including `postgres`/`minio`.
- One configuration secret per project: `remitos_env`.
- Production config loads from `/run/secrets/remitos_env`; development from `.env`.
- Never commit `.env`; always keep `backend/env.example` / `frontend/.env.example` updated.
  No `.env`/`.env.example` at the repo root by design — see next bullet.
- The local dev loop is Postgres/MinIO in Docker + backend in a venv + `npm run dev` for
  the frontend — never the full stack via `docker compose up`. Only two `.env` files
  exist: `backend/.env` and `frontend/.env`. Locally, `docker-compose.override.yml`
  points `remitos_env` at `backend/.env` (reused, not a third file) instead of a real
  Docker Secret — no separate secret file or folder exists in the repo.
- Never expose backend secrets through frontend build variables (`VITE_*` is public).
- Automated tests are a blocking pipeline stage.
- The image is built entirely from the repo; nothing is downloaded at startup.
- The pipeline updates and pushes the compose before triggering the deploy.
- Every deployment ends with a health **and version** check against production — a `200` with
  the previous version is a failed deployment, not a success (INF-503).
- Automated commits are authored by the CI bot; agents get `Co-authored-by` only when they
  actually contributed. This repo's owner has opted the AI-assistant conversational layer
  (Claude Code sessions) out of `Co-authored-by` trailers as a standing global preference —
  that preference wins per INF-824's own escape hatch ("salvo pedido explícito en contrario").
  This does not affect `github-actions[bot]` authorship on pipeline-generated commits, which
  stays exactly as INF-821 specifies.

## CI/CD

- `.github/workflows/ci.yml` — runs on every push and PR. Tests/lint/build only, never
  touches production.
- `.github/workflows/release.yml` — runs only on tags matching `v[0-9]+.[0-9]+.[0-9]+`.
  Implements the mandatory release pipeline of `INFRASTRUCTURE.md` §7.2 in order, including
  the post-deploy health **and version** check (INF-503).

Required GitHub configuration (see `README.md` → Deployment):
secrets `GHCR_TOKEN`, `PORTAINER_WEBHOOK_URL`; variables `PRODUCTION_HEALTH_URL`,
`VITE_GOOGLE_CLIENT_ID`.

Deviations require an entry in `docs/DEVIATIONS.md`, approved by a human (INF-901).
Do not redesign these conventions unless explicitly requested.
