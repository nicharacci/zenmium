# zenmium-services edge image (S005/T4).
# Fly variant of svc/nginx/Dockerfile: same base, but the config is a static
# template envsubst'd at boot (no jinja/SERVICES_HOSTNAME build arg), TLS is
# terminated at the Fly edge (no certs/acme.sh), and bangs/dictionaries live
# under /srv instead of /dev/shm.
# Build context must be the services/ directory (see deploy/fly/edge/fly.toml).
FROM nginx:1.30.1-alpine3.23-slim@sha256:a5688ea5d06cccc298505dddac20e8e28bfe7de67b015a374006593bc23700b1

RUN apk add --no-cache gettext curl

COPY deploy/fly/edge/nginx.conf.template /etc/nginx/nginx.conf.template
COPY deploy/fly/edge/entrypoint.sh /entrypoint.sh
COPY deploy/fly/edge/refresh-bangs.sh /refresh-bangs.sh
COPY deploy/fly/edge/refresh-dicts.sh /refresh-dicts.sh

# Baked fallbacks so /bangs.json works even with no refresh configured.
COPY svc/bangs/bangs.json /srv/bangs/bangs.json
RUN gzip -k9 /srv/bangs/bangs.json \
    && mkdir -p /srv/dictionaries/dict \
    && chmod +x /entrypoint.sh /refresh-bangs.sh /refresh-dicts.sh

HEALTHCHECK --start-period=5s --interval=30s --timeout=5s \
    CMD curl -f -o /dev/null http://localhost:8080/connectivitycheck

ENTRYPOINT ["/entrypoint.sh"]
