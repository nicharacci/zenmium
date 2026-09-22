# Import-path / doc append note (staged, S005/T4)

`docs/zenmium/S005-HELIUM-BASE.md` is T1-owned and does not exist on this checkout. When it lands, append a section like this (adjust import paths to wherever T1 puts the services helpers):

## Suggested section: "Solvys services lane (T4)"

The browser's phone-home endpoints are self-hosted under `services/` (vendored helium-services + cup2 + helium-filters, see `services/PROVENANCE.md`) and deployed as per-service Fly apps (`services/deploy/fly/`, operator docs in `services/RUNBOOK.md`).

Endpoint constants repointed by `patches/zenmium/services-endpoints.patch`:

| Constant / site | Upstream value | Zenmium value |
| --- | --- | --- |
| `kHeliumDefaultOrigin` (`components/helium_services/helium_services_helpers.h`) | `https://services.helium.imput.net` | `https://zenmium-services.fly.dev` |
| Settings override placeholder (`services_page.html`) | `https://services.helium.imput.net` | `https://zenmium-services.fly.dev` |
| `kUpdateBaseUrl` (`helium_services_helpers.cc`, added by `add-updater-preference.patch`) | `https://updates.helium.computer/` | `https://zenmium-updates.fly.dev/` |
| `GetUploadUrl` official-build URL (`crash_reporter_client.cc`, `crash-reporting-prefs.patch`) | `https://crash.helium.computer/crash` | `https://zenmium-svc-crash.fly.dev/crash` |
| `set_ping_enabled_domain` (`chrome_extension_downloader_factory.cc`, `proxy-extension-downloads.patch`) | `helium.computer` | `zenmium-services.fly.dev` |

Validation: after applying, `grep -rn "helium.imput.net\|imput.net\|helium.computer" browser/ platform/` must return zero unresolved production endpoints (allowed remnants: the non-routable `helium-services-are-disabled.qjz9zk` dummy origin and upstream comments/string literals).
