# Platform updater URL changes (staged notes, S005/T4)

What the browser asks for vs what `zenmium-updates` (util/sparkler) emits. The endpoint patch sets `kUpdateBaseUrl = "https://zenmium-updates.fly.dev/"`; the updater appends `kUpdatePath`:

| Platform | kUpdatePath (upstream) | URL the browser fetches | What sparkler writes |
| --- | --- | --- | --- |
| macOS arm64 | `mac/appcast-arm64.xml` | `https://zenmium-updates.fly.dev/mac/appcast-arm64.xml` | `$APPCAST_PUBLIC_DIR/appcast-arm64.xml` |
| macOS x86_64 | `mac/appcast-x86_64.xml` | `.../mac/appcast-x86_64.xml` | `$APPCAST_PUBLIC_DIR/appcast-x86_64.xml` |
| Windows | `win/appcast.xml` | `.../win/appcast.xml` | (nothing; upstream never emitted a win feed) |

`deploy/fly/updates/serve.ts` serves files by basename, so `/mac/appcast-arm64.xml` resolves to `/srv/appcasts/appcast-arm64.xml` unchanged. Two consequences to close when T3's releases exist:

- `/win/appcast.xml` 404s today: sparkler only emits per-arch macOS appcasts. Either extend sparkler (Zenmium-side wrapper, not an upstream edit) to emit `appcast.xml` for the win path, or have serve.ts alias `/win/appcast.xml` to the x86_64 appcast (recorded here as an open decision; win lane timing belongs to the sprint).
- `SERVE_ASSETS_LOCALLY=yes` makes sparkler emit relative `assets/<name>` enclosure URLs; serve.ts already handles `/assets/<name>` from `ASSETS_DIR`. Leave it off to keep GitHub release URLs in the feed (browser still only phones Solvys for the appcast itself; binaries download from GitHub either way).

Signing: appcast `sparkle:edSignature` uses `ED_PRIVATE_KEY` (Ed25519, secret via Vault). The matching public key is baked into the browser by the updater work (T2/T3), not this patch. That is a different signature scheme from cup2 (`X-Cup-Server-Proof`, ECDSA P-256) which covers Omaha-style component/extension update responses on `zenmium-svc-cup2`.
