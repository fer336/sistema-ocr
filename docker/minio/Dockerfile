# Ídem docker/postgres/Dockerfile: mismo wrapper, para que MinIO también
# arranque desde el secret único del proyecto en vez de variables de
# entorno planas.
FROM minio/minio:RELEASE.2024-10-13T13-34-11Z

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

ENTRYPOINT ["entrypoint-wrapper.sh"]
CMD ["minio", "server", "/data", "--console-address", ":9001"]
