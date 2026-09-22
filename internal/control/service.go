package control

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Driver is the per-workspace executor seam. On Helium the implementer is the
// component extension reached through the native-messaging relay (see
// internal/relay); on Electron it was NativeBrowserControlDriver bound to a
// WebContents. The daemon side never touches a page directly.
type Driver interface {
	// Observe returns a fresh observation of the session's bound tab.
	Observe(ctx context.Context, ws *Workspace, sess *Session) (json.RawMessage, error)
	// Perform executes one action verb against the bound tab.
	Perform(ctx context.Context, ws *Workspace, sess *Session, cmd Command, args json.RawMessage) (json.RawMessage, error)
	// Bound reports whether a live executor exists for this workspace.
	Bound(wsID string) bool
}

// Config tunes the service. Zero values fall back to v1 defaults.
type Config struct {
	Now func() time.Time // test hook
}

// Service is the ported BrowserControlService: grants, sessions, the execute
// pipeline, takeover/resume fencing, and the event journal.
type Service struct {
	cfg    Config
	mu     sync.Mutex
	store  *store
	driver Driver

	// pendingPairs holds consent windows awaiting browser approval.
	pendingPairs map[string]*PairRequest
	pairWait     map[string]chan *PairResult
	pairDeny     map[string]chan error

	// events is the per-session event ring (journal, capped).
	events map[string][]Event
	seq    int64

	// subscribers receive live event appends (the agent rail listens here).
	subsMu sync.Mutex
	subs   map[chan Event]struct{}
}

func NewService(dir string, driver Driver, cfg Config) (*Service, error) {
	st, err := openStore(dir)
	if err != nil {
		return nil, err
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Service{
		cfg:          cfg,
		store:        st,
		driver:       driver,
		pendingPairs: map[string]*PairRequest{},
		pairWait:     map[string]chan *PairResult{},
		pairDeny:     map[string]chan error{},
		events:       map[string][]Event{},
		subs:         map[chan Event]struct{}{},
	}, nil
}

func (s *Service) now() time.Time { return s.cfg.Now().UTC() }

// SetDriver installs the executor seam (the relay server in production).
func (s *Service) SetDriver(d Driver) { s.driver = d }

// --- authorization -------------------------------------------------------

// Authorize resolves a bearer token to a live grant. Only hashes persist;
// the presented token is compared constant-time.
func (s *Service) Authorize(token string) (*Grant, *Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for _, g := range s.store.Grants {
		if tokenMatches(token, g.TokenHash) {
			if !g.live(now) {
				return nil, newError(CodeUnauthorized, "grant expired or revoked")
			}
			t := now
			g.LastUsedAt = &t
			_ = s.store.persist()
			return g, nil
		}
	}
	return nil, newError(CodeUnauthorized, "unknown or expired token")
}

func grantCovers(g *Grant, wsID string) bool {
	if len(g.WorkspaceIDs) == 0 {
		return true
	}
	for _, w := range g.WorkspaceIDs {
		if w == wsID {
			return true
		}
	}
	return false
}

func grantAllows(g *Grant, c Capability) bool {
	for _, x := range g.Capabilities {
		if x == c {
			return true
		}
	}
	return false
}

// --- workspace binding ----------------------------------------------------

// BindNonce registers or resolves the profile binding nonce presented by the
// extension over the relay channel. Returns the workspace for this profile.
func (s *Service) BindNonce(nonce string, profileID string, name string) (*Workspace, error) {
	if nonce == "" {
		return nil, errors.New("nonce required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if wsID, ok := s.store.pairNonces[nonce]; ok {
		return s.store.Workspaces[wsID], nil
	}
	id, err := newID("ws")
	if err != nil {
		return nil, err
	}
	ws := &Workspace{ID: id, Name: name, ProfileID: profileID, CreatedAt: s.now(), ConsentNonce: nonce}
	s.store.Workspaces[id] = ws
	s.store.pairNonces[nonce] = id
	return ws, s.store.persist()
}

// ResolveNonce returns the bound workspace for a nonce without creating one.
func (s *Service) ResolveNonce(nonce string) *Workspace {
	s.mu.Lock()
	defer s.mu.Unlock()
	if wsID, ok := s.store.pairNonces[nonce]; ok {
		return s.store.Workspaces[wsID]
	}
	return nil
}

func (s *Service) Workspace(id string) *Workspace {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.Workspaces[id]
}

// Workspaces lists bound workspaces (for consent UI and zenmiumctl status).
func (s *Service) Workspaces() []*Workspace {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Workspace, 0, len(s.store.Workspaces))
	for _, w := range s.store.Workspaces {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// --- pairing --------------------------------------------------------------

// RequestPair registers a pairing request and returns a pending channel that
// resolves on in-browser consent. Consent is mandatory — there is no
// unattended grant minting path.
func (s *Service) RequestPair(p PairRequest) (<-chan *PairResult, <-chan error, *Error) {
	if err := ValidatePairRequest(&p); err != nil {
		return nil, nil, err
	}
	id, err := newID("pair")
	if err != nil {
		return nil, nil, newError(CodeInvalidRequest, err.Error())
	}
	p.ID = id
	p.CreatedAt = s.now()
	p.ExpiresAt = p.CreatedAt.Add(5 * time.Minute) // consent window
	s.mu.Lock()
	s.pendingPairs[id] = &p
	waitCh := make(chan *PairResult, 1)
	denyCh := make(chan error, 1)
	s.pairWait[id] = waitCh
	s.pairDeny[id] = denyCh
	s.mu.Unlock()

	go func() {
		<-time.After(time.Until(p.ExpiresAt))
		s.mu.Lock()
		if _, ok := s.pendingPairs[id]; ok {
			delete(s.pendingPairs, id)
			s.pairDeny[id] <- newError(CodeActionTimeout, "pairing consent expired")
			delete(s.pairWait, id)
			delete(s.pairDeny, id)
		}
		s.mu.Unlock()
	}()
	return waitCh, denyCh, nil
}

// PendingPairs lists open consent requests (consumed by the consent UI).
func (s *Service) PendingPairs() []*PairRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*PairRequest, 0, len(s.pendingPairs))
	for _, p := range s.pendingPairs {
		out = append(out, p)
	}
	return out
}

// ConsentPair resolves a pending pair: approved mints the grant and returns
// the one-time token; denied fails the waiter.
func (s *Service) ConsentPair(pairID string, approve bool) (*PairResult, *Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pendingPairs[pairID]
	if !ok {
		return nil, newError(CodeInvalidRequest, "unknown or expired pairing request")
	}
	delete(s.pendingPairs, pairID)
	waitCh := s.pairWait[pairID]
	denyCh := s.pairDeny[pairID]
	delete(s.pairWait, pairID)
	delete(s.pairDeny, pairID)

	if !approve {
		denyCh <- newError(CodeUnauthorized, "pairing denied in browser")
		return nil, nil
	}
	plain, hash, err := newToken()
	if err != nil {
		denyCh <- err
		return nil, newError(CodeInvalidRequest, err.Error())
	}
	gid, err := newID("grant")
	if err != nil {
		denyCh <- err
		return nil, newError(CodeInvalidRequest, err.Error())
	}
	g := &Grant{
		ID: gid, Label: p.Label, TokenHash: hash,
		Capabilities: p.Capabilities, WorkspaceIDs: p.WorkspaceIDs,
		CreatedAt: s.now(), ExpiresAt: s.now().Add(time.Duration(p.TTLSeconds) * time.Second),
	}
	s.store.Grants[gid] = g
	if err := s.store.persist(); err != nil {
		denyCh <- err
		return nil, newError(CodeJournalUnavailable, err.Error())
	}
	res := &PairResult{GrantID: gid, Token: plain}
	waitCh <- res
	return res, nil
}

// Revoke kills a grant immediately (v1 `revoke`).
func (s *Service) Revoke(grantID string) *Error {
	s.mu.Lock()
	defer s.mu.Unlock()
	g, ok := s.store.Grants[grantID]
	if !ok {
		return newError(CodeInvalidRequest, "unknown grant")
	}
	now := s.now()
	g.RevokedAt = &now
	if err := s.store.persist(); err != nil {
		return newError(CodeJournalUnavailable, err.Error())
	}
	return nil
}

// Grants lists grant metadata (never tokens — none are stored).
func (s *Service) Grants() []*Grant {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Grant, 0, len(s.store.Grants))
	for _, g := range s.store.Grants {
		out = append(out, g)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// --- sessions ---------------------------------------------------------------

// CreateSession is the v1 `createSession` verb — idempotent per workspace.
func (s *Service) CreateSession(g *Grant, wsID string) (*Session, *Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !grantCovers(g, wsID) {
		return nil, newError(CodeWorkspaceNotFound, "grant does not cover workspace")
	}
	if _, ok := s.store.Workspaces[wsID]; !ok {
		return nil, newError(CodeWorkspaceNotFound, "workspace not bound")
	}
	if sid, ok := s.store.Creations[wsID]; ok {
		if sess := s.store.Sessions[sid]; sess != nil && sess.State != SessionEnded {
			return sess, nil
		}
	}
	id, err := newID("control")
	if err != nil {
		return nil, newError(CodeInvalidRequest, err.Error())
	}
	sess := &Session{
		ID: id, GrantID: g.ID, WorkspaceID: wsID,
		Controller: ControllerAgent, State: SessionActive,
		Revision: 0, NeedsObservation: true,
		CreatedAt: s.now(), UpdatedAt: s.now(),
	}
	s.store.Sessions[id] = sess
	s.store.Creations[wsID] = id
	if err := s.store.persist(); err != nil {
		return nil, newError(CodeJournalUnavailable, err.Error())
	}
	s.appendEventLocked(sess, "session.created", nil)
	return sess, nil
}

// fingerprint is the v1 idempotency key: sha256(session|request|command|args).
func fingerprint(r *ExecuteRequest) string {
	h := sha256.New()
	h.Write([]byte(r.SessionID))
	h.Write([]byte{0})
	h.Write([]byte(r.RequestID))
	h.Write([]byte{0})
	h.Write([]byte(r.Command))
	h.Write([]byte{0})
	h.Write(r.Args)
	return hex.EncodeToString(h.Sum(nil))
}

// Execute is the v1 execute pipeline, in order:
// authorize → parse → capability → busy → human/revision/observation →
// scope → driver → receipt. Idempotent on request fingerprint.
func (s *Service) Execute(ctx context.Context, g *Grant, raw json.RawMessage) (*Receipt, *Error) {
	req, perr := ParseExecuteRequest(raw)
	if perr != nil {
		return nil, perr
	}
	fp := fingerprint(req)

	s.mu.Lock()
	if prev, ok := s.store.Requests[fp]; ok {
		// Identical fingerprint replay returns the recorded receipt.
		out := *prev
		out.Replayed = true
		s.mu.Unlock()
		return &out, nil
	}
	sess := s.store.Sessions[req.SessionID]
	if sess == nil || sess.State == SessionEnded {
		s.mu.Unlock()
		return nil, newError(CodeSessionOutOfScope, "unknown session")
	}
	if sess.GrantID != g.ID {
		s.mu.Unlock()
		return nil, newError(CodeSessionOutOfScope, "session not owned by grant")
	}
	capability, _ := commandCapability(req.Command)
	if !grantAllows(g, capability) {
		s.mu.Unlock()
		return nil, newError(CodeCapabilityDenied, fmt.Sprintf("grant lacks %q", capability))
	}
	if sess.Controller == ControllerHuman {
		s.mu.Unlock()
		return nil, newError(CodeHumanControl, "session is under human control")
	}
	if req.Revision != nil && *req.Revision != sess.Revision {
		s.mu.Unlock()
		return nil, newError(CodeStaleRevision, fmt.Sprintf("stale revision %d != %d", *req.Revision, sess.Revision))
	}
	if sess.NeedsObservation && req.Command != CmdObserve && req.Command != CmdSessionStatus {
		s.mu.Unlock()
		return nil, newError(CodeObservationRequired, "session requires a fresh observe before acting")
	}
	if !s.driver.Bound(sess.WorkspaceID) {
		s.mu.Unlock()
		return nil, newError(CodeTargetUnavailable, "workspace has no live control channel")
	}
	ws := s.store.Workspaces[sess.WorkspaceID]
	s.mu.Unlock()

	// Driver call happens outside the lock; the session is "busy" via a
	// fencing increment so concurrent executes serialize naturally.
	s.mu.Lock()
	sess.Fence++
	s.mu.Unlock()
	res, derr := s.driver.Perform(ctx, ws, sess, req.Command, req.Args)
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	sess.UpdatedAt = now
	rcpt := &Receipt{SessionID: sess.ID, RequestID: req.RequestID, Revision: sess.Revision, Controller: sess.Controller}
	if derr != nil {
		var ce *Error
		if errors.As(derr, &ce) {
			rcpt.Err = ce
			rcpt.Uncertain = ce.Uncertain
		} else {
			rcpt.Err = uncertainError(CodeNativeActionFailed, derr.Error())
			rcpt.Uncertain = true
		}
	} else {
		rcpt.OK = true
		rcpt.Result = res
		// Observe satisfies the needs-observation gate and pins the document.
		if req.Command == CmdObserve {
			sess.NeedsObservation = false
			var obs struct {
				DocumentID string `json:"documentId"`
			}
			if json.Unmarshal(res, &obs) == nil && obs.DocumentID != "" {
				sess.LastDocumentID = obs.DocumentID
			}
		}
		// Mutating verbs invalidate the document identity: the next observe
		// must confirm the new document. v1 bumped the revision on
		// navigation; navigation-watch arrives via the relay watcher too.
		switch req.Command {
		case CmdNavigate, CmdTabCreate, CmdTabAdopt, CmdCDP, CmdAuthenticate:
			sess.Revision++
			sess.NeedsObservation = true
		}
	}
	rcpt.Revision = sess.Revision
	s.store.Requests[fp] = rcpt
	if err := s.store.persist(); err != nil {
		return nil, newError(CodeJournalUnavailable, err.Error())
	}
	kind := "action.ok"
	if !rcpt.OK {
		kind = "action.error"
	}
	s.appendEventLocked(sess, kind, json.RawMessage(res))
	return rcpt, nil
}

// Takeover transfers a session to human control and fences further executes
// (v1 `takeover`). Resume hands it back and forces re-observation.
func (s *Service) Takeover(sessionID string) *Error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.store.Sessions[sessionID]
	if sess == nil {
		return newError(CodeSessionOutOfScope, "unknown session")
	}
	sess.Controller = ControllerHuman
	sess.Fence++
	s.appendEventLocked(sess, "session.takeover", nil)
	if err := s.store.persist(); err != nil {
		return newError(CodeJournalUnavailable, err.Error())
	}
	return nil
}

// Resume returns a session to agent control (v1 `resume`).
func (s *Service) Resume(sessionID string) *Error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.store.Sessions[sessionID]
	if sess == nil {
		return newError(CodeSessionOutOfScope, "unknown session")
	}
	sess.Controller = ControllerAgent
	sess.State = SessionActive
	sess.NeedsObservation = true
	s.appendEventLocked(sess, "session.resumed", nil)
	if err := s.store.persist(); err != nil {
		return newError(CodeJournalUnavailable, err.Error())
	}
	return nil
}

// Status is the v1 `status` verb — a safe public view of one session.
func (s *Service) Status(sessionID string) (*SessionStatus, *Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.store.Sessions[sessionID]
	if sess == nil {
		return nil, newError(CodeSessionOutOfScope, "unknown session")
	}
	return &SessionStatus{
		ID: sess.ID, WorkspaceID: sess.WorkspaceID, TabID: sess.TabID,
		Controller: sess.Controller, State: sess.State,
		Revision: sess.Revision, NeedsObservation: sess.NeedsObservation,
	}, nil
}

// NoteNavigation is called by the relay watcher when the bound tab navigates:
// revision++ and needs-observation flip — exactly the v1 watch() wiring.
func (s *Service) NoteNavigation(sessionID string, safeURL string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.store.Sessions[sessionID]
	if sess == nil {
		return
	}
	sess.Revision++
	sess.NeedsObservation = true
	sess.UpdatedAt = s.now()
	data, _ := json.Marshal(map[string]string{"url": SafeControlURL(safeURL)})
	s.appendEventLocked(sess, "session.navigated", data)
	_ = s.store.persist()
}

// Events pages the session journal (v1 `events`): returns entries after
// `afterSeq`, plus resetRequired when the requested cursor predates the ring.
func (s *Service) Events(sessionID string, afterSeq int64, limit int) (items []Event, next int64, reset bool, err *Error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	evs := s.events[sessionID]
	if len(evs) == 0 {
		return nil, afterSeq, false, nil
	}
	oldest := evs[0].Seq
	reset = afterSeq > 0 && afterSeq < oldest-1
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	for _, e := range evs {
		if e.Seq > afterSeq {
			items = append(items, e)
			if len(items) >= limit {
				break
			}
		}
	}
	next = afterSeq
	if len(items) > 0 {
		next = items[len(items)-1].Seq
	}
	return items, next, reset, nil
}

// Subscribe registers a live event listener for the agent rail.
func (s *Service) Subscribe(ch chan Event) {
	s.subsMu.Lock()
	s.subs[ch] = struct{}{}
	s.subsMu.Unlock()
}

// Unsubscribe removes a listener.
func (s *Service) Unsubscribe(ch chan Event) {
	s.subsMu.Lock()
	delete(s.subs, ch)
	s.subsMu.Unlock()
}

const eventRingCap = 1024

func (s *Service) appendEventLocked(sess *Session, kind string, data json.RawMessage) {
	s.seq++
	e := Event{Seq: s.seq, SessionID: sess.ID, Kind: kind, At: s.now(), Data: data}
	ring := append(s.events[sess.ID], e)
	if len(ring) > eventRingCap {
		ring = ring[len(ring)-eventRingCap:]
	}
	s.events[sess.ID] = ring
	s.subsMu.Lock()
	for ch := range s.subs {
		select {
		case ch <- e:
		default:
		}
	}
	s.subsMu.Unlock()
}

// SweepExpires drops dead grants; called on a ticker by the daemon.
func (s *Service) SweepExpires() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for _, g := range s.store.Grants {
		if g.RevokedAt == nil && !now.Before(g.ExpiresAt) {
			t := now
			g.RevokedAt = &t
		}
	}
	_ = s.store.persist()
}
