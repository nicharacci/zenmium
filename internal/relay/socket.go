package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"io.zenmium/internal/control"
)

// Server is the daemon-side end of the relay. Each accepted socket
// connection is one native-messaging host, which is one Chromium profile's
// extension instance. After hello the connection binds to a workspace and
// becomes that workspace's control.Driver.
type Server struct {
	svc      *control.Service
	ln       net.Listener
	mu       sync.Mutex
	conns    map[string]*conn // keyed by workspaceID
	reqSeq   atomic.Int64
	pairMu   sync.Mutex
	pairSubs []chan *control.PairRequest

	// ChatHandler receives dock-originated messages; set by the agent rail.
	ChatHandler func(ws *control.Workspace, env *Envelope)
	// AuthHandler receives authentication-broker responses.
	AuthHandler func(ws *control.Workspace, env *Envelope)

	maxConns int // v1: 16 per profile; daemon applies it per workspace
}

type conn struct {
	ws      *control.Workspace
	nc      net.Conn
	writeMu sync.Mutex
	pending map[string]chan *Envelope
	closed  atomic.Bool
}

func NewServer(svc *control.Service) *Server {
	return &Server{svc: svc, conns: map[string]*conn{}, maxConns: 16}
}

// Listen binds the per-user socket, removing any stale file. The socket dir
// is 0700 so only this user's processes can connect — the v1 loopback+token
// boundary lands here as filesystem ownership.
func (s *Server) Listen(sockPath string) error {
	if err := os.MkdirAll(filepath.Dir(sockPath), 0700); err != nil {
		return err
	}
	_ = os.Remove(sockPath)
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		return err
	}
	if err := os.Chmod(sockPath, 0600); err != nil {
		ln.Close()
		return err
	}
	s.ln = ln
	return nil
}

// Serve accepts until the listener closes.
func (s *Server) Serve(ctx context.Context) error {
	for {
		nc, err := s.ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
				return err
			}
		}
		go s.handle(ctx, nc)
	}
}

func (s *Server) Close() error {
	if s.ln == nil {
		return nil
	}
	return s.ln.Close()
}

func (s *Server) handle(ctx context.Context, nc net.Conn) {
	defer nc.Close()
	// First frame must be hello within a short window — fail closed.
	_ = nc.SetReadDeadline(time.Now().Add(10 * time.Second))
	payload, err := ReadFrame(nc)
	if err != nil {
		return
	}
	_ = nc.SetReadDeadline(time.Time{})
	var env Envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return
	}
	if env.Kind == KindCtlHello {
		s.handleCtl(ctx, nc)
		return
	}
	if env.Kind != KindHello || env.Nonce == "" {
		return
	}
	ws, err := s.svc.BindNonce(env.Nonce, env.ProfileID, env.ProfileName)
	if err != nil || ws == nil {
		return
	}

	c := &conn{ws: ws, nc: nc, pending: map[string]chan *Envelope{}}
	if !s.register(ws.ID, c) {
		_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindError, Code: string(control.CodeRequestLimit), Message: "connection cap reached"}))
		return
	}
	defer s.unregister(ws.ID, c)

	_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindBound, WorkspaceID: ws.ID}))

	for {
		payload, err := ReadFrame(nc)
		if err != nil {
			return
		}
		var m Envelope
		if err := json.Unmarshal(payload, &m); err != nil {
			continue
		}
		s.dispatch(ws, c, &m)
	}
}

func (s *Server) register(wsID string, c *conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for _, x := range s.conns {
		if x.ws.ID == wsID {
			count++
		}
	}
	if count >= s.maxConns {
		return false
	}
	// latest connection wins the executor slot for the workspace; v1 had one
	// WebContents per workspace — keep the same one-executor invariant.
	if old := s.conns[wsID]; old != nil {
		old.closed.Store(true)
		_ = old.nc.Close()
	}
	s.conns[wsID] = c
	return true
}

func (s *Server) unregister(wsID string, c *conn) {
	s.mu.Lock()
	if cur := s.conns[wsID]; cur == c {
		delete(s.conns, wsID)
	}
	s.mu.Unlock()
	c.closed.Store(true)
	c.writeMu.Lock()
	for id, ch := range c.pending {
		ch <- &Envelope{Kind: KindExecResult, ID: id, Code: string(control.CodeControlInterrupted), Message: "executor disconnected", Uncertain: true}
		delete(c.pending, id)
	}
	c.writeMu.Unlock()
}

// handleCtl serves a zenmiumctl peer: local-user operations (pair, grants,
// revoke, status). The socket file mode (0600, per-user dir) is the entire
// auth boundary for ctl peers — no token needed, matching v1 where the
// browser-owned IPC surface was equally ambient.
func (s *Server) handleCtl(ctx context.Context, nc net.Conn) {
	defer nc.Close()
	_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindCtlBound}))
	for {
		payload, err := ReadFrame(nc)
		if err != nil {
			return
		}
		var m Envelope
		if err := json.Unmarshal(payload, &m); err != nil {
			continue
		}
		switch m.Kind {
		case KindCtlPair:
			s.ctlPair(nc, &m)
		case KindCtlOp:
			s.ctlOp(nc, &m)
		}
	}
}

func (s *Server) ctlPair(nc net.Conn, m *Envelope) {
	var p struct {
		Label        string   `json:"label"`
		Capabilities []string `json:"capabilities"`
		TTLSeconds   int64    `json:"ttlSeconds"`
		WorkspaceIDs []string `json:"workspaceIds"`
	}
	if err := json.Unmarshal(m.Payload, &p); err != nil {
		_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindError, Message: "bad pair request"}))
		return
	}
	caps := make([]control.Capability, len(p.Capabilities))
	for i, c := range p.Capabilities {
		caps[i] = control.Capability(c)
	}
	wait, deny, perr := s.svc.RequestPair(control.PairRequest{
		Label: p.Label, Capabilities: caps, TTLSeconds: p.TTLSeconds,
		WorkspaceIDs: p.WorkspaceIDs, Origin: "cli",
	})
	if perr != nil {
		_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindError, Code: string(perr.Code), Message: perr.Message}))
		return
	}
	select {
	case res := <-wait:
		b, _ := json.Marshal(res)
		_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindCtlPairResult, Payload: b}))
	case err := <-deny:
		_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindError, Message: err.Error()}))
	case <-time.After(5*time.Minute + 10*time.Second):
	}
}

func (s *Server) ctlOp(nc net.Conn, m *Envelope) {
	var p struct {
		Op      string `json:"op"`
		GrantID string `json:"grantId"`
	}
	_ = json.Unmarshal(m.Payload, &p)
	var out any
	var e *control.Error
	switch p.Op {
	case "grants":
		out = s.svc.Grants()
	case "status":
		out = map[string]any{
			"workspaces": s.svc.Workspaces(),
			"version":    control.BrowserControlVersion,
		}
	case "revoke":
		e = s.svc.Revoke(p.GrantID)
		out = map[string]bool{"revoked": e == nil}
	default:
		e = &control.Error{Code: control.CodeInvalidRequest, Message: "unknown op"}
	}
	if e != nil {
		_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindError, Code: string(e.Code), Message: e.Message}))
		return
	}
	b, _ := json.Marshal(out)
	_ = WriteFrame(nc, mustJSON(&Envelope{Kind: KindCtlOpResult, Payload: b}))
}

func (s *Server) dispatch(ws *control.Workspace, c *conn, m *Envelope) {
	switch m.Kind {
	case KindExecResult:
		c.writeMu.Lock()
		if ch, ok := c.pending[m.ID]; ok {
			ch <- m
			delete(c.pending, m.ID)
		}
		c.writeMu.Unlock()
	case KindWatched:
		// Navigation/close watcher from the extension — the v1 watch() port.
		if m.SessionID != "" {
			s.svc.NoteNavigation(m.SessionID, m.URL)
		}
	case KindPairRespond:
		s.svc.ConsentPair(m.PairID, m.Approve)
	case KindChatSend, KindChatAbort, KindChatApprove, KindDockState:
		if s.ChatHandler != nil {
			s.ChatHandler(ws, m)
		}
	case KindHello:
		// duplicate hello ignored
	default:
		if s.AuthHandler != nil {
			s.AuthHandler(ws, m)
		}
	}
}

// --- control.Driver implementation ----------------------------------------

// Bound reports whether a workspace has a live executor.
func (s *Server) Bound(wsID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.conns[wsID]
	return c != nil && !c.closed.Load()
}

// Observe implements control.Driver — routes an observe through the executor.
func (s *Server) Observe(ctx context.Context, ws *control.Workspace, sess *control.Session) (json.RawMessage, error) {
	return s.Perform(ctx, ws, sess, control.CmdObserve, nil)
}

// Perform sends an exec request to the workspace executor and waits for the
// bounded result (v1: 15s driver timeout).
func (s *Server) Perform(ctx context.Context, ws *control.Workspace, sess *control.Session, cmd control.Command, args json.RawMessage) (json.RawMessage, error) {
	s.mu.Lock()
	c := s.conns[ws.ID]
	s.mu.Unlock()
	if c == nil || c.closed.Load() {
		return nil, control.ErrTargetUnavailable()
	}
	id := fmt.Sprintf("exec-%d", s.reqSeq.Add(1))
	ch := make(chan *Envelope, 1)
	c.writeMu.Lock()
	c.pending[id] = ch
	err := WriteFrame(c.nc, mustJSON(&Envelope{
		Kind: KindExec, ID: id, SessionID: sess.ID,
		Command: string(cmd), Args: args,
	}))
	c.writeMu.Unlock()
	if err != nil {
		c.writeMu.Lock()
		delete(c.pending, id)
		c.writeMu.Unlock()
		return nil, control.ErrControlInterrupted()
	}
	select {
	case <-ctx.Done():
		return nil, control.ErrActionTimeout()
	case <-time.After(15 * time.Second): // v1 bounded driver timeout
		return nil, control.ErrActionTimeout()
	case m := <-ch:
		if m.OK != nil && *m.OK {
			return m.Result, nil
		}
		return nil, control.ErrFromCode(m.Code, m.Message, m.Uncertain)
	}
}

// PushPairRequest notifies bound executors of a pending pairing consent.
func (s *Server) PushPairRequest(p *control.PairRequest) {
	s.mu.Lock()
	defer s.mu.Unlock()
	caps := make([]string, len(p.Capabilities))
	for i, c := range p.Capabilities {
		caps[i] = string(c)
	}
	env := &Envelope{Kind: KindPairRequest, PairID: p.ID, Label: p.Label, Capabilities: caps, TTLSeconds: p.TTLSeconds}
	b := mustJSON(env)
	for _, c := range s.conns {
		c.writeMu.Lock()
		_ = WriteFrame(c.nc, b)
		c.writeMu.Unlock()
	}
}

// SendChatEvent forwards a normalized agent event to the workspace's dock.
func (s *Server) SendChatEvent(wsID string, payload json.RawMessage) {
	s.mu.Lock()
	c := s.conns[wsID]
	s.mu.Unlock()
	if c == nil || c.closed.Load() {
		return
	}
	c.writeMu.Lock()
	_ = WriteFrame(c.nc, mustJSON(&Envelope{Kind: KindChatEvent, Payload: payload}))
	c.writeMu.Unlock()
}

// SendAuthRequest forwards an authentication-broker surface to the executor.
func (s *Server) SendAuthRequest(wsID string, payload json.RawMessage) {
	s.mu.Lock()
	c := s.conns[wsID]
	s.mu.Unlock()
	if c == nil {
		return
	}
	c.writeMu.Lock()
	_ = WriteFrame(c.nc, mustJSON(&Envelope{Kind: KindAuthRequest, Payload: payload}))
	c.writeMu.Unlock()
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte(`{"kind":"error"}`)
	}
	return b
}
