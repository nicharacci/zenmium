# Chrome profile onboarding

Zenmium's first-run onboarding can discover stable Google Chrome profiles on macOS and create one isolated Zenmium Space per selected profile.

## What the flow does

- Reads Chrome's `Local State` metadata to show profile names, account domains, last-used status, bookmark availability, and extension counts. The first-run checklist preselects every profile that has not already been imported.
- Uses the account domain for the new Space name, adding a numeric suffix when a name already exists.
- Converts Chrome's JSON bookmark tree into Zenmium's sanitized bookmark records. Only HTTP(S) links are accepted; scripts, credentials in URLs, and malformed links are discarded.
- Copies extension code into Zenmium's managed profile directory and loads it through the existing profile-bound `ExtensionHost`. A failed or unsupported extension is reported instead of being presented as installed.
- Imports Chrome cookies into the destination Workspace's isolated Electron session when Chrome exposes the legacy macOS Keychain decrypt key. The cookie database is never copied wholesale and source cookies are never sent to the renderer.
- Decrypts Chrome's legacy macOS v10 saved-password records in the main process and writes them into a safeStorage-encrypted Workspace vault. Password values are never returned to the renderer, agent, import record, or logs.
- Records an idempotent source-profile import record so reopening onboarding does not create duplicate Spaces.
- Stores the optional service token in an Electron `safeStorage`-backed binary file. The token is never returned to the renderer or persisted in `onboarding.json`.

## Credential boundary and one-click behavior

The onboarding and Settings checklist use one import command for bookmarks, supported extensions, cookies, and saved passwords. Credential migration is still deliberately constrained:

1. Zenmium asks macOS for Chrome's `Chrome Safe Storage` item in the main process. The key is held only long enough to decrypt the selected source rows and is zeroed afterward.
2. Cookies are inserted through the destination Workspace `Session.cookies` API, preserving profile isolation. They are not copied into a shared or default session.
3. Passwords are stored in a per-Workspace `safeStorage`-encrypted vault. They are not exposed to an agent, renderer, import record, or log. The vault is separate from the browser-control authentication boundary; 1Password remains the preferred provider for agent authentication and TOTP.
4. Newer Chrome app-bound credential records (including `v20` values) are reported as `protected-by-chrome` rather than guessed at or silently marked imported. The user can retry from Settings after Chrome/1Password provides an approved handoff.

Chrome history and extension storage are intentionally not copied. Extension code is copied and loaded through the profile-bound host, while extension-specific authenticated state remains protected by each extension's own storage and provider rules.

## Supported source location

The initial flow scans:

`~/Library/Application Support/Google/Chrome`

The scan is intentionally limited to stable Google Chrome. Chrome Beta, Canary, Chromium, and managed enterprise profile locations can be added as separate, explicitly selected sources later.
