package gepp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	stdErrors "errors"
	"regexp"
	"strings"
	"sync"

	"github.com/go-go-golems/geppetto/pkg/events"
	"github.com/go-go-golems/geppetto/pkg/inference/engine"
	"github.com/go-go-golems/geppetto/pkg/inference/tools"
	"github.com/go-go-golems/geppetto/pkg/steps/ai/providers/pi"
	"github.com/go-go-golems/geppetto/pkg/turns"
	"github.com/go-go-golems/geppetto/pkg/turns/toolblocks"
	"github.com/go-go-golems/slop-computer/pkg/piworker"
	"github.com/invopop/jsonschema"
	"golang.org/x/sync/errgroup"
)

// maxContextBytes bounds the conversation a call may grow to through tool
// results (images excluded), as the Node worker does.
const maxContextBytes = 512 << 10

// failure ends a call with a contract error code.
type failure struct{ code, message string }

func (f *failure) Error() string { return f.message }

var (
	errEmpty      = &failure{"empty_completion", "Empty completion"}
	errRounds     = &failure{"upstream_error", "Tool round limit reached"}
	errContext    = &failure{"prompt_too_large", "Tool conversation exceeds local context budget"}
	errImages     = &failure{"images_unavailable", "Images are not supported by the selected model"}
	errUnknown    = &failure{"upstream_error", "Unknown page tool"}
	errBudgetUsed = &failure{"upstream_error", "Generated-token budget exhausted"}
)

// Sample runs one call: rounds of one engine call each, page tools between
// them, text accumulated across rounds.
func (b *Backend) Sample(ctx context.Context, r piworker.Request, emit func(piworker.Event), execute piworker.ExecuteTool) error {
	c := &call{b: b, r: r, emit: emit, execute: execute}
	err := c.run(ctx)
	if ctx.Err() != nil {
		return ctx.Err() // cancelled: the server sends nothing more
	}
	if err != nil {
		f, ok := err.(*failure)
		if !ok {
			f = classify(err)
		}
		emit(piworker.Event{Type: "error", CallID: r.CallID, Error: &piworker.Failure{Code: f.code, Message: f.message, Text: c.visible}})
	}
	return nil
}

type call struct {
	b       *Backend
	r       piworker.Request
	emit    func(piworker.Event)
	execute piworker.ExecuteTool

	mu       sync.Mutex
	visible  string // the answer so far, across rounds
	thinking string
}

func (c *call) run(ctx context.Context) error {
	ch, applied := c.b.pick(c.r.Options)
	m := ch.model
	if len(c.r.Images) > 0 && !m.Images() {
		return errImages
	}
	res, err := c.b.dir.Resolve(ctx, m.Ref(), pi.ResolveOptions{Thinking: c.level(ch)})
	if err != nil {
		return err
	}
	t, err := toTurn(c.r)
	if err != nil {
		return err
	}
	registry := tools.NewInMemoryToolRegistry()
	for _, tool := range c.r.Tools {
		if err := registry.RegisterTool(tool.Name, tools.ToolDefinition{Name: tool.Name, Description: tool.Description, Parameters: schemaOf(tool.InputSchema)}); err != nil {
			return err
		}
	}
	budget, err := newBudget(c.r.MaxOutputTokens)
	if err != nil {
		return err
	}
	rounds := min(max(c.r.MaxRounds, 1), 10)
	if c.r.MaxRounds == 0 {
		rounds = 5
	}
	for round := 0; round < rounds; round++ {
		if contextBytes(t) > maxContextBytes {
			return errContext
		}
		perRound, err := budget.next(m.MaxTokens)
		if err != nil {
			return err
		}
		if err := engine.KeyInferenceConfig.Set(&t.Data, engine.InferenceConfig{MaxResponseTokens: &perRound}); err != nil {
			return err
		}
		eng, err := res.Engine()
		if err != nil {
			return err
		}
		rctx := ctx
		if round < rounds-1 && len(c.r.Tools) > 0 { // the last round offers no tools
			rctx = tools.WithRegistry(rctx, registry)
		}
		s := &sink{c: c, round: round, model: m.Ref()}
		out, err := eng.RunInference(events.WithEventSinks(rctx, s), t)
		if err != nil {
			return err
		}
		if s.failed != nil {
			return s.failed
		}
		budget.consume(s.output)
		t = out
		calls := toolblocks.ExtractPendingToolCalls(t)
		if len(calls) == 0 || budget.remaining <= 0 {
			if strings.TrimSpace(c.visible) == "" {
				return errEmpty
			}
			final := s.text
			c.emit(piworker.Event{Type: "result", CallID: c.r.CallID, Result: &piworker.Result{
				Text: c.visible, Thinking: c.thinking, FinalText: &final,
				Truncated:        s.truncated || budget.remaining <= 0,
				ModelTierApplied: c.r.Options.ModelTier, ModelApplied: applied, ModelUsed: m.Ref(),
			}})
			return nil
		}
		results, err := c.runTools(ctx, calls)
		if err != nil {
			return err
		}
		for _, b := range results {
			turns.AppendBlock(t, b)
		}
	}
	return errRounds
}

// pick returns the call's model and the explicit model it applied, if any.
// An explicit model that is not available falls back to the tier.
func (b *Backend) pick(o piworker.Options) (choice, string) {
	if o.Model != "" {
		eligible := map[string]pi.Model{}
		for _, m := range b.dir.Available() {
			eligible[m.Ref()] = m
		}
		if c, ok := b.lookup(o.Model, eligible); ok {
			return c, o.Model
		}
	}
	return b.tiers[o.ModelTier], ""
}

// level is the Pi thinking level of a call: the page's effort, else the
// level the model reference named, else (not for quick) settings' default.
func (c *call) level(ch choice) string {
	switch {
	case c.r.Options.Effort != "":
		return c.r.Options.Effort
	case ch.level != "":
		return ch.level
	case c.r.Options.ModelTier == "quick" || c.b.baseline == "":
		return "off"
	}
	return c.b.baseline
}

// runTools sends every tool call of a round to the page at once and waits
// for all results, in call order.
func (c *call) runTools(ctx context.Context, calls []toolblocks.ToolCall) ([]turns.Block, error) {
	known := map[string]bool{}
	for _, t := range c.r.Tools {
		known[t.Name] = true
	}
	for _, tc := range calls {
		if !known[tc.Name] {
			return nil, errUnknown
		}
	}
	out := make([]turns.Block, len(calls))
	var g errgroup.Group
	for i, tc := range calls {
		g.Go(func() error {
			input, err := json.Marshal(tc.Arguments)
			if err != nil || tc.Arguments == nil {
				input = []byte("{}")
			}
			res, err := c.execute(ctx, piworker.Event{Type: "tool", CallID: c.r.CallID, ToolCallID: tc.ID, Name: tc.Name, Input: input})
			if err != nil {
				return err
			}
			text := resultText(res.Value)
			if res.IsError {
				out[i] = turns.NewToolUseBlockWithError(tc.ID, nil, text)
			} else {
				out[i] = turns.NewToolUseBlock(tc.ID, text)
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return out, nil
}

// resultText is a tool result as the model reads it: a JSON string as its
// text, anything else as JSON.
func resultText(v json.RawMessage) string {
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	if len(v) == 0 {
		return "null"
	}
	return string(v)
}

// toTurn builds the conversation from a string or a list of turns; images
// join the last user turn.
func toTurn(r piworker.Request) (*turns.Turn, error) {
	type msg struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	var msgs []msg
	var text string
	if json.Unmarshal(r.Input, &text) == nil {
		msgs = []msg{{"user", text}}
	} else if err := json.Unmarshal(r.Input, &msgs); err != nil {
		return nil, &failure{"invalid_request", "Input must be text or turns"}
	}
	t := &turns.Turn{}
	for i, m := range msgs {
		switch {
		case m.Role == "assistant":
			turns.AppendBlock(t, turns.NewAssistantTextBlock(m.Content))
		case i == len(msgs)-1 && len(r.Images) > 0:
			images := make([]map[string]any, 0, len(r.Images))
			for _, img := range r.Images {
				raw, err := base64.StdEncoding.DecodeString(img.Data)
				if err != nil {
					return nil, &failure{"invalid_request", "Invalid prepared image"}
				}
				images = append(images, map[string]any{"media_type": img.MimeType, "content": raw})
			}
			turns.AppendBlock(t, turns.NewUserMultimodalBlock(m.Content, images))
		default:
			turns.AppendBlock(t, turns.NewUserTextBlock(m.Content))
		}
	}
	return t, nil
}

// schemaOf parses a page tool's JSON schema; none means an empty object.
func schemaOf(raw json.RawMessage) *jsonschema.Schema {
	s := &jsonschema.Schema{}
	if len(raw) == 0 || json.Unmarshal(raw, s) != nil {
		return &jsonschema.Schema{Type: "object", Properties: jsonschema.NewProperties()}
	}
	return s
}

// contextBytes measures the conversation without images.
func contextBytes(t *turns.Turn) int {
	n := 0
	for _, b := range t.Blocks {
		for k, v := range b.Payload {
			if k == turns.PayloadKeyImages {
				continue
			}
			raw, _ := json.Marshal(v)
			n += len(raw)
		}
	}
	return n
}

// sink turns one round's Geppetto events into the call's events.
type sink struct {
	c                  *call
	round              int
	model              string
	separated, thought bool
	text               string // this round's own text
	output             int
	truncated          bool
	failed             error
}

func (s *sink) PublishEvent(e events.Event) error {
	c := s.c
	c.mu.Lock()
	defer c.mu.Unlock()
	switch e := e.(type) {
	case *events.EventTextDelta:
		if e.Delta == "" {
			return nil
		}
		delta := e.Delta
		if !s.separated {
			if s.round > 0 && c.visible != "" {
				delta = "\n\n" + delta
			}
			s.separated = true
		}
		s.text += e.Delta
		c.visible += delta
		c.emit(piworker.Event{Type: "text", CallID: c.r.CallID, Text: c.visible, Delta: delta})
	case *events.EventReasoningDelta:
		if e.Delta == "" {
			return nil
		}
		delta := e.Delta
		if !s.thought && s.round > 0 && c.thinking != "" {
			delta = "\n\n" + delta
		}
		s.thought = true
		c.thinking += delta
		c.emit(piworker.Event{Type: "thinking", CallID: c.r.CallID, Text: c.thinking, Delta: delta})
	case *events.EventProviderCallFinished:
		switch e.StopReason {
		case "length", "max_tokens", "max_output_tokens", "incomplete":
			s.truncated = true
		}
		if e.Usage != nil {
			s.output += e.Usage.OutputTokens
			c.emit(piworker.Event{Type: "usage", CallID: c.r.CallID, Usage: &piworker.Usage{
				Input: int64(e.Usage.InputTokens), Output: int64(e.Usage.OutputTokens),
				CacheRead: int64(e.Usage.CacheReadInputTokens + e.Usage.CachedTokens), CacheWrite: int64(e.Usage.CacheCreationInputTokens),
				Model: s.model,
			}})
		}
	case *events.EventError:
		if s.failed == nil {
			s.failed = classify(errorOf(e))
		}
	}
	return nil
}

func errorOf(e *events.EventError) error { return stdErrors.New(e.ErrorString) }

// budget is one generated-token budget per call, shared by its rounds.
type budget struct{ remaining int }

func newBudget(limit int) (*budget, error) {
	if limit == 0 {
		limit = 65536
	}
	if limit < 1 || limit > 65536 {
		return nil, &failure{"invalid_request", "Invalid generated-token budget"}
	}
	return &budget{remaining: limit}, nil
}

func (b *budget) next(modelMax int) (int, error) {
	if b.remaining < 1 {
		return 0, errBudgetUsed
	}
	if modelMax > 0 && modelMax < b.remaining {
		return modelMax, nil
	}
	return b.remaining, nil
}

func (b *budget) consume(output int) { b.remaining -= max(output, 0) }

var (
	authErr  = regexp.MustCompile(`(?i)\b(?:401|403)\b|unauthori[sz]ed|authentication|invalid.{0,20}(?:api.?key|token)|(?:expired|missing).{0,20}(?:token|credential)|no.{0,20}(?:api.?key|credential)`)
	rateErr  = regexp.MustCompile(`(?i)\b429\b|rate.?limit|too many requests`)
	largeErr = regexp.MustCompile(`(?i)\b413\b|context.{0,20}(?:length|window)|too many tokens|prompt is too long|maximum context`)
)

// classify maps a provider or resolution error to a contract code with a
// fixed message: provider diagnostics never reach the page (they can quote
// request content).
func classify(err error) *failure {
	if f, ok := err.(*failure); ok {
		return f
	}
	msg := err.Error()
	var nc *pi.NoCredentialError
	switch {
	case stdErrors.As(err, &nc):
		return &failure{"authentication_error", "Pi authentication for this provider failed. Log in through Pi, then restart slop."}
	case authErr.MatchString(msg):
		return &failure{"authentication_error", "Pi authentication for this provider failed. Log in through Pi, then restart slop."}
	case rateErr.MatchString(msg):
		return &failure{"rate_limited", "The provider rate limit was reached. Wait briefly and retry."}
	case largeErr.MatchString(msg):
		return &failure{"prompt_too_large", "The prompt is too large for the selected model."}
	}
	return &failure{"upstream_error", "The model provider request failed. Retry or choose another model."}
}
