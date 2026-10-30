package gepp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-go-golems/geppetto/pkg/steps/ai/providers/pi"
	"github.com/go-go-golems/slop-computer/pkg/piworker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// provider is a scripted OpenAI Chat Completions server: each request gets
// the next response, and its body is kept.
type provider struct {
	t      *testing.T
	mu     sync.Mutex
	script []func(w http.ResponseWriter)
	bodies []map[string]any
	header []http.Header
}

func (p *provider) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	p.mu.Lock()
	p.bodies = append(p.bodies, body)
	p.header = append(p.header, r.Header.Clone())
	i := len(p.bodies) - 1
	p.mu.Unlock()
	if i >= len(p.script) {
		p.t.Errorf("unexpected request %d", i)
		http.Error(w, "no script", 500)
		return
	}
	p.script[i](w)
}

func chunk(delta map[string]any, finish string) string {
	c := map[string]any{"index": 0, "delta": delta}
	if finish != "" {
		c["finish_reason"] = finish
	}
	b, _ := json.Marshal(map[string]any{"id": "c", "model": "m", "choices": []any{c}})
	return string(b)
}

func stream(chunks ...string) func(w http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, c := range chunks {
			_, _ = io.WriteString(w, "data: "+c+"\n\n")
		}
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}
}

func text(parts ...string) func(w http.ResponseWriter) {
	var cs []string
	for _, p := range parts {
		cs = append(cs, chunk(map[string]any{"content": p}, ""))
	}
	cs = append(cs, chunk(map[string]any{}, "stop"), usage(10, 5))
	return stream(cs...)
}

func usage(in, out int) string {
	b, _ := json.Marshal(map[string]any{"id": "c", "model": "m", "choices": []any{}, "usage": map[string]any{"prompt_tokens": in, "completion_tokens": out, "total_tokens": in + out}})
	return string(b)
}

func toolCalls(say string, calls ...[3]string) func(w http.ResponseWriter) {
	var cs []string
	if say != "" {
		cs = append(cs, chunk(map[string]any{"content": say}, ""))
	}
	for i, c := range calls {
		cs = append(cs, chunk(map[string]any{"tool_calls": []any{map[string]any{"index": i, "id": c[0], "type": "function",
			"function": map[string]any{"name": c[1], "arguments": c[2]}}}}, ""))
	}
	cs = append(cs, chunk(map[string]any{}, "tool_calls"), usage(10, 7))
	return stream(cs...)
}

func status(code int, body string) func(w http.ResponseWriter) {
	return func(w http.ResponseWriter) { http.Error(w, body, code) }
}

func writeJSON(t *testing.T, path string, v any) {
	b, err := json.Marshal(v)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, b, 0o600))
}

// setup returns a backend whose lunaroute provider is the scripted server.
func setup(t *testing.T, tiers map[string]string, script ...func(w http.ResponseWriter)) (*Backend, *provider) {
	t.Helper()
	p := &provider{t: t, script: script}
	srv := httptest.NewServer(p)
	t.Cleanup(srv.Close)
	dir := t.TempDir()
	writeJSON(t, filepath.Join(dir, "settings.json"), map[string]any{"defaultProvider": "lunaroute", "defaultModel": "big", "defaultThinkingLevel": "medium", "enabledModels": []string{"lunaroute/big"}})
	writeJSON(t, filepath.Join(dir, "models.json"), map[string]any{"providers": map[string]any{"lunaroute": map[string]any{
		"baseUrl": srv.URL + "/v1", "api": "openai-completions", "apiKey": "test-key",
		"models": []any{
			map[string]any{"id": "big", "reasoning": true, "input": []string{"text"}, "maxTokens": 100000},
			map[string]any{"id": "small", "reasoning": true, "input": []string{"text", "image"}, "maxTokens": 1000},
		},
	}}})
	b, err := New(Config{AgentDir: dir, Tiers: tiers, Options: []pi.Option{pi.WithLocalProviders()}})
	require.NoError(t, err)
	return b, p
}

type recorder struct {
	mu     sync.Mutex
	events []piworker.Event
}

func (r *recorder) emit(e piworker.Event) { r.mu.Lock(); r.events = append(r.events, e); r.mu.Unlock() }

func (r *recorder) of(typ string) []piworker.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []piworker.Event
	for _, e := range r.events {
		if e.Type == typ {
			out = append(out, e)
		}
	}
	return out
}

func (r *recorder) last(typ string) piworker.Event {
	es := r.of(typ)
	if len(es) == 0 {
		return piworker.Event{}
	}
	return es[len(es)-1]
}

func req(input string, o piworker.Options, tools ...piworker.Tool) piworker.Request {
	in, _ := json.Marshal(input)
	if strings.HasPrefix(input, "[") {
		in = json.RawMessage(input)
	}
	if o.ModelTier == "" {
		o.ModelTier = "default"
	}
	return piworker.Request{CallID: "sc1", Input: in, Options: o, Tools: tools, MaxRounds: 10}
}

var weather = piworker.Tool{Name: "get_weather", Description: "Weather for a city", InputSchema: json.RawMessage(`{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}`)}

func noTools(context.Context, piworker.Event) (piworker.ToolResult, error) {
	return piworker.ToolResult{}, fmt.Errorf("no tools")
}

func TestTextStreamsAndResult(t *testing.T) {
	b, p := setup(t, nil, text("Hel", "lo"))
	rec := &recorder{}
	require.NoError(t, b.Sample(context.Background(), req("hi", piworker.Options{}), rec.emit, noTools))

	texts := rec.of("text")
	require.Len(t, texts, 2)
	assert.Equal(t, piworker.Event{Type: "text", CallID: "sc1", Text: "Hel", Delta: "Hel"}, texts[0])
	assert.Equal(t, "Hello", texts[1].Text)
	res := rec.last("result").Result
	require.NotNil(t, res)
	assert.Equal(t, "Hello", res.Text)
	assert.Equal(t, "Hello", *res.FinalText)
	assert.Equal(t, "default", res.ModelTierApplied)
	assert.Equal(t, "lunaroute/big", res.ModelUsed)
	assert.False(t, res.Truncated)
	u := rec.last("usage").Usage
	require.NotNil(t, u)
	assert.Equal(t, piworker.Usage{Input: 10, Output: 5, Model: "lunaroute/big"}, *u)

	body := p.bodies[0]
	assert.Equal(t, "big", body["model"])
	assert.Equal(t, "medium", body["reasoning_effort"], "tier default with no effort uses settings' defaultThinkingLevel")
	assert.EqualValues(t, 65536, body["max_completion_tokens"], "min(model max, call budget)")
	assert.Equal(t, "Bearer test-key", p.header[0].Get("Authorization"))
	assert.Equal(t, "slop", p.header[0].Get("lunaroute-agent"))
	assert.NotContains(t, body, "tools")
}

func TestToolsOverRounds(t *testing.T) {
	b, p := setup(t, nil,
		toolCalls("Let me check.", [3]string{"call_1", "get_weather", `{"city":"Oslo"}`}, [3]string{"call_2", "get_weather", `{"city":"Rome"}`}),
		text("Oslo 17, Rome 25."))
	rec := &recorder{}
	var mu sync.Mutex
	inflight, peak := 0, 0
	exec := func(ctx context.Context, e piworker.Event) (piworker.ToolResult, error) {
		mu.Lock()
		inflight++
		peak = max(peak, inflight)
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		inflight--
		mu.Unlock()
		var in struct{ City string }
		_ = json.Unmarshal(e.Input, &in)
		if in.City == "Rome" {
			return piworker.ToolResult{Value: json.RawMessage(`"station offline"`), IsError: true}, nil
		}
		return piworker.ToolResult{Value: json.RawMessage(`{"temp":17}`)}, nil
	}
	require.NoError(t, b.Sample(context.Background(), req("weather?", piworker.Options{}, weather), rec.emit, exec))

	assert.Equal(t, 2, peak, "both tool calls of a round run at once")
	res := rec.last("result").Result
	require.NotNil(t, res)
	assert.Equal(t, "Let me check.\n\nOslo 17, Rome 25.", res.Text, "rounds are separated by a blank line")
	assert.Equal(t, "Oslo 17, Rome 25.", *res.FinalText)
	assert.Len(t, rec.of("usage"), 2)

	require.Len(t, p.bodies, 2)
	tools0, _ := p.bodies[0]["tools"].([]any)
	require.Len(t, tools0, 1)
	fn := tools0[0].(map[string]any)["function"].(map[string]any)
	assert.Equal(t, "get_weather", fn["name"])
	assert.Equal(t, "object", fn["parameters"].(map[string]any)["type"])
	msgs := p.bodies[1]["messages"].([]any)
	var toolMsgs []map[string]any
	for _, m := range msgs {
		if mm := m.(map[string]any); mm["role"] == "tool" {
			toolMsgs = append(toolMsgs, mm)
		}
	}
	require.Len(t, toolMsgs, 2)
	byID := map[string]any{}
	for _, m := range toolMsgs {
		byID[m["tool_call_id"].(string)] = m["content"]
	}
	// Matched by id: geppetto's Chat Completions reducer does not keep the
	// provider's tool-call order when text precedes the calls.
	assert.Equal(t, `{"temp":17}`, byID["call_1"])
	assert.Equal(t, `{"error":"station offline"}`, byID["call_2"], "an error result reaches the model as an error")
	assert.Less(t, p.bodies[1]["max_completion_tokens"].(float64), float64(65536), "the second round gets what the first left")
}

func TestLastRoundOffersNoTools(t *testing.T) {
	b, p := setup(t, nil,
		toolCalls("", [3]string{"call_1", "get_weather", `{"city":"Oslo"}`}),
		text("done"))
	r := req("weather?", piworker.Options{}, weather)
	r.MaxRounds = 2
	exec := func(context.Context, piworker.Event) (piworker.ToolResult, error) {
		return piworker.ToolResult{Value: json.RawMessage(`1`)}, nil
	}
	rec := &recorder{}
	require.NoError(t, b.Sample(context.Background(), r, rec.emit, exec))
	assert.Contains(t, p.bodies[0], "tools")
	assert.NotContains(t, p.bodies[1], "tools")
	assert.Equal(t, "done", rec.last("result").Result.Text)
}

func TestFailures(t *testing.T) {
	for name, tc := range map[string]struct {
		script []func(w http.ResponseWriter)
		r      piworker.Request
		code   string
		hidden string
	}{
		"unknown tool":     {[]func(w http.ResponseWriter){toolCalls("", [3]string{"c", "rm_rf", `{}`})}, req("x", piworker.Options{}, weather), "upstream_error", ""},
		"empty completion": {[]func(w http.ResponseWriter){text()}, req("x", piworker.Options{}), "empty_completion", ""},
		"rate limited":     {[]func(w http.ResponseWriter){status(429, "slow down")}, req("x", piworker.Options{}), "rate_limited", "slow down"},
		"auth":             {[]func(w http.ResponseWriter){status(401, "bad key sk-123")}, req("x", piworker.Options{}), "authentication_error", "sk-123"},
		"upstream":         {[]func(w http.ResponseWriter){status(500, "echo: my secret prompt")}, req("x", piworker.Options{}), "upstream_error", "secret"},
		"images": {nil, func() piworker.Request {
			r := req("x", piworker.Options{})
			r.Images = []piworker.Image{{MimeType: "image/jpeg", Data: "AA=="}}
			return r
		}(), "images_unavailable", ""},
	} {
		t.Run(name, func(t *testing.T) {
			b, _ := setup(t, nil, tc.script...)
			rec := &recorder{}
			require.NoError(t, b.Sample(context.Background(), tc.r, rec.emit, noTools))
			e := rec.last("error").Error
			require.NotNil(t, e)
			assert.Equal(t, tc.code, e.Code)
			if tc.hidden != "" {
				assert.NotContains(t, e.Message, tc.hidden, "provider diagnostics never reach the page")
			}
			assert.Empty(t, rec.of("result"))
		})
	}
}

func TestCancelDuringTool(t *testing.T) {
	b, _ := setup(t, nil, toolCalls("Checking", [3]string{"c", "get_weather", `{}`}))
	ctx, cancel := context.WithCancel(context.Background())
	exec := func(ctx context.Context, e piworker.Event) (piworker.ToolResult, error) {
		cancel()
		<-ctx.Done()
		return piworker.ToolResult{}, ctx.Err()
	}
	rec := &recorder{}
	err := b.Sample(ctx, req("x", piworker.Options{}, weather), rec.emit, exec)
	assert.ErrorIs(t, err, context.Canceled)
	assert.Empty(t, rec.of("error"), "a cancelled call ends without an error event")
	assert.Empty(t, rec.of("result"))
}

func TestModelChoice(t *testing.T) {
	b, p := setup(t, map[string]string{"quick": "lunaroute/small", "complex": "big:high"}, text("a"), text("b"), text("c"), text("d"), text("e"))
	models := b.Models()
	require.GreaterOrEqual(t, len(models), 2)
	assert.Equal(t, piworker.Model{Provider: "lunaroute", ID: "small", Name: "small", Reasoning: true, Images: true, Tier: "quick",
		ThinkingLevels: []string{"off", "minimal", "low", "medium", "high", "xhigh"}}, models[0])
	assert.Equal(t, "default", models[1].Tier, "tier models come first, each once")

	run := func(o piworker.Options) (*piworker.Result, map[string]any) {
		rec := &recorder{}
		require.NoError(t, b.Sample(context.Background(), req("x", o), rec.emit, noTools))
		return rec.last("result").Result, p.bodies[len(p.bodies)-1]
	}
	res, body := run(piworker.Options{ModelTier: "quick"})
	assert.Equal(t, "small", body["model"])
	assert.NotContains(t, body, "reasoning_effort", "quick without effort thinks not")
	assert.EqualValues(t, 1000, body["max_completion_tokens"], "the model's maxTokens bounds a round")
	assert.Equal(t, "lunaroute/small", res.ModelUsed)

	_, body = run(piworker.Options{ModelTier: "complex"})
	assert.Equal(t, "high", body["reasoning_effort"], "the tier reference's :high")

	_, body = run(piworker.Options{ModelTier: "complex", Effort: "low"})
	assert.Equal(t, "low", body["reasoning_effort"], "the page's effort wins")

	res, body = run(piworker.Options{ModelTier: "quick", Model: "lunaroute/big"})
	assert.Equal(t, "big", body["model"])
	assert.Equal(t, "lunaroute/big", res.ModelApplied)

	res, body = run(piworker.Options{ModelTier: "quick", Model: "nobody/nothing"})
	assert.Equal(t, "small", body["model"], "an unknown model falls back to the tier")
	assert.Empty(t, res.ModelApplied)
}

func TestNewFailsWithoutModels(t *testing.T) {
	_, err := New(Config{AgentDir: t.TempDir()})
	assert.ErrorContains(t, err, "no authenticated model for quick")
	b, _ := setup(t, nil)
	_, err = New(Config{AgentDir: b.dir.Dir, Tiers: map[string]string{"quick": "lunaroute/missing"}, Options: []pi.Option{pi.WithLocalProviders()}})
	assert.ErrorContains(t, err, "lunaroute/missing")
}

func TestBudget(t *testing.T) {
	bu, err := newBudget(0)
	require.NoError(t, err)
	n, _ := bu.next(100000)
	assert.Equal(t, 65536, n)
	bu.consume(65000)
	n, _ = bu.next(100000)
	assert.Equal(t, 536, n)
	bu.consume(536)
	_, err = bu.next(10)
	assert.ErrorIs(t, err, errBudgetUsed)
	_, err = newBudget(70000)
	assert.Error(t, err)
}

func TestImagesJoinTheLastUserTurn(t *testing.T) {
	b, p := setup(t, nil, text("a cat"))
	r := req(`[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"},{"role":"user","content":"what is this?"}]`, piworker.Options{Model: "lunaroute/small"})
	r.Images = []piworker.Image{{MimeType: "image/jpeg", Data: "/9j/AA=="}}
	rec := &recorder{}
	require.NoError(t, b.Sample(context.Background(), r, rec.emit, noTools))
	require.Equal(t, "a cat", rec.last("result").Result.Text)
	msgs := p.bodies[0]["messages"].([]any)
	require.Len(t, msgs, 3)
	assert.Equal(t, "hi", msgs[0].(map[string]any)["content"])
	assert.Equal(t, "assistant", msgs[1].(map[string]any)["role"])
	parts, ok := msgs[2].(map[string]any)["content"].([]any)
	require.True(t, ok, "the last user turn carries parts: %v", msgs[2])
	raw, _ := json.Marshal(parts)
	assert.Contains(t, string(raw), "what is this?")
	assert.Contains(t, string(raw), "data:image/jpeg;base64,/9j/AA==")
}
