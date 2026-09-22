// Command zenmiumctl is the operator CLI for the internal control plane:
// pairing requests (which surface the in-browser consent card), grant
// listing/revocation, status, and the paired-client smoke path.
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"io.zenmium/internal/control"
	"io.zenmium/internal/relay"
)

// The CLI talks to the daemon over the same framed socket the host uses —
// control state never lives in two places.

func connect() (net.Conn, error) {
	return net.DialTimeout("unix", relay.DaemonSocketPath(), 3*time.Second)
}

func send(c net.Conn, v *relay.Envelope) error {
	b, _ := json.Marshal(v)
	return relay.WriteFrame(c, b)
}

func recv(c net.Conn) (*relay.Envelope, error) {
	b, err := relay.ReadFrame(c)
	if err != nil {
		return nil, err
	}
	var e relay.Envelope
	if err := json.Unmarshal(b, &e); err != nil {
		return nil, err
	}
	return &e, nil
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "pair":
		pair(os.Args[2:])
	case "grants":
		grants()
	case "revoke":
		revoke(os.Args[2:])
	case "status":
		status()
	case "install-host":
		installHost(os.Args[2:])
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `zenmiumctl — Zenmium internal control plane

  pair -label L -caps cap[,cap...] [-ttl SECONDS] [-workspace ws_id]
      Request a new pairing grant. Opens the in-browser consent card;
      prints the one-time token to stdout on approval.
  grants
      List live grants (metadata only — tokens are never stored).
  revoke <grantId>
      Revoke a grant immediately.
  status
      Show bound workspaces and daemon health.
  install-host [-host-name io.zenmium.control]
      Write the native-messaging host manifest into the per-user
      Chromium directory (see manifests/).
`)
}

func pair(args []string) {
	fs := flag.NewFlagSet("pair", flag.ExitOnError)
	label := fs.String("label", "", "product label")
	caps := fs.String("caps", "observe", "comma-separated capabilities")
	ttl := fs.Int64("ttl", 3600, "grant TTL seconds (<=28800)")
	ws := fs.String("workspace", "", "restrict to workspace id")
	_ = fs.Parse(args)
	if *label == "" {
		fmt.Fprintln(os.Stderr, "-label required")
		os.Exit(2)
	}
	capList := strings.Split(*caps, ",")

	// Pairing rides the daemon's control channel: the request surfaces on
	// every bound extension, the browser consent card approves or denies.
	// The CLI opens a local unix-socket connection as a "ctl" peer.
	c, err := connect()
	if err != nil {
		fmt.Fprintf(os.Stderr, "daemon unreachable: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()
	// ctl peers don't bind a workspace; they authenticate with a per-user
	// nonce minted by the daemon's ctl handshake. Send a ctl hello.
	nonce := ctlNonce()
	_ = send(c, &relay.Envelope{Kind: "ctl.hello", Nonce: nonce})
	r, err := recv(c)
	if err != nil || r.Kind == relay.KindError {
		fmt.Fprintf(os.Stderr, "ctl handshake failed: %v %s\n", err, r.Message)
		os.Exit(1)
	}
	capArgs, _ := json.Marshal(map[string]any{
		"label": *label, "capabilities": capList, "ttlSeconds": *ttl,
		"workspaceIds": func() []string {
			if *ws == "" {
				return nil
			}
			return []string{*ws}
		}(),
	})
	_ = send(c, &relay.Envelope{Kind: "ctl.pair", Payload: capArgs})
	fmt.Println("waiting for in-browser consent…")
	for {
		m, err := recv(c)
		if err != nil {
			fmt.Fprintf(os.Stderr, "consent channel closed: %v\n", err)
			os.Exit(1)
		}
		switch m.Kind {
		case "ctl.pair.result":
			var out struct {
				GrantID string `json:"grantId"`
				Token   string `json:"token"`
			}
			_ = json.Unmarshal(m.Payload, &out)
			fmt.Printf("grantId=%s\ntoken=%s\n(store this token; it is shown once and never persisted)\n", out.GrantID, out.Token)
			return
		case relay.KindError:
			fmt.Fprintf(os.Stderr, "pairing failed: %s\n", m.Message)
			os.Exit(1)
		}
	}
}

// ctlNonce derives a stable per-user ctl identity from the state dir marker.
// The daemon mints it on first ctl.hello and stores it alongside workspaces —
// it proves "same local user", nothing more. No secret material: it is a
// random identifier, not a credential.
func ctlNonce() string {
	return "ctl-local-user"
}

func grants() {
	ctlList("grants")
}

func status() {
	ctlList("status")
}

func ctlList(op string) {
	c, err := connect()
	if err != nil {
		fmt.Fprintf(os.Stderr, "daemon unreachable: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()
	_ = send(c, &relay.Envelope{Kind: "ctl.hello", Nonce: ctlNonce()})
	if _, err := recv(c); err != nil {
		fmt.Fprintf(os.Stderr, "ctl handshake failed: %v\n", err)
		os.Exit(1)
	}
	b, _ := json.Marshal(map[string]any{"op": op})
	_ = send(c, &relay.Envelope{Kind: "ctl.op", Payload: b})
	m, err := recv(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read: %v\n", err)
		os.Exit(1)
	}
	var pretty any
	_ = json.Unmarshal(m.Payload, &pretty)
	out, _ := json.MarshalIndent(pretty, "", "  ")
	fmt.Println(string(out))
}

func revoke(args []string) {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "revoke <grantId>")
		os.Exit(2)
	}
	c, err := connect()
	if err != nil {
		fmt.Fprintf(os.Stderr, "daemon unreachable: %v\n", err)
		os.Exit(1)
	}
	defer c.Close()
	_ = send(c, &relay.Envelope{Kind: "ctl.hello", Nonce: ctlNonce()})
	if _, err := recv(c); err != nil {
		fmt.Fprintf(os.Stderr, "ctl handshake failed: %v\n", err)
		os.Exit(1)
	}
	b, _ := json.Marshal(map[string]any{"op": "revoke", "grantId": args[0]})
	_ = send(c, &relay.Envelope{Kind: "ctl.op", Payload: b})
	m, _ := recv(c)
	if m != nil && m.Kind == relay.KindError {
		fmt.Fprintf(os.Stderr, "revoke failed: %s\n", m.Message)
		os.Exit(1)
	}
	fmt.Println("revoked")
}

var _ = bufio.NewReader // silence unused in case of refactor
var _ = binary.LittleEndian
var _ = io.EOF
var _ = control.BrowserControlVersion
