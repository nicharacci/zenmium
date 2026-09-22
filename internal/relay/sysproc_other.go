//go:build !darwin

package relay

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// verifySelf on non-macOS platforms: signature verification is a
// platform-specific seam (Windows: Authenticode via Get-AuthenticodeSignature;
// Linux: optional). The permission check still applies everywhere.
func verifySelf(selfPath string) error {
	if selfPath == "" {
		return fmt.Errorf("self path unavailable")
	}
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

var _ = exec.Command // keep import stable across platforms
