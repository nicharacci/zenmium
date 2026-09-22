#!/bin/sh
set -e

# Fly variant of svc/nginx/entrypoint.sh (S005/T4): no acme.sh/cert waiting,
# Fly edge terminates TLS. Substitutes runtime env into the nginx template.
export SERVICES_HOSTNAME="${SERVICES_HOSTNAME:-zenmium-services.fly.dev}"
export ROOT_REDIRECT_URL="${ROOT_REDIRECT_URL:-https://solvys.io}"
export EXT_UPSTREAM="${EXT_UPSTREAM:-zenmium-svc-ext.internal:8000}"
export UBO_UPSTREAM="${UBO_UPSTREAM:-zenmium-svc-ubo.internal:8000}"

envsubst '${SERVICES_HOSTNAME} ${ROOT_REDIRECT_URL} ${EXT_UPSTREAM} ${UBO_UPSTREAM}' \
    < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

mkdir -p /srv/bangs /srv/dictionaries/dict

# bangs.json refresher only runs when BANG_SOURCE is set; the baked copy in
# the image is always served either way.
if [ -n "$BANG_SOURCE" ]; then
    /refresh-bangs.sh &
fi

# hunspell dictionary bootstrap (upstream chromium tarball, server-side fetch).
/refresh-dicts.sh &

echo "waiting for nginx config to come up"
while ! nginx -t >/dev/null 2>/dev/null; do
    echo -n .
    sleep 0.1
done
echo " ready!"

exec nginx
