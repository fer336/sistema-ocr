# Envuelve la imagen oficial para que Postgres también arranque desde el
# secret único del proyecto (INFRASTRUCTURE.md §6/Anexo B, adaptador
# shell/entrypoint) -- la imagen oficial solo soporta *_FILE de un valor
# por variable, no un .env multi-clave. Cierra la desviación INF-211 sin
# fragmentar el secret.
FROM postgres:16.4-alpine

COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

ENTRYPOINT ["entrypoint-wrapper.sh"]
CMD ["postgres"]
