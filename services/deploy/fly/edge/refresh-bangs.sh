#!/bin/sh
# Fly variant of svc/nginx/refresh-bangs.sh (S005/T4): parameterized source
# (upstream hardcoded the imputnet repo raw URL) and persistent output dir.
# Only run by entrypoint.sh when BANG_SOURCE is set; image always has a baked
# bangs.json as fallback.

BANG_SOURCE="${BANG_SOURCE:-}"
TMPFILE_PATH="/srv/bangs/temp.txt"
OUTFILE_PATH="/srv/bangs/bangs.json"

mkdir -p "$(dirname "$OUTFILE_PATH")"
[ -f "$OUTFILE_PATH" ] || touch "$OUTFILE_PATH"

while :; do
    curl --fail -m 5 \
         -o "$TMPFILE_PATH" \
         -z "$OUTFILE_PATH" \
         "$BANG_SOURCE" || {
            sleep 3600; continue
         }

    cmp --silent "$TMPFILE_PATH" "$OUTFILE_PATH" && {
        sleep 3600; continue
    }

    gzip -k9 "$TMPFILE_PATH" \
    && mv "$TMPFILE_PATH" "$OUTFILE_PATH" \
    && mv "$TMPFILE_PATH.gz" "$OUTFILE_PATH.gz"

    sleep 3600
done
