# Sanitini — Remitos

OCR de remitos: backend FastAPI (`backend/`), frontend Vite + React (`frontend/`),
PostgreSQL y MinIO. En producción los cinco corren en contenedores (Docker Compose,
desplegado vía Portainer); en desarrollo local **solo Postgres y MinIO corren en
Docker** — backend y frontend corren nativos (venv / `npm run dev`).

## Desarrollo local

```bash
docker compose up -d postgres minio     # únicos dos servicios con estado

cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                    # completar valores
alembic upgrade head
uvicorn app.main:app --reload           # otra terminal: python -m app.worker.run

cd ../frontend
npm install
cp .env.example .env                    # completar VITE_GOOGLE_CLIENT_ID
npm run dev
```

Detalle en [`backend/README.md`](backend/README.md) y [`frontend/README.md`](frontend/README.md).
Levantar el stack completo en contenedores (`docker compose up -d` sin filtrar
servicios) sirve para probar la imagen tal como se despliega en producción, pero no es
el loop de desarrollo del día a día.

Solo hacen falta **dos** `.env` en local -- `backend/.env` y `frontend/.env`, nada en la
raíz del repo. `docker-compose.override.yml` reusa `backend/.env` como fuente de
credenciales para los contenedores de Postgres/MinIO (mismo mecanismo que usa
`remitos_env` en producción, ver `docker/postgres/` y `docker/minio/`) en vez de pedir un
tercer archivo solo para eso.

## Deployment

La infraestructura sigue el estándar Qeva. Fuentes de verdad:

- [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) — reglas obligatorias de Docker, Compose,
  Portainer, releases y secrets.
- [`infra.project.yml`](infra.project.yml) — instanciación del estándar para este proyecto
  (org, imágenes, secret, healthcheck, servicios).
- [`AGENTS.md`](AGENTS.md) — resumen operativo para agentes y contribuidores.
- [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) — desviaciones registradas del estándar.

Producción es release-driven: se despliega publicando un tag SemVer
(`vMAJOR.MINOR.PATCH`), que dispara `.github/workflows/release.yml`. Los pushes y PRs
sólo ejecutan CI (`.github/workflows/ci.yml`) y nunca tocan producción.

### Configuración pendiente en GitHub

Antes de la primera release hay que cargar esto en
**Settings → Secrets and variables → Actions**:

| Tipo     | Nombre                   | Contenido                                                                    |
| -------- | ------------------------ | ---------------------------------------------------------------------------- |
| Secret   | `GHCR_TOKEN`             | PAT con `write:packages` para publicar en `ghcr.io/santini/remitos-*`.        |
| Secret   | `PORTAINER_WEBHOOK_URL`  | URL del webhook del stack en Portainer.                                       |
| Variable | `PRODUCTION_HEALTH_URL`  | URL pública del healthcheck del backend, p.ej. `https://<dominio>/health`.     |
| Variable | `VITE_GOOGLE_CLIENT_ID`  | Google OAuth *client id* (público: queda embebido en el bundle del frontend). |

La configuración de runtime (contraseñas, API keys, JWT) **no** va a GitHub: vive en el
único Docker Secret `remitos_env` administrado desde Portainer y montado en
`/run/secrets/remitos_env`. Lo consumen los cuatro servicios con estado/config real:
`backend`, `worker`, `postgres` y `minio` (estos dos últimos vía la imagen envuelta en
`docker/postgres/` y `docker/minio/` — ver `docs/DEVIATIONS.md`).

### Contenido de `remitos_env` en Portainer

Crear una sola vez en **Portainer → Secrets → remitos_env**, pegando algo así (con
valores reales, nunca estos):

```env
DATABASE_URL=postgresql+asyncpg://remitos:<password>@postgres:5432/remitos
POSTGRES_USER=remitos
POSTGRES_PASSWORD=<password>          # debe coincidir con el de arriba
POSTGRES_DB=remitos

MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=<access-key>
MINIO_SECRET_KEY=<secret-key>
MINIO_ROOT_USER=<access-key>          # debe coincidir con MINIO_ACCESS_KEY
MINIO_ROOT_PASSWORD=<secret-key>      # debe coincidir con MINIO_SECRET_KEY
MINIO_BUCKET=remitos
MINIO_SECURE=false
MINIO_PRESIGNED_EXPIRES_SECONDS=900

GEMINI_API_KEY=<key>
OCR_MODEL=models/gemini-3.5-flash-lite
OCR_TIMEOUT_SECONDS=120
OCR_MAX_RETRIES=3

TARGET_IMAGE_SIZE_KB=300
IMAGE_MAX_WIDTH=2200
IMAGE_MAX_HEIGHT=2200
IMAGE_START_QUALITY=88
IMAGE_MIN_QUALITY=55

MAX_UPLOAD_MB=25
PROCESSING_BATCH_SIZE=3
MAX_CONCURRENT_OCR=3

GOOGLE_OAUTH_CLIENT_ID=<client-id>
JWT_SECRET_KEY=<openssl rand -hex 32>
JWT_EXPIRES_MINUTES=10080
ALLOWED_GOOGLE_EMAILS=
SESSION_COOKIE_NAME=remitos_session
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=lax

CORS_ORIGINS=https://<dominio-del-frontend>
```

`POSTGRES_USER/PASSWORD/DB` y `MINIO_ROOT_USER/PASSWORD` están duplicados a propósito
(una vez sueltos, para que `docker/postgres` y `docker/minio` los lean vía su wrapper de
entrypoint; y embebidos en `DATABASE_URL`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`, para que
el backend los use) — mismo patrón que ilustra `INFRASTRUCTURE.md` §10.

### Pendiente: nombre de archivo

`INFRASTRUCTURE.md` §11 exige `.env.example` (con punto). El agente no pudo
crear/renombrar ese archivo por una restricción de permisos del sandbox sobre cualquier
ruta `.env*`. El contenido ya existe y está completo en `backend/env.example` (sin
punto) — falta:

```bash
mv backend/env.example backend/.env.example
```

(`frontend/.env.example` ya tiene el nombre correcto. No hay `.env.example` en la raíz
del repo a propósito — ver más abajo.)
