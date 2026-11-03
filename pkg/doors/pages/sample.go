package pages

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	capsample "github.com/go-go-golems/slop-computer/pkg/caps/sample"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/rt"
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

// sampler is the sample capability on this server's backend (set after
// the server is built, so read per call).
func (s *Door) sampler() *capsample.Sampler {
	sp := &capsample.Sampler{Ledger: s.Ledger}
	if s.A != nil {
		sp.Backend = s.A.LLM
	}
	return sp
}

// viewLLM is what the viewer may spend: the payer is the viewing person,
// under the app's policy for their audience.
func (s *Door) viewLLM(ctx context.Context, v *rt.View) llm.LLM {
	if !v.Policy["sample"] {
		return llm.LLM{}
	}
	return s.sampler().Limits(ctx, v.User, v.Role)
}

// sampleStatus is the HTTP status of a sample refusal.
func sampleStatus(code string) int {
	switch code {
	case "unavailable":
		return 503
	case "quota_exceeded":
		return 429
	case "permission_denied", "not_granted", "not_declared":
		return 403
	}
	return 400
}

// sampleView checks a view may sample now.
func (s *Door) sampleView(w http.ResponseWriter, r *http.Request) (*rt.View, llm.LLM, bool) {
	v := s.viewOf(r)
	switch {
	case v == nil:
		httpx.Fail(w, 401, "session_expired", "the view is closed or expired")
		return nil, llm.LLM{}, false
	case !s.sampler().Available():
		httpx.Fail(w, 503, "unavailable", "this server has no model backend")
		return nil, llm.LLM{}, false
	case !v.Caps.Declared["sample"]:
		httpx.Fail(w, 403, "not_declared", "this app does not declare sample")
		return nil, llm.LLM{}, false
	case grantedCaps(v)["sample"] == nil:
		httpx.Fail(w, 403, "not_granted", "this app may not use the LLM for "+v.Role)
		return nil, llm.LLM{}, false
	case !v.Policy["sample"]:
		httpx.Fail(w, 403, "permission_denied", "no LLM access")
		return nil, llm.LLM{}, false
	}
	l, err := s.sampler().Check(r.Context(), v.User, v.Role)
	var f *llm.Failure
	if errors.As(err, &f) {
		if f.Code == "permission_denied" {
			f.Message = "no LLM access"
		}
		httpx.Fail(w, sampleStatus(f.Code), f.Code, f.Message)
		return nil, l, false
	}
	return v, l, true
}

// startSample runs one call: POST /_rt/sample {input, modelTier, model?,
// effort?, tools?, images?} → a stream of call, text, thinking, tool,
// result or error events.
func (s *Door) startSample(w http.ResponseWriter, r *http.Request) {
	v, l, ok := s.sampleView(w, r)
	if !ok {
		return
	}
	var in llm.In
	if err := httpx.Read(r, &in, int64(rt.MaxPromptBytes)+12<<20); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {input, modelTier, …}")
		return
	}
	req, err := llm.NewRequest("sc", in, v.Caps.Images)
	var f *llm.Failure
	if errors.As(err, &f) {
		httpx.Fail(w, 400, f.Code, f.Message)
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
		_ = web.WriteSSE(w, typ, data)
		flusher.Flush()
	}
	send("call", map[string]string{"call": req.CallID})
	emit := func(e llm.Event) {
		switch e.Type {
		case "text", "thinking":
			send(e.Type, map[string]string{"text": e.Text, "delta": e.Delta})
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
	_, err = s.sampler().Run(ctx, v.User, l, req, emit, execute)
	switch {
	case errors.As(err, &f) && f.Code == "quota_exceeded":
		send("error", map[string]string{"code": f.Code, "message": f.Message})
	case err != nil && ctx.Err() == nil:
		send("error", map[string]string{"code": "upstream_error", "message": "the model failed"})
	}
}

// sampleTool takes a page tool's result: POST /_rt/sample/{call}/tools/{use}.
func (s *Door) sampleTool(w http.ResponseWriter, r *http.Request, callID, use string) {
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
func (s *Door) cancelSample(w http.ResponseWriter, r *http.Request, callID string) {
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
func (s *Door) serveSampleRoute(w http.ResponseWriter, r *http.Request, p string) {
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
func (s *Door) rpcSampleLimits(ctx context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	l := s.viewLLM(ctx, v)
	out := map[string]any{"maxPromptBytes": rt.MaxPromptBytes, "tools": map[string]int{"maxCount": 16},
		"modelTiers": []string{"inherit", "quick", "default", "complex"}, "models": []llm.Model{},
		"available": false, "allowed": l.Allowed, "remaining": l.Remaining}
	if !s.sampler().Available() || !l.Allowed {
		return out, nil
	}
	out["available"] = l.Remaining == nil || *l.Remaining > 0
	out["models"] = s.sampler().Models()
	if v.Caps.Images {
		out["images"] = map[string]any{"maxCount": 4, "maxInputBytes": 8 << 20, "mediaTypes": []string{"image/jpeg", "image/png", "image/webp", "image/gif"}}
	}
	return out, nil
}
