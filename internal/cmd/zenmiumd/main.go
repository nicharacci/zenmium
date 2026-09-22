// Command zenmiumd is the persistent internal control daemon: it owns the
// browser-control state (grants, sessions, journals), the loopback MCP
// bridge internal products connect to, the unix-socket relay that the
// per-profile control-host pipes into, and the single OpenCode agent rail.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"io.zenmium/internal/agent"
	"io.zenmium/internal/bridge"
	"io.zenmium/internal/control"
	"io.zenmium/internal/relay"
)

// dataDir is the per-user internal state root.
func dataDir() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("APPDATA"), "Zenmium", "internal")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "Zenmium", "internal")
}

func main() {
	dir := flag.String("data-dir", dataDir(), "internal state directory")
	noKernel := flag.Bool("no-kernel", false, "do not start the OpenCode agent rail")
	bridgeFile := flag.String("bridge-file", "", "write bridge URL+token JSON here (0600) for product discovery")
	flag.Parse()

	log.SetOutput(os.Stderr)
	log.SetPrefix("[zenmiumd] ")

	// Control service.
	svc, err := control.NewService(*dir, nil, control.Config{})
	if err != nil {
		log.Fatalf("control store: %v", err)
	}

	// Relay: unix socket + per-workspace executors.
	srv := relay.NewServer(svc)
	svc.SetDriver(srv)
	if err := srv.Listen(relay.DaemonSocketPath()); err != nil {
		log.Fatalf("socket: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := srv.Serve(ctx); err != nil {
			log.Printf("relay serve: %v", err)
		}
	}()

	// MCP bridge for internal products — loopback + bearer only.
	br, err := bridge.New(svc)
	if err != nil {
		log.Fatalf("bridge: %v", err)
	}
	go func() { _ = br.Serve() }()
	log.Printf("mcp bridge at %s", br.URL())
	if *bridgeFile != "" {
		b, _ := json.Marshal(map[string]string{"url": br.URL(), "token": br.Token()})
		if err := os.WriteFile(*bridgeFile, b, 0600); err != nil {
			log.Printf("bridge-file: %v", err)
		}
	}

	// Pair-request fanout: when a product asks to pair, every bound executor
	// is asked to surface the in-browser consent card.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
				for _, p := range svc.PendingPairs() {
					srv.PushPairRequest(p)
				}
			}
		}
	}()

	// Grant TTL sweeper (v1 expiry sweep).
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				svc.SweepExpires()
			}
		}
	}()

	// Agent rail — single OpenCode loop unless disabled (CI sets -no-kernel).
	if !*noKernel {
		kernel := agent.NewKernel(agent.Config{DataDir: *dir}, nil)
		var chat *agent.ChatManager
		chat = agent.NewChatManager(kernel, func(convID string, m *agent.Message) {
			b, _ := json.Marshal(m)
			if cv := chat.Get(convID); cv != nil {
				srv.SendChatEvent(cv.WorkspaceID, b)
			}
		})
		srv.ChatHandler = func(ws *control.Workspace, env *relay.Envelope) {
			var p struct {
				ConvID     string `json:"convId"`
				RequestID  string `json:"requestId"`
				Text       string `json:"text"`
				ApprovalID string `json:"approvalId"`
				Response   string `json:"response"`
			}
			_ = json.Unmarshal(env.Payload, &p)
			switch env.Kind {
			case relay.KindChatSend:
				cv := chat.Get(p.ConvID)
				if cv == nil {
					cv = chat.NewConversation(ws.ID)
				}
				_ = chat.Prompt(ctx, cv.ID, p.RequestID, p.Text)
			case relay.KindChatAbort:
				chat.Abort(ctx, p.ConvID)
			case relay.KindChatApprove:
				_ = chat.ReplyPermission(ctx, p.ConvID, p.ApprovalID, p.Response)
			}
		}
		go func() {
			if err := kernel.Start(ctx); err != nil {
				log.Printf("kernel: %v (agent rail unavailable)", err)
				return
			}
			_ = kernel.ConnectBrowser(ctx, agent.BrowserBinding{
				Name:    "zenmium-control",
				URL:     br.URL(),
				Headers: map[string]string{"Authorization": "Bearer " + br.Token()},
			})
			log.Printf("agent rail up (model %s)", kernel.Model())
		}()
	}

	fmt.Fprintf(os.Stderr, "zenmiumd ready (data %s)\n", *dir)
	<-ctx.Done()
	srv.Close()
	br.Close()
}
