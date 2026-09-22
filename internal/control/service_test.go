package control

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// Parity tests ported from desktop/tests/browser-control.test.ts — the same
// behavioral contract, against the Go service.

type fakeDriver struct {
	performFn func(ctx context.Context, ws *Workspace, sess *Session, cmd Command, args json.RawMessage) (json.RawMessage, error)
	bound     bool
}

func (f *fakeDriver) Observe(ctx context.Context, ws *Workspace, sess *Session) (json.RawMessage, error) {
	return json.RawMessage(`{"documentId":"doc-1"}`), nil
}
func (f *fakeDriver) Perform(ctx context.Context, ws *Workspace, sess *Session, cmd Command, args json.RawMessage) (json.RawMessage, error) {
	if f.performFn != nil {
		return f.performFn(ctx, ws, sess, cmd, args)
	}
	if cmd == CmdObserve {
		return json.RawMessage(`{"documentId":"doc-1"}`), nil
	}
	return json.RawMessage(`{"ok":true}`), nil
}
func (f *fakeDriver) Bound(string) bool { return f.bound }

func newTestService(t *testing.T, d Driver) *Service {
	t.Helper()
	s, err := NewService(t.TempDir(), d, Config{Now: func() time.Time { return time.UnixMilli(1_800_000_000_000) }})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func pairGrant(t *testing.T, s *Service, caps []Capability) *Grant {
	t.Helper()
	wait, deny, perr := s.RequestPair(PairRequest{
		Label: "test", Capabilities: caps, TTLSeconds: 3600, Origin: "test",
	})
	if perr != nil {
		t.Fatalf("request pair: %v", perr)
	}
	var pending *PairRequest
	for _, p := range s.PendingPairs() {
		pending = p
	}
	if pending == nil {
		t.Fatal("no pending pair")
	}
	res, cerr := s.ConsentPair(pending.ID, true)
	if cerr != nil {
		t.Fatalf("consent: %v", cerr)
	}
	select {
	case <-wait:
	case err := <-deny:
		t.Fatalf("deny: %v", err)
	case <-time.After(time.Second):
		t.Fatal("pair wait timed out")
	}
	g, aerr := s.Authorize(res.Token)
	if aerr != nil {
		t.Fatalf("authorize: %v", aerr)
	}
	return g
}

func bindWorkspace(t *testing.T, s *Service) *Workspace {
	t.Helper()
	ws, err := s.BindNonce("nonce-1", "Profile 1", "Default")
	if err != nil {
		t.Fatal(err)
	}
	return ws
}

func mustExec(t *testing.T, s *Service, g *Grant, req string) *Receipt {
	t.Helper()
	rcpt, e := s.Execute(context.Background(), g, json.RawMessage(req))
	if e != nil {
		t.Fatalf("execute: %v %s", e.Code, e.Message)
	}
	if !rcpt.OK {
		t.Fatalf("receipt not ok: %v", rcpt.Err)
	}
	return rcpt
}

func execErr(t *testing.T, s *Service, g *Grant, req string) *Error {
	t.Helper()
	_, e := s.Execute(context.Background(), g, json.RawMessage(req))
	if e == nil {
		t.Fatal("expected error")
	}
	return e
}

func TestPairRequiresConsentAndYieldsHashOnly(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	g := pairGrant(t, s, []Capability{CapObserve})
	if g.TokenHash == "" || len(g.TokenHash) != 64 {
		t.Fatal("token hash must be sha256 hex")
	}
	// The plaintext token must never be on the stored grant.
	if g.Label != "test" {
		t.Fatal("label not preserved")
	}
}

func TestDeniedPairYieldsNoGrant(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	_, deny, _ := s.RequestPair(PairRequest{Label: "x", Capabilities: []Capability{CapObserve}, TTLSeconds: 60, Origin: "test"})
	id := s.PendingPairs()[0].ID
	if _, e := s.ConsentPair(id, false); e != nil {
		t.Fatalf("deny should resolve cleanly: %v", e)
	}
	select {
	case err := <-deny:
		if err == nil {
			t.Fatal("expected deny error")
		}
	case <-time.After(time.Second):
		t.Fatal("deny not delivered")
	}
	if len(s.Grants()) != 0 {
		t.Fatal("denied pair minted a grant")
	}
}

func TestGrantTTLRejectedAboveMax(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	_, _, e := s.RequestPair(PairRequest{
		Label: "x", Capabilities: []Capability{CapObserve},
		TTLSeconds: int64(MaxGrantTTL/time.Second) + 1, Origin: "test",
	})
	if e == nil || e.Code != CodeInvalidRequest {
		t.Fatalf("want INVALID_REQUEST, got %v", e)
	}
}

func TestExpiredGrantFailsAuthorize(t *testing.T) {
	var clock = time.UnixMilli(1_800_000_000_000)
	s, _ := NewService(t.TempDir(), &fakeDriver{bound: true}, Config{Now: func() time.Time { return clock }})
	wait, _, _ := s.RequestPair(PairRequest{Label: "x", Capabilities: []Capability{CapObserve}, TTLSeconds: 10, Origin: "t"})
	res, _ := s.ConsentPair(s.PendingPairs()[0].ID, true)
	<-wait
	clock = clock.Add(11 * time.Second)
	if _, e := s.Authorize(res.Token); e == nil || e.Code != CodeUnauthorized {
		t.Fatalf("want UNAUTHORIZED after expiry, got %v", e)
	}
}

func TestCapabilityDenied(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve}) // no interact
	sess, e := s.CreateSession(g, ws.ID)
	if e != nil {
		t.Fatal(e)
	}
	e = execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"r1","command":"click","args":{"ref":1}}`)
	if e.Code != CodeObservationRequired && e.Code != CodeCapabilityDenied {
		t.Fatalf("unexpected code %s", e.Code)
	}
	// observe first, then click still denied
	mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"r2","command":"observe"}`)
	e = execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"r3","command":"click","args":{"ref":1}}`)
	if e.Code != CodeCapabilityDenied {
		t.Fatalf("want CAPABILITY_DENIED, got %s", e.Code)
	}
}

func TestObservationGateAndRevisionFence(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve, CapInteract})
	sess, _ := s.CreateSession(g, ws.ID)

	// Gate: interact before observe → OBSERVATION_REQUIRED.
	e := execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"a","command":"click","args":{"ref":1}}`)
	if e.Code != CodeObservationRequired {
		t.Fatalf("want OBSERVATION_REQUIRED got %s", e.Code)
	}
	// observe clears the gate and pins documentId.
	mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"b","command":"observe"}`)
	mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"c","command":"click","args":{"ref":1}}`)
	// Stale revision fences.
	e = execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"d","command":"click","args":{"ref":2},"revision":99}`)
	if e.Code != CodeStaleRevision {
		t.Fatalf("want STALE_REVISION got %s", e.Code)
	}
}

func TestNavigateInvalidatesDocumentAndBumpsRevision(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve, CapNavigate})
	sess, _ := s.CreateSession(g, ws.ID)
	mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"o","command":"observe"}`)
	nav := mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"n","command":"navigate","args":{"url":"https://example.com"}}`)
	if nav.Revision != 1 {
		t.Fatalf("revision should bump to 1, got %d", nav.Revision)
	}
	// After navigate the session needs a fresh observe.
	e := execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"n2","command":"navigate","args":{"url":"https://a.test"}}`)
	if e.Code != CodeObservationRequired {
		t.Fatalf("want OBSERVATION_REQUIRED got %s", e.Code)
	}
}

func TestIdempotentReplayReturnsRecordedReceipt(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve})
	sess, _ := s.CreateSession(g, ws.ID)
	r1 := mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"dup","command":"observe"}`)
	r2 := mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"dup","command":"observe"}`)
	if !r2.Replayed {
		t.Fatal("second execute should be marked replayed")
	}
	if r1.Revision != r2.Revision {
		t.Fatal("replay must return the recorded revision")
	}
}

func TestTakeoverFencesExecutes(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve, CapInteract})
	sess, _ := s.CreateSession(g, ws.ID)
	mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"o","command":"observe"}`)
	if e := s.Takeover(sess.ID); e != nil {
		t.Fatal(e)
	}
	e := execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"x","command":"click","args":{"ref":1}}`)
	if e.Code != CodeHumanControl {
		t.Fatalf("want HUMAN_CONTROL got %s", e.Code)
	}
	if e := s.Resume(sess.ID); e != nil {
		t.Fatal(e)
	}
	// Resume forces re-observation.
	e = execErr(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"y","command":"click","args":{"ref":1}}`)
	if e.Code != CodeObservationRequired {
		t.Fatalf("want OBSERVATION_REQUIRED after resume, got %s", e.Code)
	}
}

func TestCreateSessionIdempotentPerWorkspace(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve})
	a, _ := s.CreateSession(g, ws.ID)
	b, _ := s.CreateSession(g, ws.ID)
	if a.ID != b.ID {
		t.Fatal("createSession must be idempotent per workspace")
	}
}

func TestUncertainDriverErrorPropagates(t *testing.T) {
	d := &fakeDriver{bound: true, performFn: func(ctx context.Context, ws *Workspace, sess *Session, cmd Command, args json.RawMessage) (json.RawMessage, error) {
		if cmd == CmdObserve {
			return json.RawMessage(`{"documentId":"doc-1"}`), nil
		}
		return nil, uncertainError(CodeActionTimeout, "frame navigated mid-action")
	}}
	s := newTestService(t, d)
	ws := bindWorkspace(t, s)
	g := pairGrant(t, s, []Capability{CapObserve, CapInteract})
	sess, _ := s.CreateSession(g, ws.ID)
	mustExec(t, s, g, `{"sessionId":"`+sess.ID+`","requestId":"o","command":"observe"}`)
	rcpt, e := s.Execute(context.Background(), g, json.RawMessage(`{"sessionId":"`+sess.ID+`","requestId":"u","command":"click","args":{"ref":1}}`))
	if e != nil {
		t.Fatalf("execute returned envelope error: %v", e)
	}
	if rcpt.OK || !rcpt.Uncertain {
		t.Fatalf("expected uncertain failure receipt, got %+v", rcpt)
	}
}

func TestNonceBindingStableAcrossReconnects(t *testing.T) {
	s := newTestService(t, &fakeDriver{bound: true})
	a, _ := s.BindNonce("n1", "Profile 1", "Default")
	b, _ := s.BindNonce("n1", "Profile 1", "Default")
	if a.ID != b.ID {
		t.Fatal("same nonce must resolve to the same workspace")
	}
	c, _ := s.BindNonce("n2", "Profile 2", "Work")
	if c.ID == a.ID {
		t.Fatal("different nonce must mint a different workspace")
	}
}

func TestSafeControlURLAndRedact(t *testing.T) {
	if got := SafeControlURL("https://user:pass@example.com/path?token=abc#frag"); got != "https://example.com/path" {
		t.Fatalf("userinfo/query/fragment must be stripped: %q", got)
	}
	if got := SafeControlURL("https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); got != "https://example.com/[redacted]" {
		t.Fatalf("long segment must be redacted: %q", got)
	}
	if got := RedactControlText("token: sk-abc1234567890 card 4111111111111111"); got == "token: sk-abc1234567890 card 4111111111111111" {
		t.Fatal("credentials must be redacted")
	}
}
