# Desviaciones registradas

Formato y proceso: `INFRASTRUCTURE.md` §14. Un agente de IA puede proponer
una desviación pero no aprobarla (INF-901) — las marcadas como
"propuesta" necesitan que un humano las pase a "aceptada".

Ninguna desviación activa por ahora. La única que se había propuesto
(INF-211, credenciales nativas de Postgres/MinIO fuera del secret único)
se resolvió envolviendo esas dos imágenes en `docker/postgres/` y
`docker/minio/` con el adaptador shell/entrypoint del Anexo B — ambas
cargan `remitos_env` igual que backend/worker, sin variables de entorno
planas.
