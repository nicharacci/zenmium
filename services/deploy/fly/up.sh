#!/bin/sh
# Deploys the Solvys services lane to Fly in dependency order (S005/T4).
# Requires `fly auth` (human gate); never touches the goalpost app or its volumes.
# Usage: cd services && sh deploy/fly/up.sh
set -e

for app in ubo ext-proxy minipush cup2 updates edge; do
    echo "=== deploying zenmium app from deploy/fly/${app}/fly.toml ==="
    fly deploy -c "deploy/fly/${app}/fly.toml" --remote-only
done

echo "=== done. Health sweep: see deploy/fly/DEPLOY.md ==="
