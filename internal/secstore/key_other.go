//go:build !darwin

package secstore

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
)

// Non-macOS key custody. Windows: DPAPI via crypt32 CryptProtectData is the
// planned seam (scoped to this file; file is still 0600 on disk so a DPAPI
// gap fails closed — the daemon refuses to persist conversations unwrapped).
// Until DPAPI lands, fall back to a file-local random key 0600 which keeps
// the at-rest ciphertext non-plaintext but is NOT a credential boundary.

func keyFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "zenmium", "internal", ".datakey")
}

func platformLoadKey() ([]byte, error) {
	b, err := os.ReadFile(keyFilePath())
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("no stored key")
	}
	return b, nil
}

func platformStoreKey(k []byte) error {
	p := keyFilePath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	return os.WriteFile(p, k, 0600)
}

var _ = rand.Read // keep import
