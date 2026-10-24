# Alapadma Odissi Dance Academy — static website image
# Serves the site with nginx as a non-root user on port 8080.

# 1) collect only the public website files
FROM alpine:3.20 AS site
WORKDIR /site
COPY . .
RUN rm -rf nginx

# 2) runtime
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="alapadma-odissi-dance" \
      org.opencontainers.image.description="Alapadma Odissi Dance Academy website (static, nginx)" \
      org.opencontainers.image.url="https://alapadmaodissidance.com" \
      org.opencontainers.image.source="https://github.com/bikashpatel/alapadmaodissidance-new-look"

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=site --chown=101:101 /site /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
