//go:build darwin

package relay

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// verifySelf enforces the v1 signature gate on the host binary itself:
// on macOS the binary must validate under codesign --verify --strict
// --all-architectures. A signed build stamps the binary at install; dev
// builds may use a self-signed ad-hoc signature (codesign -s -).
func verifySelf(selfPath string) error {
	if selfPath == "" {
		return fmt.Errorf("self path unavailable")
	}
	cmd := exec.Command("/usr/bin/codesign", "--verify", "--strict", "--all-architectures", "-R=--anchor", "generic", selfPath)
	cmd.Env = []string{"PATH=/usr/bin:/bin"}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("host binary signature invalid: %v (%s)", err, string(out))
	}
	// Refuse group/world-writable binaries — same as v1 manifest-mode check.
	fi, err := os.Stat(selfPath)
	if err != nil {
		return err
	}
	if fi.Mode().Perm()&0022 != 0 {
		return fmt.Errorf("host binary is group/world-writable")
	}
	return nil
}

func daemonSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
