//go:build darwin

package secstore

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os/exec"
	"strings"
)

// platformLoadKey reads the data key from the login Keychain via `security`
// — the documented Keychain storage path replacing Electron safeStorage.
// The item is a generic password, service io.zenmium.internal.datakey,
// account zenmiumd. Only the value bytes leave the process.
func platformLoadKey() ([]byte, error) {
	out, err := exec.Command("/usr/bin/security",
		"find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w").Output()
	if err != nil {
		return nil, fmt.Errorf("keychain read: %w", err)
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(out)))
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("keychain item malformed")
	}
	return b, nil
}

func platformStoreKey(k []byte) error {
	// -U updates if an item races in between load and store.
	cmd := exec.Command("/usr/bin/security", "add-generic-password",
		"-U", "-s", keychainService, "-a", keychainAccount,
		"-w", base64.StdEncoding.EncodeToString(k))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("keychain write: %w: %s", err, stderr.String())
	}
	return nil
}
