package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"io.zenmium/internal/control"
)

// JSON-RPC 2.0 surface, protocol version 2025-03-26, ported from
// browser-control-bridge.ts. Error codes: -32600 invalid request,
// -32601 method/tool not found, -32602 invalid params, -32603 internal.

const protocolVersion = "2025-03-26"

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// CONTROL_MCP_TOOLS, ported verbatim — the product-visible tool surface.
var toolDefs = []map[string]any{
	{
		"name":        "zenmium_capabilities",
		"description": "List the browser-control capabilities available to this grant (observe, navigate, interact, tabs, downloads, authenticate, cdp).",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
	{
		"name":        "zenmium_session",
		"description": "Create a control session on a workspace, or fetch an existing session's status.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"op":          map[string]any{"type": "string", "enum": []string{"create", "status"}},
				"workspaceId": map[string]any{"type": "string"},
				"sessionId":   map[string]any{"type": "string"},
			},
			"required": []string{"op"},
		},
	},
	{
		"name":        "zenmium_action",
		"description": "Execute one browser-control action against a session: observe, navigate, click, fill, press, scroll, tab.create, tab.close, tab.adopt, download, authenticate, cdp, cdp.target.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"sessionId": map[string]any{"type": "string"},
				"requestId": map[string]any{"type": "string"},
				"command":   map[string]any{"type": "string"},
				"args":      map[string]any{"type": "object"},
				"revision":  map[string]any{"type": "integer"},
			},
			"required": []string{"sessionId", "requestId", "command"},
		},
	},
	{
		"name":        "zenmium_events",
		"description": "Page a session's event journal after a cursor.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"sessionId": map[string]any{"type": "string"},
				"afterSeq":  map[string]any{"type": "integer"},
				"limit":     map[string]any{"type": "integer"},
			},
			"required": []string{"sessionId"},
		},
	},
}

func (s *Server) handleRPC(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	var req rpcRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		writeRPC(w, nil, nil, &rpcError{Code: -32700, Message: "parse error"})
		return
	}
	if req.JSONRPC != "2.0" {
		writeRPC(w, req.ID, nil, &rpcError{Code: -32600, Message: "jsonrpc must be 2.0"})
		return
	}
	switch req.Method {
	case "initialize":
		writeRPC(w, req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "zenmium-control", "version": fmt.Sprint(control.BrowserControlVersion)},
		}, nil)
	case "notifications/initialized":
		w.WriteHeader(http.StatusAccepted)
	case "tools/list":
		writeRPC(w, req.ID, map[string]any{"tools": toolDefs}, nil)
	case "tools/call":
		s.handleToolCall(ctx, w, req)
	default:
		writeRPC(w, req.ID, nil, &rpcError{Code: -32601, Message: "method not found"})
	}
}

func (s *Server) handleToolCall(ctx context.Context, w http.ResponseWriter, req rpcRequest) {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		writeRPC(w, req.ID, nil, &rpcError{Code: -32602, Message: "bad params"})
		return
	}
	// The bearer token in the bridge is the bridge's own — the product grant
	// token rides as an argument (v1 behavior: tool args carry grantToken).
	var args struct {
		GrantToken  string          `json:"grantToken"`
		WorkspaceID string          `json:"workspaceId"`
		SessionID   string          `json:"sessionId"`
		RequestID   string          `json:"requestId"`
		Command     control.Command `json:"command"`
		Args        json.RawMessage `json:"args"`
		Revision    *int64          `json:"revision"`
		AfterSeq    int64           `json:"afterSeq"`
		Limit       int             `json:"limit"`
		Op          string          `json:"op"`
	}
	if len(params.Arguments) > 0 {
		if err := json.Unmarshal(params.Arguments, &args); err != nil {
			writeToolError(w, req.ID, control.CodeInvalidJSON, err.Error())
			return
		}
	}
	if args.GrantToken == "" {
		writeToolError(w, req.ID, control.CodeUnauthorized, "grantToken required")
		return
	}
	g, aerr := s.svc.Authorize(args.GrantToken)
	if aerr != nil {
		writeToolError(w, req.ID, aerr.Code, aerr.Message)
		return
	}
	switch params.Name {
	case "zenmium_capabilities":
		caps := make([]string, len(g.Capabilities))
		for i, c := range g.Capabilities {
			caps[i] = string(c)
		}
		writeToolResult(w, req.ID, map[string]any{
			"version":      control.BrowserControlVersion,
			"capabilities": caps,
			"expiresAt":    g.ExpiresAt,
		})
	case "zenmium_session":
		switch args.Op {
		case "create":
			if args.WorkspaceID == "" {
				writeToolError(w, req.ID, control.CodeInvalidRequest, "workspaceId required")
				return
			}
			sess, e := s.svc.CreateSession(g, args.WorkspaceID)
			if e != nil {
				writeToolError(w, req.ID, e.Code, e.Message)
				return
			}
			writeToolResult(w, req.ID, sess)
		case "status":
			st, e := s.svc.Status(args.SessionID)
			if e != nil {
				writeToolError(w, req.ID, e.Code, e.Message)
				return
			}
			writeToolResult(w, req.ID, st)
		default:
			writeToolError(w, req.ID, control.CodeInvalidRequest, "op must be create|status")
		}
	case "zenmium_action":
		body, _ := json.Marshal(map[string]any{
			"sessionId": args.SessionID, "requestId": args.RequestID,
			"command": args.Command, "args": args.Args, "revision": args.Revision,
		})
		rcpt, e := s.svc.Execute(ctx, g, body)
		if e != nil {
			writeToolError(w, req.ID, e.Code, e.Message)
			return
		}
		writeToolResult(w, req.ID, rcpt)
	case "zenmium_events":
		items, next, reset, e := s.svc.Events(args.SessionID, args.AfterSeq, args.Limit)
		if e != nil {
			writeToolError(w, req.ID, e.Code, e.Message)
			return
		}
		writeToolResult(w, req.ID, map[string]any{"events": items, "next": next, "resetRequired": reset})
	default:
		writeRPC(w, req.ID, nil, &rpcError{Code: -32601, Message: "unknown tool", Data: control.CodeUnknownTool})
	}
}

func writeRPC(w http.ResponseWriter, id json.RawMessage, result any, e *rpcError) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: id, Result: result, Error: e})
}

func writeToolResult(w http.ResponseWriter, id json.RawMessage, v any) {
	b, _ := json.Marshal(v)
	writeRPC(w, id, map[string]any{
		"content": []map[string]any{{"type": "text", "text": string(b)}},
	}, nil)
}

func writeToolError(w http.ResponseWriter, id json.RawMessage, code control.Code, msg string) {
	writeRPC(w, id, map[string]any{
		"isError": true,
		"content": []map[string]any{{"type": "text", "text": string(code) + ": " + msg}},
	}, nil)
}
