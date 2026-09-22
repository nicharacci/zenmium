package agent

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Kernel is the agent-rail engine: a single `opencode serve` loop spawned on
// 127.0.0.1 with a random basic-auth credential, health-polled, evented over
// SSE, and bound to the internal browser-control MCP bridge. Ported from
// desktop/src/main/agent-kernel.ts. There is exactly one kernel per daemon —
// no second chat engine.

// DeniedTools mirrors the v1 tool map: everything off except zenmium_*.
var DeniedTools = map[string]bool{
	"bash": true, "edit": true, "write": true, "patch": true,
	"glob": true, "grep": true, "read": true, "ls": true,
	"webfetch": true, "websearch": true, "task": true,
	"skill": true, "todowrite": true, "todoread": true,
}

// BrowserBinding connects the kernel to the local MCP bridge.
type BrowserBinding struct {
	Name          string            `json:"name"`
	URL           string            `json:"url"`
	Headers       map[string]string `json:"headers,omitempty"`
	ToolNames     []string          `json:"toolNames,omitempty"`
	SystemContext string            `json:"systemContext,omitempty"`
}

// Config carries kernel tunables. Environment variables:
//
//	ZENMIUM_MODEL           default openrouter/deepseek/deepseek-v4.1-flash
//	OPENROUTER_API_KEY      referenced by NAME ONLY — never logged, never in argv
//	ZENMIUM_OPENCODE_BIN    override path to the opencode binary
type Config struct {
	OpenCodeBin string
	Model       string
	DataDir     string
}

// Kernel owns the opencode process and its SSE pump.
type Kernel struct {
	cfg     Config
	mu      sync.Mutex
	proc    *exec.Cmd
	port    int
	pw      string
	health  bool
	sessID  string
	events  chan map[string]any
	stop    context.CancelFunc
	onEvent func(map[string]any)
}

const systemPrompt = "You are Zenmium's browser assistant, not a coding agent. Drive the browser only through the zenmium_* tools. Never print credentials, tokens, or page secrets."

func NewKernel(cfg Config, onEvent func(map[string]any)) *Kernel {
	if cfg.Model == "" {
		cfg.Model = getenv("ZENMIUM_MODEL", "openrouter/deepseek/deepseek-v4.1-flash")
	}
	if cfg.OpenCodeBin == "" {
		cfg.OpenCodeBin = getenv("ZENMIUM_OPENCODE_BIN", "opencode")
	}
	return &Kernel{cfg: cfg, onEvent: onEvent}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// Start spawns `opencode serve --hostname 127.0.0.1 --port <free>` with the
// random basic-auth credential, then health-polls /global/health then /app.
func (k *Kernel) Start(ctx context.Context) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.proc != nil {
		return fmt.Errorf("kernel already running")
	}
	port, err := freePort()
	if err != nil {
		return err
	}
	pw := make([]byte, 32)
	if _, err := rand.Read(pw); err != nil {
		return err
	}
	k.port = port
	k.pw = base64.RawURLEncoding.EncodeToString(pw)
	cmd := exec.CommandContext(ctx, k.cfg.OpenCodeBin, "serve",
		"--hostname", "127.0.0.1", "--port", fmt.Sprint(port))
	env := []string{
		"OPENCODE_SERVER_USERNAME=zenmium",
		"OPENCODE_SERVER_PASSWORD=" + k.pw,
		"HOME=" + os.Getenv("HOME"),
		"PATH=" + os.Getenv("PATH"),
		"TMPDIR=" + os.Getenv("TMPDIR"),
		"LANG=" + os.Getenv("LANG"),
	}
	// Model key passes through by env NAME only — no values in argv/logs.
	if v := os.Getenv("OPENROUTER_API_KEY"); v != "" {
		env = append(env, "OPENROUTER_API_KEY="+v)
	}
	cmd.Env = env
	cmd.Dir = k.cfg.DataDir
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard // opencode writes logs to its own file; never to our stdout
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("opencode serve: %w", err)
	}
	k.proc = cmd
	if err := k.waitHealth(ctx); err != nil {
		_ = cmd.Process.Kill()
		k.proc = nil
		return err
	}
	k.events = make(chan map[string]any, 256)
	pctx, cancel := context.WithCancel(ctx)
	k.stop = cancel
	go k.pumpSSE(pctx)
	k.health = true
	return nil
}

func (k *Kernel) req(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	url := fmt.Sprintf("http://127.0.0.1:%d%s", k.port, path)
	r, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	r.SetBasicAuth("zenmium", k.pw)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	cli := &http.Client{Timeout: 15 * time.Second}
	return cli.Do(r)
}

func (k *Kernel) waitHealth(ctx context.Context) error {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		for _, path := range []string{"/global/health", "/app"} {
			resp, err := k.req(ctx, http.MethodGet, path, nil)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode < 500 {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return fmt.Errorf("opencode health check timed out")
}

// pumpSSE is the v1 SSE pump with reconnect: GET /event, split on blank
// lines, dispatch JSON events to the chat manager.
func (k *Kernel) pumpSSE(ctx context.Context) {
	backoff := 250 * time.Millisecond
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		resp, err := k.req(ctx, http.MethodGet, "/event", nil)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < 5*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = 250 * time.Millisecond
		k.readSSE(ctx, resp.Body)
		resp.Body.Close()
	}
}

func (k *Kernel) readSSE(ctx context.Context, body io.Reader) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	var data strings.Builder
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			if data.Len() > 0 {
				k.dispatch(data.String())
				data.Reset()
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
}

func (k *Kernel) dispatch(raw string) {
	var ev map[string]any
	if err := json.Unmarshal([]byte(raw), &ev); err != nil {
		return
	}
	// Never forward secrets: strip any provider/auth-ish keys from the event
	// before the chat manager sees it.
	if m, ok := redactEvent(ev).(map[string]any); ok {
		ev = m
	}
	if k.onEvent != nil {
		k.onEvent(ev)
	}
	select {
	case k.events <- ev:
	default:
	}
}

var sensitiveKeys = map[string]bool{
	"apiKey": true, "apikey": true, "key": true, "token": true,
	"authorization": true, "password": true, "secret": true,
}

func redactEvent(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for key, val := range t {
			if sensitiveKeys[strings.ToLower(key)] {
				out[key] = "[redacted]"
			} else {
				out[key] = redactEvent(val)
			}
		}
		return out
	case []any:
		for i := range t {
			t[i] = redactEvent(t[i])
		}
		return t
	default:
		return v
	}
}

// EnsureSession creates or returns the kernel session.
func (k *Kernel) EnsureSession(ctx context.Context) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.sessID != "" {
		return k.sessID, nil
	}
	resp, err := k.req(ctx, http.MethodPost, "/session",
		strings.NewReader(`{"title":"zenmium-agent"}`))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	k.sessID = out.ID
	return k.sessID, nil
}

// ConnectBrowser registers the MCP bridge with the kernel (v1 connectBrowser).
func (k *Kernel) ConnectBrowser(ctx context.Context, b BrowserBinding) error {
	body, _ := json.Marshal(map[string]any{
		"name": b.Name, "url": b.URL, "headers": b.Headers,
	})
	resp, err := k.req(ctx, http.MethodPost, "/mcp", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// toolsPayload builds the v1 tools map: everything off except zenmium_*.
func toolsPayload() map[string]bool {
	m := map[string]bool{"*": false}
	for k := range DeniedTools {
		m[k] = true // explicit deny entries, matching the v1 deny-list shape
	}
	for _, t := range []string{"zenmium_capabilities", "zenmium_session", "zenmium_action", "zenmium_events"} {
		m[t] = true
	}
	return m
}

// Prompt posts one turn to the kernel session (v1 /session/{id}/message).
func (k *Kernel) Prompt(ctx context.Context, sessionID, text string) error {
	payload, _ := json.Marshal(map[string]any{
		"model":  k.cfg.Model,
		"tools":  toolsPayload(),
		"system": systemPrompt,
		"parts":  []map[string]any{{"type": "text", "text": text}},
		"agent":  "build",
	})
	resp, err := k.req(ctx, http.MethodPost, fmt.Sprintf("/session/%s/message", sessionID), strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("prompt: status %d", resp.StatusCode)
	}
	return nil
}

// Abort interrupts the current turn (v1 /session/{id}/abort).
func (k *Kernel) Abort(ctx context.Context, sessionID string) {
	resp, err := k.req(ctx, http.MethodPost, fmt.Sprintf("/session/%s/abort", sessionID), nil)
	if err == nil {
		resp.Body.Close()
	}
}

// ReplyPermission resolves an approval card (opencode permission.reply).
func (k *Kernel) ReplyPermission(ctx context.Context, sessionID, permissionID, response string) error {
	body, _ := json.Marshal(map[string]any{"response": response})
	resp, err := k.req(ctx, http.MethodPost,
		fmt.Sprintf("/session/%s/permission/%s", sessionID, permissionID),
		strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// Model returns the configured model id.
func (k *Kernel) Model() string { return k.cfg.Model }

// Stop kills the kernel.
func (k *Kernel) Stop() {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.stop != nil {
		k.stop()
	}
	if k.proc != nil && k.proc.Process != nil {
		_ = k.proc.Process.Kill()
	}
	k.proc = nil
	k.health = false
}
