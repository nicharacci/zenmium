# zenmium-svc-cup2 image (S005/T4): Deno edge wrapping the vendored cup2
# library. The image mirrors the repo layout so the "@imput/cup2" import in
# deploy/fly/cup2/deno.json resolves identically inside and outside the image.
# Build context must be the services/ directory (see deploy/fly/cup2/fly.toml).
FROM denoland/deno:alpine-2.7.14@sha256:f36b916d304948316d9af285dba7949be6e17ed56af8b90b389295bcf4326cba

USER deno
WORKDIR /app

COPY vendor/cup2/ vendor/cup2/
COPY deploy/fly/cup2/ deploy/fly/cup2/

RUN cd deploy/fly/cup2 && deno cache main.ts check.ts

WORKDIR /app/deploy/fly/cup2
CMD ["deno", "task", "start"]
