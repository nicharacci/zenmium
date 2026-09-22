# zenmium-updates image (S005/T4): same deno base as upstream, containing both
# util/sparkler (the `worker` process: hourly appcast regeneration) and
# deploy/fly/updates/serve.ts (the `web` process: static file server).
# Build context must be the services/ directory (see deploy/fly/updates/fly.toml).
FROM denoland/deno:alpine-2.7.14@sha256:f36b916d304948316d9af285dba7949be6e17ed56af8b90b389295bcf4326cba

RUN mkdir -p /srv/appcasts /srv/assets && chown -R deno:deno /srv

USER deno
WORKDIR /app

COPY util/sparkler/ ./
COPY deploy/fly/updates/serve.ts ./serve.ts
COPY deploy/fly/updates/run.sh ./run.sh
RUN deno cache main.ts serve.ts

# fly.toml runs `sh /app/run.sh`; this CMD is only a fallback.
CMD ["sh", "/app/run.sh"]
