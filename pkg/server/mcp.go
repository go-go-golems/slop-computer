package server

// The MCP door (SLOP3-009 step 6): POST /mcp on the main host speaks the
// Model Context Protocol's streamable HTTP transport, generated from the
// verb table. Every verb the caller's token may call is a tool (its name
// with "_" for ".", its input and output schemas, readOnlyHint for read
// verbs); a call runs the verb through verbs.Call, as the HTTP API does,
// with via "mcp". A stream verb called with a progress token answers as
// SSE: one notifications/progress per part, then the response.
//
// Only bearer tokens are accepted: a browser session's cookie would make
// the endpoint reachable across sites. There are no server-initiated
// messages, so GET has no stream and sessions are not tracked.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// mcpVersions are the protocol revisions the door speaks, newest first.
var mcpVersions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

// JSON-RPC error codes.
const (
	rpcParseError     = -32700
	rpcInvalidRequest = -32600
	rpcNoMethod       = -32601
	rpcInvalidParams  = -32602
)

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *mcpError       `json:"error,omitempty"`
}

func (s *Server) mcpRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /mcp", s.mcpPost)
	noStream := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", "POST")
		httpx.Fail(w, 405, "invalid_argument", "this MCP server sends no messages of its own: POST only")
	}
	m.HandleFunc("GET /mcp", noStream)
	m.HandleFunc("DELETE /mcp", noStream)
}

// mcpPrincipal authenticates an MCP request: a bearer token, from no
// other site's page.
func (s *Server) mcpPrincipal(w http.ResponseWriter, r *http.Request) *access.Principal {
	if o := r.Header.Get("Origin"); o != "" {
		if u, err := url.Parse(o); err != nil || u.Host != s.Cfg.Hosts.Main {
			httpx.Fail(w, 403, "permission_denied", "MCP requests from other sites' pages are refused")
			return nil
		}
	}
	p, _, err := s.principalOf(r)
	if err != nil || p == nil || p.Kind != access.KindToken {
		w.Header().Set("WWW-Authenticate", `Bearer realm="slop"`)
		httpx.Fail(w, 401, "unauthenticated", "send Authorization: Bearer <token> (slop token.new)")
		return nil
	}
	p.Via = "mcp"
	return p
}

func (s *Server) mcpPost(w http.ResponseWriter, r *http.Request) {
	p := s.mcpPrincipal(w, r)
	if p == nil {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxAPIBody))
	if err != nil {
		httpx.Fail(w, 400, "invalid_argument", "unreadable body")
		return
	}
	var req mcpRequest
	if t := strings.TrimSpace(string(raw)); strings.HasPrefix(t, "[") {
		mcpReply(w, nil, nil, &mcpError{rpcInvalidRequest, "batches are not supported"})
		return
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		mcpReply(w, nil, nil, &mcpError{rpcParseError, "not a JSON-RPC message"})
		return
	}
	if len(req.ID) == 0 || req.Method == "" {
		// a notification (initialized, cancelled) or a response: nothing to answer
		w.WriteHeader(http.StatusAccepted)
		return
	}
	s.People.TouchPerson(r.Context(), p.ID())
	switch req.Method {
	case "initialize":
		var in struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &in)
		version := mcpVersions[0]
		for _, v := range mcpVersions {
			if v == in.ProtocolVersion {
				version = v
			}
		}
		mcpReply(w, req.ID, map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]string{"name": "slop", "title": "slop-computer", "version": "3"},
			"instructions": "Each tool is a slop verb (store_new is store.new). Tools act as the token's person, " +
				"with its scopes; read-only tools are marked readOnlyHint.",
		}, nil)
	case "ping":
		mcpReply(w, req.ID, map[string]any{}, nil)
	case "tools/list":
		tools := []verbs.Tool{}
		for _, v := range s.Verbs.All() {
			if s.Verbs.Callable(p, v) {
				tools = append(tools, v.Tool())
			}
		}
		mcpReply(w, req.ID, map[string]any{"tools": tools}, nil)
	case "tools/call":
		s.mcpCall(w, r, p, req)
	default:
		mcpReply(w, req.ID, nil, &mcpError{rpcNoMethod, "no method " + req.Method})
	}
}

// mcpVerb is the verb a tool name stands for.
func (s *Server) mcpVerb(tool string) (*verbs.Verb, bool) {
	for _, v := range s.Verbs.All() {
		if v.Tool().Name == tool {
			return v, true
		}
	}
	return nil, false
}

// mcpCall runs tools/call: the verb as p, its result as content (and as
// structured content when it is an object), a verb's refusal as a tool
// error the model can read.
func (s *Server) mcpCall(w http.ResponseWriter, r *http.Request, p *access.Principal, req mcpRequest) {
	var in struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
		Meta      struct {
			ProgressToken json.RawMessage `json:"progressToken"`
		} `json:"_meta"`
	}
	if err := json.Unmarshal(req.Params, &in); err != nil {
		mcpReply(w, req.ID, nil, &mcpError{rpcInvalidParams, "tools/call takes {name, arguments}"})
		return
	}
	v, ok := s.mcpVerb(in.Name)
	if !ok {
		mcpReply(w, req.ID, nil, &mcpError{rpcInvalidParams, "no tool " + in.Name})
		return
	}
	ctx := withPrincipal(r.Context(), p)
	stream := v.Effect == verbs.EffectStream && len(in.Meta.ProgressToken) > 0 &&
		strings.Contains(r.Header.Get("Accept"), "text/event-stream")
	var mu sync.Mutex
	started := false
	sse := func(msg any) {
		if !started {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Accel-Buffering", "no")
			w.WriteHeader(http.StatusOK)
			started = true
		}
		_ = writeSSE(w, "message", msg)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	if stream {
		n := 0
		ctx = verbs.WithEmit(ctx, func(part any) error {
			mu.Lock()
			defer mu.Unlock()
			if ctx.Err() != nil {
				return ctx.Err()
			}
			n++
			sse(map[string]any{"jsonrpc": "2.0", "method": "notifications/progress",
				"params": map[string]any{"progressToken": in.Meta.ProgressToken, "progress": n, "message": partMessage(part)}})
			return nil
		})
	}
	res := toolResult(s.callTool(ctx, p, v.Name, in.Arguments))
	mu.Lock()
	defer mu.Unlock()
	if started {
		sse(mcpResponse{JSONRPC: "2.0", ID: req.ID, Result: res})
		return
	}
	mcpReply(w, req.ID, res, nil)
}

func (s *Server) callTool(ctx context.Context, p *access.Principal, verb string, args map[string]any) (any, error) {
	return s.Verbs.Call(ctx, p, verb, verbs.Args(args))
}

// partMessage is a part as a progress message: its delta when it has one.
func partMessage(part any) string {
	b, _ := json.Marshal(part)
	var d struct{ Delta string }
	if json.Unmarshal(b, &d) == nil && d.Delta != "" {
		return d.Delta
	}
	return string(b)
}

// toolResult is a verb's answer as an MCP tool result.
func toolResult(res any, err error) map[string]any {
	if err != nil {
		e := verbs.AsError(err)
		return map[string]any{"isError": true, "content": []map[string]string{{"type": "text", "text": e.Code + ": " + e.Message}}}
	}
	b, _ := json.Marshal(res)
	out := map[string]any{"content": []map[string]string{{"type": "text", "text": string(b)}}}
	var obj map[string]any
	if json.Unmarshal(b, &obj) == nil && obj != nil {
		out["structuredContent"] = obj
	}
	return out
}

func mcpReply(w http.ResponseWriter, id json.RawMessage, result any, e *mcpError) {
	if id == nil {
		id = json.RawMessage("null")
	}
	httpx.JSON(w, 200, mcpResponse{JSONRPC: "2.0", ID: id, Result: result, Error: e})
}
