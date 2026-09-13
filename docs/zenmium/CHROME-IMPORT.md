# Chrome profile onboarding

Zenmium's first-run onboarding can discover stable Google Chrome profiles on macOS and create one isolated Zenmium Space per selected profile.

## What the flow does

- Reads Chrome's `Local State` metadata to show profile names, account domains, last-used status, bookmark availability, and extension counts.
- Uses the account domain for the new Space name, adding a numeric suffix when a name already exists.
- Converts Chrome's JSON bookmark tree into Zenmium's sanitized bookmark records. Only HTTP(S) links are accepted; scripts, credentials in URLs, and malformed links are discarded.
- Copies extension code into Zenmium's managed profile directory and loads it through the existing profile-bound `ExtensionHost`. A failed or unsupported extension is reported instead of being presented as installed.
- Records an idempotent source-profile import record so reopening onboarding does not create duplicate Spaces.
- Stores the optional service token in an Electron `safeStorage`-backed binary file. The token is never returned to the renderer or persisted in `onboarding.json`.

## Deliberate credential boundary

Zenmium does not read or copy Chrome's `Login Data`, cookies, history database, or extension storage. Chrome's password database is encrypted and is not a safe migration format for a browser to extract into another profile. The onboarding flow reports that credential data is a protected 1Password handoff instead:

1. The selected profile's 1Password extension, when present and supported by the extension host, is copied into the new Workspace profile.
2. The genuine signed 1Password browser connection remains responsible for vault unlock, fill approval, and TOTP use.
3. Zenmium's authentication broker returns status only. It never exposes passwords or one-time codes to an agent, renderer, import record, or log.

If the signed 1Password connection is not available, the import remains safe and visibly incomplete rather than falling back to raw password extraction or a CLI-based workaround.

## Supported source location

The initial flow scans:

`~/Library/Application Support/Google/Chrome`

The scan is intentionally limited to stable Google Chrome. Chrome Beta, Canary, Chromium, and managed enterprise profile locations can be added as separate, explicitly selected sources later.

