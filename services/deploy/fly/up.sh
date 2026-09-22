#!/bin/sh
# Deploys the Solvys services lane to Fly in dependency order (S005/T4).
# Requires `fly auth` (human gate); never touches the goalpost app or its volumes.
#
# `fly deploy <workdir> -c <config>`: the positional dir is the docker build
# context; -c paths resolve RELATIVE TO that workdir, not the shell cwd.
# Usage: cd services && sh deploy/fly/up.sh
set -e

fly deploy svc/ubo               -c ../../deploy/fly/ubo/fly.toml        --remote-only
fly deploy svc/extension-proxy   -c ../../deploy/fly/ext-proxy/fly.toml  --remote-only
fly deploy svc/minipush          -c ../../deploy/fly/minipush/fly.toml   --remote-only
fly deploy .                     -c deploy/fly/cup2/fly.toml --dockerfile deploy/fly/cup2/Dockerfile --remote-only
fly deploy .                     -c deploy/fly/updates/fly.toml --dockerfile deploy/fly/updates/Dockerfile --remote-only
fly deploy .                     -c deploy/fly/edge/fly.toml --dockerfile deploy/fly/edge/Dockerfile --remote-only

echo "=== done. Health sweep: see deploy/fly/DEPLOY.md ==="
