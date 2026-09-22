package control

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// journalCap mirrors the v1 fingerprint-journal cap.
const journalCap = 10000

// store is the on-disk state: grants (hashed tokens only), sessions, and the
// two idempotency journals (requests by fingerprint, creations by workspace).
// Files are written 0600, atomically via rename. Plaintext pairing tokens are
// never written here — that is a protected-zone law.
type store struct {
	dir string

	Grants     map[string]*Grant     `json:"grants"`     // keyed by grant ID
	Sessions   map[string]*Session   `json:"sessions"`   // keyed by session ID
	Workspaces map[string]*Workspace `json:"workspaces"` // keyed by workspace ID

	// requests maps requestFingerprint -> recorded receipt (idempotent execute).
	Requests map[string]*Receipt `json:"requests"`
	// creations maps workspaceID -> sessionID (idempotent createSession).
	Creations map[string]string `json:"creations"`

	// pairNonces maps an extension-presented nonce to a bound workspaceID,
	// establishing the Chromium-profile -> Zenmium-workspace binding. See
	// docs/WORKSPACE-MAP.md.
	pairNonces map[string]string
}

// Workspace is one bound profile/workspace pair.
type Workspace struct {
	ID        string    `json:"id"` // "ws_<id>"
	Name      string    `json:"name"`
	ProfileID string    `json:"profileId"` // Chromium profile dir name, recorded at consent
	CreatedAt time.Time `json:"createdAt"`
	// ConsentNonce is the extension-held secret that re-binds this profile's
	// future native-messaging connections to this workspace.
	ConsentNonce string `json:"consentNonce"`
}

func openStore(dir string) (*store, error) {
	s := &store{
		dir:        dir,
		Grants:     map[string]*Grant{},
		Sessions:   map[string]*Session{},
		Workspaces: map[string]*Workspace{},
		Requests:   map[string]*Receipt{},
		Creations:  map[string]string{},
		pairNonces: map[string]string{},
	}
	b, err := os.ReadFile(s.path())
	if err != nil {
		if os.IsNotExist(err) {
			return s, os.MkdirAll(dir, 0700)
		}
		return nil, fmt.Errorf("control store unreadable: %w", err)
	}
	var disk storeDisk
	if err := json.Unmarshal(b, &disk); err != nil {
		return nil, fmt.Errorf("control store corrupt: %w", err)
	}
	s.Grants = disk.Grants
	s.Sessions = disk.Sessions
	s.Workspaces = disk.Workspaces
	s.Requests = disk.Requests
	s.Creations = disk.Creations
	s.pairNonces = disk.PairNonces
	for k := range s.Grants {
		if s.Grants[k] == nil {
			delete(s.Grants, k)
		}
	}
	return s, nil
}

type storeDisk struct {
	Grants     map[string]*Grant     `json:"grants"`
	Sessions   map[string]*Session   `json:"sessions"`
	Workspaces map[string]*Workspace `json:"workspaces"`
	Requests   map[string]*Receipt   `json:"requests"`
	Creations  map[string]string     `json:"creations"`
	PairNonces map[string]string     `json:"pairNonces"`
}

func (s *store) path() string { return filepath.Join(s.dir, "control-state.json") }

func (s *store) persist() error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	d := storeDisk{
		Grants: s.Grants, Sessions: s.Sessions, Workspaces: s.Workspaces,
		Requests: s.Requests, Creations: s.Creations, PairNonces: s.pairNonces,
	}
	// Bound the request journal exactly like v1.
	if len(d.Requests) > journalCap {
		type kv struct {
			k string
			r *Receipt
		}
		rows := make([]kv, 0, len(d.Requests))
		for k, r := range d.Requests {
			rows = append(rows, kv{k, r})
		}
		// Receipts carry no timestamp of their own in v1; evict oldest
		// lexical fingerprints deterministically (keeps cap strict).
		sort.Slice(rows, func(i, j int) bool { return rows[i].k < rows[j].k })
		keep := map[string]*Receipt{}
		for _, r := range rows[len(rows)-journalCap:] {
			keep[r.k] = r.r
		}
		d.Requests = keep
		s.Requests = keep
	}
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	tmp := s.path() + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path())
}

// newToken returns (plaintext, sha256hex). Plaintext is base64url(32 bytes),
// identical to v1; it is shown once and never stored.
func newToken() (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	plain := base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(plain))
	return plain, hex.EncodeToString(sum[:]), nil
}

// tokenMatches is a constant-time compare of a presented token to the hash.
func tokenMatches(plain, hashHex string) bool {
	sum := sha256.Sum256([]byte(plain))
	got := sum[:]
	want, err := hex.DecodeString(hashHex)
	if err != nil || len(want) != len(got) {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

func newID(prefix string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(b), nil
}
