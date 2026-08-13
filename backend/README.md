# Backend — FastAPI

Backend de digitalización de remitos. Ver `../PRD.md` para el alcance funcional completo
y `../INFRASTRUCTURE.md` para el estándar de infraestructura.

Responsabilidades:
- Endpoints `/api/v1/*` (auth, uploads, remitos, files).
- Worker asíncrono (`app/worker/`) que procesa la cola de `source_files` vía Postgres.
- OCR con Gemini (`app/services/ocr_service.py` + `extraction_service.py`).
- Almacenamiento de archivos en MinIO.

## Desarrollo local (venv, sin Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # completar con los valores reales (ver comentarios del archivo)
alembic upgrade head
uvicorn app.main:app --reload
```

Necesita Postgres y MinIO accesibles en las URLs que pongas en `.env`
(`DATABASE_URL`, `MINIO_ENDPOINT`). Si no los tenés corriendo nativos, es
más simple levantarlos sueltos con Docker:

```bash
docker compose up -d postgres minio
```

(usa `docker-compose.yml` + `docker-compose.override.yml` de la raíz solo para esos dos
servicios con estado; el backend/worker en sí corren nativos, no en contenedor, durante
el desarrollo).

`GET /health` → `{"status":"ok"}`, `GET /version` → `{"version":"dev"}` fuera de un
release real.

## Worker

```bash
python -m app.worker.run
```
