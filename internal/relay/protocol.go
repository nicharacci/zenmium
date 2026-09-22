package relay

import "encoding/json"

// Protocol between the component extension (via zenmium-control-host over
// native messaging) and zenmiumd (over the per-user socket). One channel per
// native-messaging connection; messages are JSON objects discriminated by
// "kind". This is the transport port of the Electron CONTROL_IPC surface —
// verbs keep their v1 names.

const (
	// extension -> daemon
	KindHello       = "hello"        // binds this connection to a workspace
	KindExecResult  = "exec.result"  // executor result for a daemon request
	KindWatched     = "watched"      // tab/navigation watcher event
	KindPairRespond = "pair.respond" // consent decision from pairing UI
	KindChatSend    = "chat.send"    // dock -> daemon prompt
	KindChatAbort   = "chat.abort"
	KindChatApprove = "chat.approve" // approval-card decision
	KindDockState   = "dock.state"   // dock open/close

	// daemon -> extension
	KindBound       = "bound"        // hello reply: workspace binding
	KindExec        = "exec"         // daemon -> executor action request
	KindPairRequest = "pair.request" // pending consent (open pairing UI)
	KindChatEvent   = "chat.event"   // normalized agent stream event
	KindAuthRequest = "auth.request" // authentication-broker surface
	KindError       = "error"

	// ctl peers (zenmiumctl) — local-user CLI over the same socket. The
	// socket's 0600 mode is the auth boundary; the nonce is an identifier,
	// not a credential.
	KindCtlHello      = "ctl.hello"
	KindCtlBound      = "ctl.bound"
	KindCtlPair       = "ctl.pair"        // request pairing (consent-gated)
	KindCtlPairResult = "ctl.pair.result" // minted grant, token shown once
	KindCtlOp         = "ctl.op"          // grants | status | revoke
	KindCtlOpResult   = "ctl.op.result"
)

// Envelope is the single wire shape in both directions.
type Envelope struct {
	Kind string `json:"kind"`

	// hello / bound
	Nonce       string `json:"nonce,omitempty"`
	ProfileID   string `json:"profileId,omitempty"`
	ProfileName string `json:"profileName,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`

	// exec / exec.result
	ID        string          `json:"id,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Command   string          `json:"command,omitempty"`
	Args      json.RawMessage `json:"args,omitempty"`
	OK        *bool           `json:"ok,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Code      string          `json:"code,omitempty"`
	Message   string          `json:"message,omitempty"`
	Uncertain bool            `json:"uncertain,omitempty"`

	// watched
	URL   string `json:"url,omitempty"`
	TabID int64  `json:"tabId,omitempty"`

	// pair.request / pair.respond
	PairID       string   `json:"pairId,omitempty"`
	Label        string   `json:"label,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	TTLSeconds   int64    `json:"ttlSeconds,omitempty"`
	Approve      bool     `json:"approve,omitempty"`

	// chat.* / auth.request payloads ride through as raw JSON so the daemon's
	// agent package owns their schema.
	Payload json.RawMessage `json:"payload,omitempty"`
}
