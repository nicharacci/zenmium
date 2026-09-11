# Building the Zenmium engine

Zenmium's engine is Mori's ungoogled-chromium overlay. The first-party source is mirrored in this repo at `ungoogled-chromium-macos/build/src/chrome/browser/ui/mori/`. The full Chromium checkout is not committed.

## Host requirements

- macOS with Xcode at `/Applications/Xcode.app`.
- At least 100 GB free and 16 GB RAM or more.
- `depot_tools` on `PATH`.

This Mac cannot build it. Local capacity is Critical (single-digit GB free) and the Chromium checkout is tens of GB. GitHub-hosted macOS runners cannot build it either (about 14 GB disk and a 6 hour job cap). Use a MacStadium or AWS EC2 Mac host, or a self-hosted macOS runner.

## Steps

1. Fetch the ungoogled-chromium macOS source into `ungoogled-chromium-macos/build/src`. It is a local dependency and stays out of git.
2. Copy the overlay from this repo into `chrome/browser/ui/mori/`.
3. Ensure the Swift sources are listed in the `mori_ui_swift` target in `chrome/browser/ui/BUILD.gn`, exactly as upstream Mori lists them. Adding, moving, or deleting a Swift file means updating that list in the same change.
4. Build from `ungoogled-chromium-macos/build/src`:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="$repo_root/binshims:$repo_root/depot_tools:$PATH"
ninja -j 16 -l 24 -C out/Default chrome
```

Treat ninja exit code `0` as the source of truth. The Swift deployment-target and `CoreAudioTypes` warnings are expected.

5. Package and run:

```sh
/usr/bin/ditto out/Default/Mori.app "$HOME/Downloads/Zenmium.app"
open -n "$HOME/Downloads/Zenmium.app" --args --user-data-dir="$HOME/Library/Application Support/ZenmiumTestProfile" --no-first-run
```

Use `trash`, never `rm -rf`, when replacing a bundle or build directory.

## Baseline provenance

The overlay was landed from `FujiwaraChoki/mori-browser` at its `main` tip. Record the exact upstream commit in the P0 receipt before modifying any file.
