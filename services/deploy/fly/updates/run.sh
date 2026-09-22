#!/bin/sh
# One machine runs both halves of the update feed: util/sparkler regenerates
# appcast-<arch>.xml under APPCAST_PUBLIC_DIR hourly, and serve.ts serves that
# directory. Fly [processes] groups land on separate machines with separate
# filesystems, so the two must share one process to share /srv/appcasts.
deno run -A main.ts &
exec deno run -A serve.ts
