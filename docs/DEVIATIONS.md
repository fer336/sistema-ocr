# Desviaciones registradas

Formato y proceso: `INFRASTRUCTURE.md` §14. Un agente de IA puede proponer
una desviación pero no aprobarla (INF-901) — las marcadas como
"propuesta" necesitan que un humano las pase a "aceptada".

La primera desviación que se había propuesto (INF-211, credenciales
nativas de Postgres/MinIO fuera del secret único) se resolvió envolviendo
esas dos imágenes en `docker/postgres/` y `docker/minio/` con el adaptador
shell/entrypoint del Anexo B — siguen disponibles para uso local opcional
(`docker-compose.override.yml`), ambas cargan `remitos_env` igual que
backend, sin variables de entorno planas.

## Propuesta — Postgres/MinIO no forman parte del stack desplegado

**Estado: propuesta.** Necesita que un humano la pase a "aceptada".

El entorno real de despliegue es Portainer en modo **Swarm** detrás de
Traefik, no Compose standalone -- se descubrió recién al intentar crear el
stack (Swarm rechaza `depends_on` con `condition:` y el campo raíz `name:`
de la Compose Specification, ambos ya sacados de `docker-compose.yml`).

En ese entorno, Postgres y MinIO ya existen como infraestructura remota
compartida (`91.99.162.240` y `s3.qeva.xyz` respectivamente) -- no los
levanta este proyecto. `docker-compose.yml` de producción declara
únicamente `backend` y `frontend` como servicios de Swarm; las imágenes
`docker/postgres/` y `docker/minio/` quedan solo para el flujo de
desarrollo local opcional vía `docker-compose.override.yml` (que sigue
funcionando igual, nunca se usó en producción).

## Propuesta — el worker de OCR corre embebido en el contenedor de backend

**Estado: propuesta.** Necesita que un humano la pase a "aceptada".

Por pedido explícito: el stack de Swarm debe tener solo dos servicios
(backend, frontend), sin un tercer servicio "worker" aparte. El proceso
que consume la cola de OCR (`python -m app.worker.run`) se lanza en
background dentro del mismo contenedor de `backend`, junto a uvicorn (ver
`backend/entrypoint.sh`) -- preserva el procesamiento asíncrono (barra de
progreso, reintentos, pantalla de Errores) sin agregar un servicio de
Swarm más.

Esto ata el consumo de la cola de OCR a que `backend` corra con
**exactamente 1 réplica** (ya es el caso, Perfil A). Si en el futuro hace
falta escalar `backend` a más réplicas, el worker embebido correría
duplicado por cada una -- en ese momento hay que sacarlo de nuevo a un
servicio de Swarm aparte.
