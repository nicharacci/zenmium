package control

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// BROWSER_CONTROL_VERSION, ported from desktop/src/shared/browser-control.ts.
const BrowserControlVersion = 1

// Capability is a grant-scope capability, identical to the v1 set.
type Capability string

const (
	CapObserve      Capability = "observe"
	CapNavigate     Capability = "navigate"
	CapInteract     Capability = "interact"
	CapTabs         Capability = "tabs"
	CapDownloads    Capability = "downloads"
	CapAuthenticate Capability = "authenticate"
	CapCDP          Capability = "cdp"
)

var allCapabilities = map[Capability]bool{
	CapObserve: true, CapNavigate: true, CapInteract: true, CapTabs: true,
	CapDownloads: true, CapAuthenticate: true, CapCDP: true,
}

// MaxGrantTTL is the v1 grant ceiling: 8 hours.
const MaxGrantTTL = 8 * time.Hour

// Command is a v1 control action name. Closed set, 14 members.
type Command string

const (
	CmdObserve       Command = "observe"
	CmdSessionStatus Command = "session.status"
	CmdNavigate      Command = "navigate"
	CmdClick         Command = "click"
	CmdFill          Command = "fill"
	CmdPress         Command = "press"
	CmdScroll        Command = "scroll"
	CmdTabClose      Command = "tab.close"
	CmdTabCreate     Command = "tab.create"
	CmdTabAdopt      Command = "tab.adopt"
	CmdDownload      Command = "download"
	CmdAuthenticate  Command = "authenticate"
	CmdCDP           Command = "cdp"
	CmdCDPTarget     Command = "cdp.target"
)

// commandCapability maps each command to the single capability that gates it,
// matching the v1 dispatch table.
func commandCapability(c Command) (Capability, bool) {
	switch c {
	case CmdObserve, CmdSessionStatus:
		return CapObserve, true
	case CmdNavigate:
		return CapNavigate, true
	case CmdClick, CmdFill, CmdPress, CmdScroll:
		return CapInteract, true
	case CmdTabClose, CmdTabCreate, CmdTabAdopt:
		return CapTabs, true
	case CmdDownload:
		return CapDownloads, true
	case CmdAuthenticate:
		return CapAuthenticate, true
	case CmdCDP, CmdCDPTarget:
		return CapCDP, true
	}
	return "", false
}

// Controller is who currently drives a session ("agent" or "human").
type Controller string

const (
	ControllerAgent Controller = "agent"
	ControllerHuman Controller = "human"
)

// SessionState mirrors the v1 session lifecycle values.
type SessionState string

const (
	SessionActive      SessionState = "active"
	SessionInterrupted SessionState = "interrupted"
	SessionEnded       SessionState = "ended"
)

// Grant is the stored form of a pairing grant. The bearer token itself is
// never stored; TokenHash is SHA-256(token) hex.
type Grant struct {
	ID           string       `json:"id"`
	Label        string       `json:"label"`
	TokenHash    string       `json:"tokenHash"`
	Capabilities []Capability `json:"capabilities"`
	WorkspaceIDs []string     `json:"workspaceIds"` // empty = all bound workspaces
	CreatedAt    time.Time    `json:"createdAt"`
	ExpiresAt    time.Time    `json:"expiresAt"`
	RevokedAt    *time.Time   `json:"revokedAt,omitempty"`
	LastUsedAt   *time.Time   `json:"lastUsedAt,omitempty"`
}

func (g *Grant) live(now time.Time) bool {
	return g.RevokedAt == nil && now.Before(g.ExpiresAt)
}

// Session is the stored control session. ID has the "control_" prefix.
type Session struct {
	ID               string       `json:"id"`
	GrantID          string       `json:"grantId"`
	WorkspaceID      string       `json:"workspaceId"`
	TabID            *int64       `json:"tabId,omitempty"` // one-tab policy: nil until adopted/created
	Controller       Controller   `json:"controller"`
	State            SessionState `json:"state"`
	Revision         int64        `json:"revision"`
	Fence            int64        `json:"fence"`
	NeedsObservation bool         `json:"needsObservation"`
	LastDocumentID   string       `json:"lastDocumentId,omitempty"`
	CreatedAt        time.Time    `json:"createdAt"`
	UpdatedAt        time.Time    `json:"updatedAt"`
}

// Event is one entry in a session's event journal.
type Event struct {
	Seq       int64           `json:"seq"`
	SessionID string          `json:"sessionId"`
	Kind      string          `json:"kind"`
	At        time.Time       `json:"at"`
	Data      json.RawMessage `json:"data,omitempty"`
}

// ExecuteRequest is one v1 `execute` call.
type ExecuteRequest struct {
	SessionID  string          `json:"sessionId"`
	RequestID  string          `json:"requestId"`
	Command    Command         `json:"command"`
	Args       json.RawMessage `json:"args,omitempty"`
	Revision   *int64          `json:"revision,omitempty"`
	DocumentID string          `json:"documentId,omitempty"`
}

// Receipt is the v1 execution receipt returned to products.
type Receipt struct {
	OK         bool            `json:"ok"`
	SessionID  string          `json:"sessionId"`
	RequestID  string          `json:"requestId"`
	Revision   int64           `json:"revision"`
	Controller Controller      `json:"controller"`
	Result     json.RawMessage `json:"result,omitempty"`
	Err        *Error          `json:"error,omitempty"`
	Replayed   bool            `json:"replayed,omitempty"`
	Uncertain  bool            `json:"uncertain,omitempty"`
}

// SessionStatus is the public session view (v1 `status`/`session.status`).
type SessionStatus struct {
	ID               string       `json:"id"`
	WorkspaceID      string       `json:"workspaceId"`
	TabID            *int64       `json:"tabId,omitempty"`
	URL              string       `json:"url,omitempty"` // safeControlUrl form
	Controller       Controller   `json:"controller"`
	State            SessionState `json:"state"`
	Revision         int64        `json:"revision"`
	NeedsObservation bool         `json:"needsObservation"`
}

// PairRequest is a pending first-run pairing request awaiting in-browser consent.
type PairRequest struct {
	ID           string       `json:"id"`
	Label        string       `json:"label"`
	Capabilities []Capability `json:"capabilities"`
	WorkspaceIDs []string     `json:"workspaceIds,omitempty"`
	TTLSeconds   int64        `json:"ttlSeconds"`
	CreatedAt    time.Time    `json:"createdAt"`
	ExpiresAt    time.Time    `json:"expiresAt"` // request-level expiry for the consent window
	Origin       string       `json:"origin"`    // "cli" | "mcp" — recorded for the consent surface
}

// PairResult is returned once consent completes. Token is shown exactly once.
type PairResult struct {
	GrantID string `json:"grantId"`
	Token   string `json:"token"` // base64url randomBytes(32); never persisted
}

// ValidateCapabilities enforces the v1 closed capability set and TTL ceiling.
func ValidateCapabilities(caps []Capability) *Error {
	if len(caps) == 0 {
		return newError(CodeInvalidRequest, "capabilities must be non-empty")
	}
	for _, c := range caps {
		if !allCapabilities[c] {
			return newError(CodeInvalidRequest, fmt.Sprintf("unknown capability %q", c))
		}
	}
	return nil
}

// ValidatePairRequest mirrors the v1 pair-request checks.
func ValidatePairRequest(p *PairRequest) *Error {
	if strings.TrimSpace(p.Label) == "" {
		return newError(CodeInvalidRequest, "label is required")
	}
	if err := ValidateCapabilities(p.Capabilities); err != nil {
		return err
	}
	if p.TTLSeconds <= 0 || time.Duration(p.TTLSeconds)*time.Second > MaxGrantTTL {
		return newError(CodeInvalidRequest, fmt.Sprintf("ttlSeconds must be in (0, %d]", int64(MaxGrantTTL/time.Second)))
	}
	return nil
}

// ParseExecuteRequest validates the wire form of an execute call.
func ParseExecuteRequest(raw json.RawMessage) (*ExecuteRequest, *Error) {
	var req ExecuteRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, newError(CodeInvalidJSON, err.Error())
	}
	if req.SessionID == "" || !strings.HasPrefix(req.SessionID, "control_") {
		return nil, newError(CodeInvalidRequest, "sessionId must be a control_* id")
	}
	if req.RequestID == "" {
		return nil, newError(CodeInvalidRequest, "requestId is required")
	}
	if _, ok := commandCapability(req.Command); !ok {
		return nil, newError(CodeInvalidCommand, fmt.Sprintf("unknown command %q", req.Command))
	}
	return &req, nil
}
