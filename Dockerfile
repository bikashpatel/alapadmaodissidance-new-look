# Alapadma Odissi Dance Academy — website + admin panel
# Node.js server (no third-party dependencies), runs as the non-root "node" user on port 8080.
FROM node:24-alpine

LABEL org.opencontainers.image.title="alapadma-odissi-dance" \
      org.opencontainers.image.description="Alapadma Odissi Dance Academy website with admin panel" \
      org.opencontainers.image.url="https://alapadmaodissidance.com" \
      org.opencontainers.image.source="https://github.com/bikashpatel/alapadmaodissidance-new-look"

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    DATA_DIR=/data

WORKDIR /app
COPY --chown=node:node public ./public
COPY --chown=node:node server ./server
RUN mkdir -p /data && chown node:node /data

USER node
# settings, enquiries, gallery photos and the admin password live here: keep it on a volume
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/server.js"]
