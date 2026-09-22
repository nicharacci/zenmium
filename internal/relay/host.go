package relay

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// DaemonSocketPath is the per-user control socket. macOS: ~/Library/
// Application Support/Zenmium/internal/control.sock. Windows (planned):
// \\.\pipe\zenmium-control-<userSID>.
func DaemonSocketPath() string {
	if runtime.GOOS == "windows" {
		return `\\.\pipe\zenmium-control`
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "Zenmium", "internal", "control.sock")
}

// scrubbedEnv is the v1 host environment allowlist, verbatim. The host and
// anything it spawns inherit nothing else.
func scrubbedEnv() []string {
	keep := []string{"PATH", "HOME", "TMPDIR", "LANG", "USER", "LOGNAME", "__CF_USER_TEXT_ENCODING", "SYSTEMROOT", "APPDATA", "LOCALAPPDATA"}
	out := make([]string, 0, len(keep))
	for _, k := range keep {
		if v, ok := os.LookupEnv(k); ok {
			out = append(out, k+"="+v)
		}
	}
	return out
}

// ensureDaemon connects to the daemon socket; if unreachable it spawns the
// daemon binary with a scrubbed environment and waits for the socket.
// Fail-closed: any error kills the host.
func ensureDaemon(ctx context.Context, daemonBin string) (net.Conn, error) {
	sock := DaemonSocketPath()
	deadline := time.Now().Add(15 * time.Second)
	for {
		c, err := net.DialTimeout("unix", sock, 500*time.Millisecond)
		if err == nil {
			return c, nil
		}
		if daemonBin == "" {
			return nil, fmt.Errorf("daemon socket unavailable and no daemon binary configured")
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out waiting for daemon socket")
		}
		if _, err := os.Stat(sock); os.IsNotExist(err) {
			spawnDaemon(daemonBin)
			// give it a beat before first dial
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
			continue
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

var spawned bool

func spawnDaemon(daemonBin string) {
	if spawned {
		return
	}
	spawned = true
	cmd := exec.Command(daemonBin)
	cmd.Env = scrubbedEnv()
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.SysProcAttr = daemonSysProcAttr()
	_ = cmd.Start()
}

// RunHost is the zenmium-control-host main loop: verify sender (done by
// Chromium before we run — our manifest allowlist pins the extension ID),
// ensure the daemon, then pump stdin→socket and socket→stdout.
//
// Self-verification ported from v1: on macOS the host refuses to run unless
// its own binary is signed (codesign --verify --strict --all-architectures).
// The manifest's allowed_origins already pins the caller extension; this adds
// the binary-integrity check the Electron broker did itself.
func RunHost(ctx context.Context, stdin io.Reader, stdout io.Writer, daemonBin string, selfPath string) error {
	if err := verifySelf(selfPath); err != nil {
		return err
	}
	conn, err := ensureDaemon(ctx, daemonBin)
	if err != nil {
		return err
	}
	defer conn.Close()

	errCh := make(chan error, 2)
	go func() {
		for {
			payload, err := ReadFrame(stdin)
			if err != nil {
				errCh <- err
				return
			}
			if err := WriteFrame(conn, payload); err != nil {
				errCh <- err
				return
			}
		}
	}()
	go func() {
		for {
			payload, err := ReadFrame(conn)
			if err != nil {
				errCh <- err
				return
			}
			if err := WriteFrame(stdout, payload); err != nil {
				errCh <- err
				return
			}
		}
	}()
	return <-errCh
}
