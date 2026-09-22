package agent

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"io.zenmium/internal/control"
)

// ChatManager is the agent-rail conversation layer, ported from
// desktop/src/main/agent-chat-manager.ts + shared/agent-chat.ts.
// One OpenCode loop; no second chat engine. Statuses: idle / starting /
// running / stopped / interrupted / error. Parts assemble into message text;
// requestIds dedupe; approvals surface as cards.

const (
	StatusIdle        = "idle"
	StatusStarting    = "starting"
	StatusRunning     = "running"
	StatusStopped     = "stopped"
	StatusInterrupted = "interrupted"
	StatusError       = "error"
)

// ChatLimits from CHAT_LIMITS (desktop/src/shared/agent-chat.ts).
const (
	LimitAttachments   = 8
	LimitAttachmentMax = 10 << 20 // 10 MiB
	LimitText          = 100_000
	LimitPageText      = 24_000
)

// Message is one dock-visible event (normalized from OpenCode SSE).
type Message struct {
	ID        string         `json:"id"`
	ConvID    string         `json:"convId"`
	Kind      string         `json:"kind"` // message | text | activity | status | approval | remove
	Role      string         `json:"role,omitempty"`
	Text      string         `json:"text,omitempty"`
	Part      map[string]any `json:"part,omitempty"`
	Status    string         `json:"status,omitempty"`
	RequestID string         `json:"requestId,omitempty"`
	At        time.Time      `json:"at"`
}

// Conversation is one agent thread persisted (encrypted) to disk.
type Conversation struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Status     string     `json:"status"`
	Model      string     `json:"model"`
	Messages   []*Message `json:"messages"`
	RequestIDs []string   `json:"requestIds"` // dedupe ring
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	// KernelSessionID is this conversation's OpenCode session.
	KernelSessionID string `json:"kernelSessionId"`
	WorkspaceID     string `json:"workspaceId"`
}

// Approval is one pending tool-permission card.
type Approval struct {
	ID           string         `json:"id"`
	SessionID    string         `json:"sessionId"`
	PermissionID string         `json:"permissionId"`
	Tool         string         `json:"tool"`
	Title        string         `json:"title"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
}

// ChatSink receives normalized events for the dock (the relay sends them).
type ChatSink func(convID string, m *Message)

// ChatManager owns conversations and the OpenCode event fan-in.
type ChatManager struct {
	mu           sync.Mutex
	kernel       *Kernel
	sink         ChatSink
	convs        map[string]*Conversation
	pending      map[string]*Approval // permissionID -> approval
	byKernelSess map[string]string    // kernel sessionID -> convID
}

func NewChatManager(k *Kernel, sink ChatSink) *ChatManager {
	cm := &ChatManager{
		kernel: k, sink: sink,
		convs:        map[string]*Conversation{},
		pending:      map[string]*Approval{},
		byKernelSess: map[string]string{},
	}
	k.onEvent = cm.consume
	return cm
}

// NewConversation starts an agent thread bound to a workspace.
func (c *ChatManager) NewConversation(wsID string) *Conversation {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := fmt.Sprintf("conv-%d", time.Now().UnixNano())
	cv := &Conversation{ID: id, Title: "New chat", Status: StatusIdle,
		Model: c.kernel.cfg.Model, WorkspaceID: wsID, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	c.convs[id] = cv
	return cv
}

// Conversations lists threads newest-first.
func (c *ChatManager) Conversations() []*Conversation {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]*Conversation, 0, len(c.convs))
	for _, cv := range c.convs {
		out = append(out, cv)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (c *ChatManager) Get(id string) *Conversation {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.convs[id]
}

// Prompt is the dock send path: models → kernel session → prompt.
// requestId dedupes — a re-sent prompt never double-executes.
func (c *ChatManager) Prompt(ctx context.Context, convID, requestID, text string) error {
	c.mu.Lock()
	cv := c.convs[convID]
	if cv == nil {
		c.mu.Unlock()
		return fmt.Errorf("unknown conversation")
	}
	for _, r := range cv.RequestIDs {
		if r == requestID {
			c.mu.Unlock()
			return nil // deduped
		}
	}
	cv.RequestIDs = append(cv.RequestIDs, requestID)
	if len(cv.RequestIDs) > 256 {
		cv.RequestIDs = cv.RequestIDs[len(cv.RequestIDs)-256:]
	}
	if len(text) > LimitText {
		c.mu.Unlock()
		return fmt.Errorf("text exceeds %d chars", LimitText)
	}
	text = redactChatText(text)
	cv.Status = StatusStarting
	cv.UpdatedAt = time.Now().UTC()
	cv.Messages = append(cv.Messages, &Message{
		ID: fmt.Sprintf("m-%d", time.Now().UnixNano()), ConvID: convID,
		Kind: "message", Role: "user", Text: text, RequestID: requestID, At: time.Now().UTC(),
	})
	if cv.Title == "New chat" && len(text) > 0 {
		cv.Title = truncate(text, 48)
	}
	c.mu.Unlock()

	c.emit(convID, &Message{Kind: "status", Status: StatusStarting, At: time.Now().UTC()})

	sessID, err := c.kernel.EnsureSession(ctx)
	if err != nil {
		c.setStatus(convID, StatusError)
		return err
	}
	c.mu.Lock()
	cv.KernelSessionID = sessID
	c.byKernelSess[sessID] = convID
	c.mu.Unlock()

	if err := c.kernel.Prompt(ctx, sessID, text); err != nil {
		c.setStatus(convID, StatusError)
		return err
	}
	c.setStatus(convID, StatusRunning)
	return nil
}

// Abort fences the turn via kernel abort (v1 abort() → takeover-first flow
// is preserved: a human abort interrupts before any further executes land).
func (c *ChatManager) Abort(ctx context.Context, convID string) {
	c.mu.Lock()
	cv := c.convs[convID]
	sess := ""
	if cv != nil {
		sess = cv.KernelSessionID
		cv.Status = StatusInterrupted
		cv.UpdatedAt = time.Now().UTC()
	}
	c.mu.Unlock()
	if sess != "" {
		c.kernel.Abort(ctx, sess)
	}
	c.emit(convID, &Message{Kind: "status", Status: StatusInterrupted, At: time.Now().UTC()})
}

// ReplyPermission resolves an approval card in the kernel.
func (c *ChatManager) ReplyPermission(ctx context.Context, convID, approvalID, response string) error {
	c.mu.Lock()
	ap := c.pending[approvalID]
	cv := c.convs[convID]
	if ap == nil || cv == nil || cv.KernelSessionID == "" {
		c.mu.Unlock()
		return fmt.Errorf("unknown approval")
	}
	delete(c.pending, approvalID)
	kSess := cv.KernelSessionID
	c.mu.Unlock()
	c.emit(convID, &Message{Kind: "remove", ID: approvalID, At: time.Now().UTC()})
	return c.kernel.ReplyPermission(ctx, kSess, ap.PermissionID, response)
}

// consume is the kernel SSE → dock normalization port (v1 consume()).
func (c *ChatManager) consume(ev map[string]any) {
	// OpenCode event types: message.updated, message.part.updated,
	// permission.asked, session.status, session.error, session.idle.
	t, _ := ev["type"].(string)
	props, _ := ev["properties"].(map[string]any)

	convID := c.resolveConv(props)
	if convID == "" {
		return
	}
	switch t {
	case "message.part.updated":
		part, _ := props["part"].(map[string]any)
		text, _ := part["text"].(string)
		if text == "" {
			return
		}
		c.emit(convID, &Message{Kind: "text", Role: "assistant", Text: redactChatText(text), At: time.Now().UTC()})
	case "permission.asked":
		pid, _ := props["id"].(string)
		tool, _ := props["tool"].(string)
		title, _ := props["title"].(string)
		ap := &Approval{ID: "ap-" + pid, SessionID: convID, PermissionID: pid,
			Tool: tool, Title: title, Metadata: props, CreatedAt: time.Now().UTC()}
		c.mu.Lock()
		c.pending[ap.ID] = ap
		c.mu.Unlock()
		c.emit(convID, &Message{Kind: "approval", ID: ap.ID, Part: map[string]any{
			"tool": tool, "title": title,
		}, At: time.Now().UTC()})
	case "session.status":
		st, _ := props["status"].(string)
		switch st {
		case "idle":
			c.setStatus(convID, StatusIdle)
		case "busy":
			c.setStatus(convID, StatusRunning)
		}
	case "session.error":
		msg, _ := props["message"].(string)
		c.emit(convID, &Message{Kind: "status", Status: StatusError, Text: redactChatText(msg), At: time.Now().UTC()})
		c.setStatus(convID, StatusError)
	}
}

func (c *ChatManager) resolveConv(props map[string]any) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if sid, _ := props["sessionID"].(string); sid != "" {
		if id, ok := c.byKernelSess[sid]; ok {
			return id
		}
	}
	// single-conversation fallback
	if len(c.convs) == 1 {
		for id := range c.convs {
			return id
		}
	}
	return ""
}

func (c *ChatManager) setStatus(convID, st string) {
	c.mu.Lock()
	if cv := c.convs[convID]; cv != nil {
		cv.Status = st
		cv.UpdatedAt = time.Now().UTC()
	}
	c.mu.Unlock()
	c.emit(convID, &Message{Kind: "status", Status: st, At: time.Now().UTC()})
}

func (c *ChatManager) emit(convID string, m *Message) {
	m.ConvID = convID
	if m.ID == "" {
		m.ID = fmt.Sprintf("m-%d", time.Now().UnixNano())
	}
	if c.sink != nil {
		c.sink(convID, m)
	}
}

// redactChatText is the port of shared/agent-chat.ts redactChatText —
// credentials never reach the dock. Single implementation: it delegates to
// the control package's redactor so command artifacts and chat text share
// exactly one credential boundary.
func redactChatText(s string) string {
	return control.RedactControlText(s)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
