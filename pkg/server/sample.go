package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop/pkg/httpx"
	"github.com/go-go-golems/slop/pkg/ids"
	"github.com/go-go-golems/slop/pkg/llm"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/system"
)

// The sample capability in pages, ported from slop-computer's rt_sample.go:
// one streamed POST to /_rt/sample per call, page tools round-tripping
// through /_rt/sample/{call}/tools/{use}. v3 adds the checks of guide §9:
// the policy for the viewer's audience (grantedCaps), the payer's LLM
// access, and the monthly budget, charged after the call.

// toolWait bounds how long a call waits for one page tool's result.
const toolWait = 150 * time.Second

// samples holds the calls in flight: their cancel functions and the tool
// results they wait for.
type samples struct {
	mu    sync.Mutex
	calls map[string]*sampleCall
}

type sampleCall struct {
	view   string
	cancel context.CancelFunc
	tools  map[string]chan llm.ToolResult
}

func (ss *samples) add(id string, c *sampleCall) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.calls == nil {
		ss.calls = map[string]*sampleCall{}
	}
	ss.calls[id] = c
}

func (ss *samples) remove(id string) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	delete(ss.calls, id)
}

func (ss *samples) get(id string, v *rt.View) *sampleCall {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	c := ss.calls[id]
	if c == nil || c.view != v.ID {
		return nil
	}
	return c
}

func (ss *samples) waitTool(c *sampleCall, use string) chan llm.ToolResult {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	ch := make(chan llm.ToolResult, 1)
	c.tools[use] = ch
	return ch
}

func (ss *samples) takeTool(c *sampleCall, use string) chan llm.ToolResult {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	ch := c.tools[use]
	delete(c.tools, use)
	return ch
}

// viewLLM is what the viewer may spend: the payer is the viewing person.
func (s *Server) viewLLM(ctx context.Context, v *rt.View) system.LLM {
	if v.User == "" || !v.Policy["sample"] {
		return system.LLM{}
	}
	return s.Sys.LLMFor(ctx, v.User, v.Role)
}

// sampleView checks a view may sample now.
func (s *Server) sampleView(w http.ResponseWriter, r *http.Request) (*rt.View, bool) {
	v := s.viewOf(r)
	switch {
	case v == nil:
		httpx.Fail(w, 401, "session_expired", "the view is closed or expired")
		return nil, false
	case s.Env.A == nil || s.Env.A.LLM == nil:
		httpx.Fail(w, 503, "unavailable", "this server has no model backend")
		return nil, false
	case !v.Caps.Declared["sample"]:
		httpx.Fail(w, 403, "not_declared", "this app does not declare sample")
		return nil, false
	case grantedCaps(v)["sample"] == nil:
		httpx.Fail(w, 403, "not_granted", "this app may not use the LLM for "+v.Role)
		return nil, false
	}
	l := s.viewLLM(r.Context(), v)
	if !l.Allowed {
		httpx.Fail(w, 403, "permission_denied", "no LLM access")
		return nil, false
	}
	if l.Remaining != nil && *l.Remaining <= 0 {
		httpx.Fail(w, 429, "quota_exceeded", "token budget used up for this month")
		return nil, false
	}
	return v, true
}

// startSample runs one call: POST /_rt/sample {input, modelTier, model?,
// effort?, tools?, images?} → a stream of call, text, thinking, tool,
// result or error events.
func (s *Server) startSample(w http.ResponseWriter, r *http.Request) {
	v, ok := s.sampleView(w, r)
	if !ok {
		return
	}
	var in struct {
		Input     json.RawMessage `json:"input"`
		ModelTier string          `json:"modelTier"`
		Model     string          `json:"model"`
		Effort    string          `json:"effort"`
		MaxTokens int             `json:"maxTokens"`
		Tools     []llm.Tool      `json:"tools"`
		Images    []llm.Image     `json:"images"`
	}
	if err := httpx.Read(r, &in, int64(rt.MaxPromptBytes)+12<<20); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {input, modelTier, …}")
		return
	}
	if in.ModelTier == "" || in.ModelTier == "inherit" {
		in.ModelTier = "default"
	}
	if !v.Caps.Images {
		in.Images = nil
	}
	req := llm.Request{CallID: "sc" + ids.New("", 12), Input: in.Input, Images: in.Images, Tools: in.Tools,
		Options: llm.Options{ModelTier: in.ModelTier, Model: in.Model, Effort: in.Effort}, MaxRounds: 10, MaxOutputTokens: in.MaxTokens}
	if err := llm.ValidateRequest(req); err != nil {
		code := "invalid_argument"
		if strings.Contains(err.Error(), "exceeds") {
			code = "prompt_too_large"
		}
		httpx.Fail(w, 400, code, err.Error())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, 500, "unsupported", "streaming unsupported")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	call := &sampleCall{view: v.ID, cancel: cancel, tools: map[string]chan llm.ToolResult{}}
	s.samples.add(req.CallID, call)
	defer s.samples.remove(req.CallID)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	var mu sync.Mutex
	send := func(typ string, data any) {
		mu.Lock()
		defer mu.Unlock()
		_ = writeSSE(w, typ, data)
		flusher.Flush()
	}
	send("call", map[string]string{"call": req.CallID})
	var usage llm.Usage
	emit := func(e llm.Event) {
		switch e.Type {
		case "text", "thinking":
			send(e.Type, map[string]string{"text": e.Text, "delta": e.Delta})
		case "usage":
			if e.Usage != nil { // never forwarded to the page
				usage.Input += e.Usage.Input
				usage.Output += e.Usage.Output
				usage.Model = e.Usage.Model
			}
		case "result":
			send("result", e.Result)
		case "error":
			send("error", e.Error)
		}
	}
	execute := func(tctx context.Context, e llm.Event) (llm.ToolResult, error) {
		ch := s.samples.waitTool(call, e.ToolCallID)
		defer s.samples.takeTool(call, e.ToolCallID)
		send("tool", map[string]any{"use": e.ToolCallID, "name": e.Name, "input": e.Input})
		t := time.NewTimer(toolWait)
		defer t.Stop()
		select {
		case res := <-ch:
			return res, nil
		case <-t.C:
			return llm.ToolResult{Value: json.RawMessage(`"The page tool did not answer in time"`), IsError: true}, nil
		case <-tctx.Done():
			return llm.ToolResult{}, tctx.Err()
		}
	}
	err := s.Env.A.LLM.Sample(ctx, req, emit, execute)
	if err != nil && ctx.Err() == nil {
		send("error", map[string]string{"code": "upstream_error", "message": "the model failed"})
	}
	// A call that started with budget left completes, even past it.
	if n := usage.Input + usage.Output; n > 0 {
		_ = s.Sys.AddLLMUsage(context.Background(), v.User, n)
	}
}

// sampleTool takes a page tool's result: POST /_rt/sample/{call}/tools/{use}.
func (s *Server) sampleTool(w http.ResponseWriter, r *http.Request, callID, use string) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "session_expired", "the view is closed or expired")
		return
	}
	var in struct {
		Value   json.RawMessage `json:"value"`
		IsError bool            `json:"isError"`
	}
	if err := httpx.Read(r, &in, int64(rt.MaxToolResultBytes)+1<<10); err != nil || len(in.Value) > rt.MaxToolResultBytes {
		httpx.Fail(w, 400, "invalid_argument", "a tool result is {value, isError} of at most 32 KB")
		return
	}
	c := s.samples.get(callID, v)
	var ch chan llm.ToolResult
	if c != nil {
		ch = s.samples.takeTool(c, use)
	}
	if ch == nil {
		httpx.Fail(w, 404, "not_found", "no such tool use waiting")
		return
	}
	if len(in.Value) == 0 {
		in.Value = json.RawMessage("null")
	}
	ch <- llm.ToolResult{Value: in.Value, IsError: in.IsError}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// cancelSample stops a call: POST /_rt/sample/{call}/cancel.
func (s *Server) cancelSample(w http.ResponseWriter, r *http.Request, callID string) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "session_expired", "the view is closed or expired")
		return
	}
	if c := s.samples.get(callID, v); c != nil {
		c.cancel()
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// serveSampleRoute dispatches /_rt/sample… on the sandbox origin.
func (s *Server) serveSampleRoute(w http.ResponseWriter, r *http.Request, p string) {
	rest := strings.TrimPrefix(strings.TrimPrefix(p, "/_rt/sample"), "/")
	switch parts := strings.Split(rest, "/"); {
	case rest == "":
		s.startSample(w, r)
	case len(parts) == 2 && parts[1] == "cancel":
		s.cancelSample(w, r, parts[0])
	case len(parts) == 3 && parts[1] == "tools":
		s.sampleTool(w, r, parts[0], parts[2])
	default:
		httpx.Fail(w, 404, "not_found", "no such sample route")
	}
}

// rpcSampleLimits answers sample.limits: whether this viewer may sample,
// what is left this month, and the models.
func (s *Server) rpcSampleLimits(ctx context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	l := s.viewLLM(ctx, v)
	out := map[string]any{"maxPromptBytes": rt.MaxPromptBytes, "tools": map[string]int{"maxCount": 16},
		"modelTiers": []string{"inherit", "quick", "default", "complex"}, "models": []llm.Model{},
		"available": false, "allowed": l.Allowed, "remaining": l.Remaining}
	if s.Env.A == nil || s.Env.A.LLM == nil || !l.Allowed {
		return out, nil
	}
	out["available"] = l.Remaining == nil || *l.Remaining > 0
	out["models"] = s.Env.A.LLM.Models()
	if v.Caps.Images {
		out["images"] = map[string]any{"maxCount": 4, "maxInputBytes": 8 << 20, "mediaTypes": []string{"image/jpeg", "image/png", "image/webp", "image/gif"}}
	}
	return out, nil
}
