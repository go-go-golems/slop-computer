package actor

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// SampleTimeout bounds one LLM call from an actor.
const SampleTimeout = 3 * time.Minute

// sampleCheck applies guide §9.3 for the current turn: the policy for the
// visitor's audience, then the payer's access and monthly budget. It
// returns the payer.
func (a *Actor) sampleCheck() (string, system.LLM) {
	a.need("sample")
	v := a.Visitor()
	if v.Payer == "" {
		a.throw(fail("permission_denied", "a visitor without an id cannot use the LLM"))
	}
	l := a.m.K.Sys.LLMFor(a.turn().t.Context(), v.Payer, v.Audience)
	if !l.Allowed {
		a.throw(fail("permission_denied", "no LLM access"))
	}
	if l.Remaining != nil && *l.Remaining <= 0 {
		a.throw(fail("quota_exceeded", "token budget used up for this month"))
	}
	return v.Payer, l
}

// sampleModule is use('sample') in actors: sample(input, opts) awaits the
// model (an await on real I/O: the turn ends there), with allowed(),
// limits() and json().
func (a *Actor) sampleModule() goja.Value {
	call := func(input, opts goja.Value, asJSON bool) goja.Value {
		payer, l := a.sampleCheck()
		var raw json.RawMessage
		switch x := a.export(input).(type) {
		case string:
			raw, _ = json.Marshal(x)
		case []any:
			raw, _ = json.Marshal(x)
		default:
			a.throw(fail("invalid_argument", "sample takes a string or a list of messages"))
		}
		req := llm.Request{CallID: "ac" + ids.New("", 8), Input: raw, Options: llm.Options{ModelTier: "default"}}
		if o, ok := a.export(opts).(map[string]any); ok {
			if s, ok := o["modelTier"].(string); ok && s != "" {
				req.Options.ModelTier = s
			}
			if s, ok := o["model"].(string); ok {
				req.Options.Model = s
			}
			if s, ok := o["effort"].(string); ok {
				req.Options.Effort = s
			}
			if n, ok := o["maxTokens"].(json.Number); ok {
				m, _ := n.Int64()
				req.MaxOutputTokens = int(m)
			}
		}
		if err := llm.ValidateRequest(req); err != nil {
			a.throw(fail("invalid_argument", "%s", err.Error()))
		}
		type answer struct {
			text, model string
			in, out     int64
		}
		backend := a.m.LLM
		// Each model round holds the payer's budget first and settles with
		// its usage (SLOP3-007): no call spends past the limit.
		meter := a.m.K.Sys.NewMeter(payer, l.Budget, req.CallID)
		req.Meter = meter
		return a.io(func() (any, error) {
			ctx, cancel := context.WithTimeout(context.Background(), SampleTimeout)
			defer cancel()
			var ans answer
			var failure *llm.Failure
			err := backend.Sample(ctx, req, func(e llm.Event) {
				switch e.Type {
				case "usage":
					if e.Usage != nil {
						meter.Usage(*e.Usage)
						ans.in += e.Usage.Input
						ans.out += e.Usage.Output
						ans.model = e.Usage.Model
					}
				case "result":
					if e.Result != nil {
						ans.text = e.Result.Text
					}
				case "error":
					failure = e.Error
				}
			}, func(context.Context, llm.Event) (llm.ToolResult, error) {
				return llm.ToolResult{Value: json.RawMessage(`"tools are not available to actors"`), IsError: true}, nil
			})
			meter.Close() // a round that reported no usage is charged in full
			var f *llm.Failure
			if errors.As(err, &f) && f.Code == "quota_exceeded" {
				return nil, fail(f.Code, "%s", f.Message)
			}
			if err != nil {
				return nil, fail("unavailable", "the model failed: %v", err)
			}
			if failure != nil {
				return nil, fail("unavailable", "%s", failure.Message)
			}
			return ans, nil
		}, func(v any) (goja.Value, error) {
			ans := v.(answer)
			if asJSON {
				var x any
				t := strings.TrimSpace(ans.text)
				t = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(t, "```json"), "```"), "```")
				if err := json.Unmarshal([]byte(strings.TrimSpace(t)), &x); err != nil {
					return nil, fail("invalid_argument", "the model did not answer with JSON")
				}
				return a.vm.ToValue(x), nil
			}
			return a.toJS(map[string]any{"text": ans.text, "model": ans.model,
				"usage": map[string]int64{"input": ans.in, "output": ans.out}}), nil
		})
	}
	fn := a.vm.ToValue(func(c goja.FunctionCall) goja.Value { return call(c.Argument(0), c.Argument(1), false) }).(*goja.Object)
	_ = fn.Set("json", func(c goja.FunctionCall) goja.Value { return call(c.Argument(0), c.Argument(1), true) })
	// allowed: whether this turn's visitor may sample now (no throw).
	_ = fn.Set("allowed", func() bool {
		v := a.Visitor()
		if !a.m.allowed(a, "sample") || v.Payer == "" {
			return false
		}
		l := a.m.K.Sys.LLMFor(a.turn().t.Context(), v.Payer, v.Audience)
		return l.Allowed && (l.Remaining == nil || *l.Remaining > 0)
	})
	_ = fn.Set("limits", func() goja.Value {
		v := a.Visitor()
		l := system.LLM{}
		if a.m.allowed(a, "sample") && v.Payer != "" {
			l = a.m.K.Sys.LLMFor(a.turn().t.Context(), v.Payer, v.Audience)
		}
		return a.toJS(map[string]any{"allowed": l.Allowed, "remaining": l.Remaining})
	})
	return fn
}
