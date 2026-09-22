package bridge

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"io.zenmium/internal/control"
)

// Server is the loopback MCP HTTP bridge, ported from
// desktop/src/main/browser-control-bridge.ts:
//
//   - binds 127.0.0.1 only (an ephemeral port; never a fixed one)
//   - POST /mcp + application/json only
//   - requires Authorization: Bearer <token>
//   - rejects any request carrying an Origin header (browser-issued requests
//     always carry one; a real MCP client does not)
//   - rejects a Host that isn't the bound loopback socket (DNS-rebinding
//     guard) and anything not addressed to the literal listener
//   - max 16 concurrent connections, 20s request timeout, 1 MiB body cap
type Server struct {
	svc   *control.Service
	ln    net.Listener
	srv   *http.Server
	token string
}

const (
	requestTimeout = 20 * time.Second
	maxBody        = 1 << 20
	maxConns       = 16
)

// New generates the bridge bearer token and binds the loopback listener.
func New(svc *control.Service) (*Server, error) {
	tb := make([]byte, 32)
	if _, err := rand.Read(tb); err != nil {
		return nil, err
	}
	s := &Server{svc: svc, token: base64.RawURLEncoding.EncodeToString(tb)}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s.ln = ln
	mux := http.NewServeMux()
	mux.HandleFunc("/mcp", s.handleMCP)
	s.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       requestTimeout,
		MaxHeaderBytes:    64 << 10,
		ConnState:         s.connState,
	}
	return s, nil
}

// URL is the full MCP endpoint the agent kernel binds to.
func (s *Server) URL() string { return "http://" + s.ln.Addr().String() + "/mcp" }

// Token is the bridge bearer token (kept in memory, never written).
func (s *Server) Token() string { return s.token }

func (s *Server) Serve() error { return s.srv.Serve(s.ln) }

func (s *Server) Close() { _ = s.srv.Close() }

func (s *Server) connState(c net.Conn, st http.ConnState) {
	// Per-server connection cap. http.Server lacks a hard cap; track and
	// close excess at transition to active.
	if st == http.StateNew {
		if !connLimiter.Allow() {
			_ = c.Close()
		}
	}
}

var connLimiter = newLimiter(maxConns)

type limiter struct{ ch chan struct{} }

func newLimiter(n int) *limiter { return &limiter{ch: make(chan struct{}, n)} }
func (l *limiter) Allow() bool {
	select {
	case l.ch <- struct{}{}:
		return true
	default:
		return false
	}
}
func (l *limiter) Release() {
	select {
	case <-l.ch:
	default:
	}
}

func reject(w http.ResponseWriter, code int) {
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(code)
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	defer connLimiter.Release()
	// Loopback-only peer (listener is already loopback, defense in depth).
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		reject(w, http.StatusForbidden)
		return
	}
	// Host header must be the literal listener socket — rejects DNS-rebind
	// attempts that 127 to a hostname.
	if r.Host != s.ln.Addr().String() {
		reject(w, http.StatusForbidden)
		return
	}
	// Browser-originated requests always carry Origin — deny outright.
	if r.Header.Get("Origin") != "" {
		reject(w, http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		reject(w, http.StatusMethodNotAllowed)
		return
	}
	ct := r.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		reject(w, http.StatusUnsupportedMediaType)
		return
	}
	auth := r.Header.Get("Authorization")
	if auth != "Bearer "+s.token {
		reject(w, http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	s.handleRPC(ctx, w, r)
}

var _ = fmt.Sprint // keep fmt for future debug hooks without churn
