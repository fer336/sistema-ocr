# Sanitini — Remitos

OCR de remitos: backend FastAPI (`backend/`), frontend Vite + React (`frontend/`).
Postgres y MinIO son infraestructura remota ya existente, no las levanta este
proyecto (ver `docs/DEVIATIONS.md`). En producción, backend y frontend corren como
los dos únicos servicios de un stack de **Docker Swarm** (Portainer, detrás de
Traefik); el worker de OCR corre embebido dentro del contenedor de backend, no como
servicio aparte. En desarrollo local, backend y frontend corren nativos (venv /
`npm run dev`) — Postgres/MinIO locales en Docker son opcionales, solo para quien no
quiera apuntar directo a los remotos.

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

`docker compose up -d` sin filtrar servicios (backend + frontend incluidos) arranca
los contenedores tal como se buildean en CI, pero **sin puertos publicados**: en
producción el único punto de entrada es Traefik (labels en `docker-compose.yml`), que
no existe en un Compose local. Para probar esas dos imágenes localmente hay que
publicar puertos a mano (`docker compose run --rm -p 8000:8000 backend ...` o agregar
un override propio, no versionado) — no es el loop de desarrollo del día a día de
todas formas.

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
| Secret   | `GHCR_TOKEN`             | PAT clásico con `write:packages` (+ `repo` si el repo es privado) para publicar en `ghcr.io/fer336/remitos-*`. |
| Secret   | `PORTAINER_WEBHOOK_URL`  | URL del webhook del stack en Portainer.                                       |
| Variable | `PRODUCTION_HEALTH_URL`  | URL pública del healthcheck del backend, p.ej. `https://<dominio>/health`.     |
| Variable | `VITE_GOOGLE_CLIENT_ID`  | Google OAuth *client id* (público: queda embebido en el bundle del frontend). |

La configuración de runtime (contraseñas, API keys, JWT) **no** va a GitHub: vive en el
único Docker Secret `remitos_env` administrado desde Portainer (Secrets → remitos_env,
el mismo entorno Swarm donde ya está el stack) y montado en `/run/secrets/remitos_env`.
Lo consume únicamente `backend` (el worker corre embebido en ese mismo contenedor;
`frontend` no tiene config de runtime, sus `VITE_*` quedan horneados en el build).

### Contenido de `remitos_env` en Portainer

Crear una sola vez en **Portainer → Secrets → remitos_env**, pegando algo así (con
valores reales, nunca estos):

```env
# Postgres y MinIO son remotos (infraestructura ya existente, no la levanta
# este stack) -- acá van los datos de CONEXIÓN, no credenciales de bootstrap
# (no hace falta POSTGRES_USER/PASSWORD/DB ni MINIO_ROOT_USER/PASSWORD: eso
# solo lo necesita docker/postgres y docker/minio para el flujo de dev local
# opcional, que usa backend/.env, no este secret).
DATABASE_URL=postgresql+asyncpg://<user>:<password>@91.99.162.240:5432/santini

MINIO_ENDPOINT=s3.qeva.xyz
MINIO_ACCESS_KEY=<access-key>
MINIO_SECRET_KEY=<secret-key>
MINIO_BUCKET=santini-remitos
MINIO_SECURE=true
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

CORS_ORIGINS=https://santini.serviciospinamar.com
PUBLIC_BASE_URL=https://santini.serviciospinamar.com
```

`MINIO_ENDPOINT`/`DATABASE_URL` apuntan a los hosts remotos reales, no a nombres de
servicio de Docker (`postgres`/`minio`) -- ya no existen contenedores con esos nombres
en este stack. `PUBLIC_BASE_URL` es la base de los links cortos de WhatsApp
(`{PUBLIC_BASE_URL}/s/{code}`) -- sin el dominio real, esos links no funcionan para
quien los recibe fuera del sistema.

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
