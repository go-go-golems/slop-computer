package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/piworker"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// The sample capability: Claude-style model calls through the Pi worker.
// Only admins sample (every view is an admin's today, and the check stays
// for agent views); any model and effort Pi offers may be asked for; slop
// keeps no per-person budget. A call is one SSE response on the target
// origin; page tools round-trip through /_rt/sample/{call}/tools/{use}.

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
	tools  map[string]chan piworker.ToolResult
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

// get finds a call of view v.
func (ss *samples) get(id string, v *rt.View) *sampleCall {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	c := ss.calls[id]
	if c == nil || c.view != v.ID {
		return nil
	}
	return c
}

// waitTool registers a tool use and returns its channel.
func (ss *samples) waitTool(c *sampleCall, use string) chan piworker.ToolResult {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	ch := make(chan piworker.ToolResult, 1)
	c.tools[use] = ch
	return ch
}

func (ss *samples) takeTool(c *sampleCall, use string) chan piworker.ToolResult {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	ch := c.tools[use]
	delete(c.tools, use)
	return ch
}

// sampleView checks a view may sample: granted, an admin, consented.
func (s *Server) sampleView(w http.ResponseWriter, r *http.Request) *rt.View {
	v := s.viewOf(r)
	switch {
	case v == nil:
		httpx.Fail(w, 401, "session_expired", "The view is closed or expired")
	case s.Config.Sample == nil:
		httpx.Fail(w, 503, "sampling_disabled", "This server has no model worker (--pi-worker)")
	case grantedCaps(v)["sample"] == nil:
		httpx.Fail(w, 403, "not_declared", "This app does not declare sample")
	case v.Level < rt.LevelAdmin:
		httpx.Fail(w, 403, "not_granted", "Only admins can use models")
	case s.needConsent(r.Context(), v, "sample") != nil:
		httpx.Fail(w, 403, "not_granted", "The viewer has not allowed sample")
	default:
		return v
	}
	return nil
}

// startSample runs one call: POST /_rt/sample {input, modelTier, model?,
// effort?, tools?, images?} → text/stream of text, thinking, tool, result
// or error events.
func (s *Server) startSample(w http.ResponseWriter, r *http.Request) {
	v := s.sampleView(w, r)
	if v == nil {
		return
	}
	var in struct {
		Input     json.RawMessage  `json:"input"`
		ModelTier string           `json:"modelTier"`
		Model     string           `json:"model"`
		Effort    string           `json:"effort"`
		Tools     []piworker.Tool  `json:"tools"`
		Images    []piworker.Image `json:"images"`
	}
	if err := httpx.Read(w, r, &in, int64(rt.MaxPromptBytes)+12<<20); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {input, modelTier, …}")
		return
	}
	if in.ModelTier == "" || in.ModelTier == "inherit" {
		in.ModelTier = "default"
	}
	req := piworker.Request{CallID: "sc" + randomCallID(), Input: in.Input, Images: in.Images, Tools: in.Tools,
		Options: piworker.Options{ModelTier: in.ModelTier, Model: in.Model, Effort: in.Effort}, MaxRounds: 10}
	if err := piworker.ValidateRequest(req); err != nil {
		code := "invalid_request"
		if strings.Contains(err.Error(), "exceeds") {
			code = "prompt_too_large"
		}
		httpx.Fail(w, 400, code, err.Error())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Fail(w, 500, "unsupported", "Streaming unsupported")
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	call := &sampleCall{view: v.ID, cancel: cancel, tools: map[string]chan piworker.ToolResult{}}
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
		_ = writeSSE(w, typ, 0, data)
		flusher.Flush()
	}
	send("call", map[string]string{"call": req.CallID})
	started := time.Now()
	var used string
	var usage piworker.Usage
	emit := func(e piworker.Event) {
		switch e.Type {
		case "text", "thinking":
			send(e.Type, map[string]string{"text": e.Text, "delta": e.Delta})
		case "usage":
			if e.Usage != nil { // never forwarded to the page
				usage.Input += e.Usage.Input
				usage.Output += e.Usage.Output
				used = e.Usage.Model
			}
		case "result":
			send("result", e.Result)
		case "error":
			send("error", e.Error)
		}
	}
	execute := func(tctx context.Context, e piworker.Event) (piworker.ToolResult, error) {
		ch := s.samples.waitTool(call, e.ToolCallID)
		defer s.samples.takeTool(call, e.ToolCallID)
		send("tool", map[string]any{"use": e.ToolCallID, "name": e.Name, "input": e.Input})
		t := time.NewTimer(toolWait)
		defer t.Stop()
		select {
		case res := <-ch:
			return res, nil
		case <-t.C:
			return piworker.ToolResult{Value: json.RawMessage(`"The page tool did not answer in time"`), IsError: true}, nil
		case <-tctx.Done():
			return piworker.ToolResult{}, tctx.Err()
		}
	}
	err := s.Config.Sample.Sample(ctx, req, emit, execute)
	if err != nil && ctx.Err() == nil {
		send("error", map[string]string{"code": "upstream_error", "message": "The model worker failed"})
		unavailableLog(err)
	}
	_ = s.Store.Audit(store.WithAuditVia(context.Background(), "app "+v.App), v.User, "sample", v.Target, map[string]any{
		"model": used, "tier": in.ModelTier, "asked": in.Model, "input": usage.Input, "output": usage.Output,
		"tools": len(in.Tools), "ms": time.Since(started).Milliseconds(), "cancelled": ctx.Err() != nil})
}

// sampleTool takes a page tool's result: POST /_rt/sample/{call}/tools/{use}.
func (s *Server) sampleTool(w http.ResponseWriter, r *http.Request, callID, use string) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "session_expired", "The view is closed or expired")
		return
	}
	var in struct {
		Value   json.RawMessage `json:"value"`
		IsError bool            `json:"isError"`
	}
	if err := httpx.Read(w, r, &in, int64(rt.MaxToolResultBytes)+1<<10); err != nil || len(in.Value) > rt.MaxToolResultBytes {
		httpx.Fail(w, 400, "invalid_request", "A tool result is {value, isError} of at most 32 KB")
		return
	}
	c := s.samples.get(callID, v)
	var ch chan piworker.ToolResult
	if c != nil {
		ch = s.samples.takeTool(c, use)
	}
	if ch == nil {
		httpx.Fail(w, 404, "not_found", "No such tool use waiting")
		return
	}
	if len(in.Value) == 0 {
		in.Value = json.RawMessage("null")
	}
	ch <- piworker.ToolResult{Value: in.Value, IsError: in.IsError}
	httpx.OK(w, map[string]bool{"ok": true})
}

// cancelSample stops a call: POST /_rt/sample/{call}/cancel.
func (s *Server) cancelSample(w http.ResponseWriter, r *http.Request, callID string) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "session_expired", "The view is closed or expired")
		return
	}
	if c := s.samples.get(callID, v); c != nil {
		c.cancel()
	}
	httpx.OK(w, map[string]bool{"ok": true})
}

// rpcSampleLimits answers sample.limits, with the models Pi offers (slop's
// addition: full model choice for admins).
func (s *Server) rpcSampleLimits(_ context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	out := map[string]any{"maxPromptBytes": rt.MaxPromptBytes, "tools": map[string]int{"maxCount": 16},
		"modelTiers": []string{"inherit", "quick", "default", "complex"}, "models": []piworker.Model{}, "available": false}
	if s.Config.Sample == nil || v.Level < rt.LevelAdmin {
		return out, nil
	}
	out["available"] = true
	out["models"] = s.Config.Sample.Models()
	if v.Caps.Images {
		out["images"] = map[string]any{"maxCount": 4, "maxInputBytes": 8 << 20, "mediaTypes": []string{"image/jpeg", "image/png", "image/webp", "image/gif"}}
	}
	return out, nil
}

func randomCallID() string { return store.RandomHex(12) }
