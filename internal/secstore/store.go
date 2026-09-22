package secstore

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Store is the safeStorage port (desktop/src/main/service-token.ts):
// payloads are AES-256-GCM encrypted with a random data key; the data key is
// held by the OS credential store (macOS Keychain via `security`, Windows
// DPAPI — the 1Password lane documents Keychain as the canonical replacement
// for safeStorage). Ciphertext files are 0600. No plaintext fallback.

const (
	keychainService = "io.zenmium.internal.datakey"
	keychainAccount = "zenmiumd"
)

// Store encrypts/decrypts opaque payloads under one wrapped data key.
type Store struct {
	mu  sync.Mutex
	key [32]byte
	dir string
}

// Open resolves or creates the data key for this store.
func Open(dir string) (*Store, error) {
	s := &Store{dir: dir}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	kb, err := loadDataKey()
	if err != nil {
		return nil, fmt.Errorf("data key unavailable: %w", err)
	}
	copy(s.key[:], kb)
	return s, nil
}

func keyPath(dir string) string { return filepath.Join(dir, ".datakey") }

// loadDataKey returns the 32-byte data key. On macOS it is a Keychain generic
// password; on Windows a DPAPI blob file next to the store. New keys are
// generated with crypto/rand.
func loadDataKey() ([]byte, error) {
	if k, err := platformLoadKey(); err == nil && len(k) == 32 {
		return k, nil
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	if err := platformStoreKey(k); err != nil {
		return nil, err
	}
	return k, nil
}

// Encrypt seals a payload to bytes: nonce || ciphertext.
func (s *Store) Encrypt(plain []byte) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, err := aes.NewCipher(s.key[:])
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(a)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return g.Seal(nonce, nonce, plain, nil), nil
}

// Decrypt opens a sealed payload.
func (s *Store) Decrypt(blob []byte) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, err := aes.NewCipher(s.key[:])
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(a)
	if err != nil {
		return nil, err
	}
	if len(blob) < g.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	return g.Open(nil, blob[:g.NonceSize()], blob[g.NonceSize():], nil)
}

// WriteFile seals plaintext and writes it 0600-atomic via rename.
func (s *Store) WriteFile(name string, plain []byte) error {
	blob, err := s.Encrypt(plain)
	if err != nil {
		return err
	}
	p := filepath.Join(s.dir, name)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, blob, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// ReadFile opens a sealed file.
func (s *Store) ReadFile(name string) ([]byte, error) {
	blob, err := os.ReadFile(filepath.Join(s.dir, name))
	if err != nil {
		return nil, err
	}
	return s.Decrypt(blob)
}

// Encode is a base64 convenience for text blobs.
func (s *Store) Encode(b []byte) (string, error) {
	sealed, err := s.Encrypt(b)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}
