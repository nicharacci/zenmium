# Chrome extensions in Zenmium

Zenmium keeps extension state inside the active Workspace profile. The
Extensions panel supports two native paths:

1. **Install from Chrome Web Store** accepts a Chrome Web Store detail URL or
   a 32-character extension id. Zenmium downloads the package from Google's
   public update endpoint, verifies the CRX identity and signature, unpacks it
   into the Workspace-managed extension directory, and loads it through the
   persistent Electron session.
2. **Load unpacked** accepts a local extension directory. This remains the
   most predictable path for development and for extensions whose package
   features are outside Electron's supported surface.

The pinned NeverDecaf Chromium Web Store helper is bundled under
`desktop/resources/chromium-web-store/` and auto-loaded into each Workspace
profile. It restores Web Store install affordances on compatible Web Store
pages. The helper is unmodified and its upstream MIT notice is included beside
the package.

The Chromium-only flag
`chrome://flags/#extension-mime-request-handling` is not an Electron setting,
so Zenmium does not expose a fake flags page or claim that it changes Electron's
extension loader. The Extensions panel is the supported install surface.

Electron does not provide blanket Chrome compatibility. Zenmium currently
supports persistent unpacked loading, extension actions/popups when the
manifest declares them, content scripts within Electron's runtime support,
enable/disable, removal, and restart restoration. Native messaging, some
Manifest V3 service-worker behavior, privileged Chrome APIs, and extensions
that require Chrome-specific installation/update services remain compatibility
dependent. Failed loads are surfaced rather than reported as installed.
