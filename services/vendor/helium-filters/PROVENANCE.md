# Provenance: services/vendor/helium-filters

Vendored clone of **imputnet/helium-filters** for S005 / track T4.

| Field | Value |
| --- | --- |
| Upstream repo | https://github.com/imputnet/helium-filters |
| Pinned ref | `main` @ `95d0ac36162a` (no releases; main-branch pin) |
| Commit | `95d0ac36162abf99c5d3bca0ab1c9e7b9e059a50` |
| Commit date | 2026-08-29 |
| License | GPL-3.0 code (`LICENSE` retained); bundled third-party filter lists keep their own licenses (EasyList/EasyPrivacy, AdGuard, Peter Lowe, URLhaus, uBO; see each list's `supportURL` in release `assets/assets.json`) |
| Vendored | 2026-09-22 via `rsync -a --exclude='.git'`, byte-identical to the pinned commit |

## What it is

Build-time generator for the browser's bundled content-filtering snapshot: the uBO filter-list catalog (`assets/assets.json`), every referenced list (`assets/filters/<id>.txt`), and the scriptlet/redirect resources (`resources.json`) consumed by the adblock-rust engine. Output is a **release artifact the browser build bundles**; this is not a runtime service. Runtime fresh-list fetching flows through `svc/ubo` (`/ubo/` on the services host).

## Submodules: documented fetch, not vendored

`.gitmodules` pins two build inputs that are NOT vendored here (kept verbatim from upstream):

| Path | Upstream | Pinned commit |
| --- | --- | --- |
| `helium-services/` | https://github.com/imputnet/helium-services | `216659920667626cc60f7f8e5031ddf8cdf4827c` |
| `ublock/` | https://github.com/imputnet/uBlock | `c2c1eca76fe28adae9e8b1f655d39a4a007e486e` |

Reproduce the build tree:

```sh
cd services/vendor/helium-filters
git init && git remote add origin https://github.com/imputnet/helium-filters
git fetch --depth 1 origin 95d0ac36162abf99c5d3bca0ab1c9e7b9e059a50
git checkout FETCH_HEAD
git submodule update --init
deno task generate   # writes out/{assets,resources.json,manifest.json}
```

## Solvys-added paths

- `PROVENANCE.md` (this file); everything else in this directory is upstream.

## Where it sits in the endpoint map

- Browser-bundled snapshot: produced by `deno task generate`; the browser's filter catalog defaults to **local bundled lists with remote URLs stripped** so no outbound connection happens before services consent.
- Runtime refresh: `svc/ubo` serves `/ubo/assets.json` + `/ubo/<id>/<hash>/<hash>/<file>` proxy paths; the catalog we ship points `contentURL` at the Solvys `/ubo/` host via `UBO_PROXY_BASE_URL` at generate/serve time.
