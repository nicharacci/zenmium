// Command zenmium-control-host is the native-messaging host Chromium spawns
// per connectNative() call. It relays stdio (4-byte LE framed JSON, 1 MiB
// cap, UTF-8 fatal) to the daemon's per-user unix socket. It holds no state;
// the daemon owns all control state. Fail-closed: signature/permission check
// on self, daemon bootstrap with scrubbed env, then pump.
//
// Chromium itself enforces the manifest allowlist (allowed_origins pins our
// component extension ID) before this process starts — that replaces the
// Electron broker's manual sender checks with the platform's own gate.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"io.zenmium/internal/relay"
)

func defaultDaemonBin() string {
	// The daemon ships beside the host inside the app bundle:
	//   Zenmium.app/Contents/Helpers/zenmiumd         (macOS)
	//   <install>\zenmiumd.exe                        (Windows)
	// Overridable for dev via -daemon.
	self, err := os.Executable()
	if err != nil {
		return ""
	}
	dir := dirOf(self)
	if runtime.GOOS == "windows" {
		return dir + `\zenmiumd.exe`
	}
	return dir + "/zenmiumd"
}

func dirOf(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' || p[i] == '\\' {
			return p[:i]
		}
	}
	return "."
}

func main() {
	daemon := flag.String("daemon", defaultDaemonBin(), "path to zenmiumd")
	self := flag.String("self", "", "path to this binary for signature check")
	flag.Parse()

	selfPath := *self
	if selfPath == "" {
		selfPath, _ = os.Executable()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := relay.RunHost(ctx, os.Stdin, os.Stdout, *daemon, selfPath); err != nil {
		fmt.Fprintf(os.Stderr, "zenmium-control-host: %v\n", err)
		os.Exit(1)
	}
}
