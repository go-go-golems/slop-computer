package actor

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// SampleTimeout bounds one LLM call from an actor.
const SampleTimeout = 3 * time.Minute

// Sampler is the sample capability as the door gives it to actors
// (pkg/caps/sample, SLOP3-009 step 5): the same checks, metering and
// backend call as a page's and the sample.run verb's.
type Sampler interface {
	Available() bool
	Limits(ctx context.Context, payer, audience string) llm.LLM
	Check(ctx context.Context, payer, audience string) (llm.LLM, error)
	Run(ctx context.Context, payer string, l llm.LLM, req llm.Request, emit func(llm.Event), execute llm.ExecuteTool) (llm.Answer, error)
}

// sampleFail is a capability refusal as an actor error; a backend failure
// is unavailable to an actor.
func sampleFail(err error) *Error {
	var f *llm.Failure
	if !errors.As(err, &f) {
		return fail("unavailable", "the model failed: %v", err)
	}
	if f.Code == "upstream_error" {
		return fail("unavailable", "%s", f.Message)
	}
	return fail(f.Code, "%s", f.Message)
}

// sampleCheck applies guide §9.3 for the current turn: the policy for the
// visitor's audience, then the payer's access and monthly budget. It
// returns the payer.
func (a *Actor) sampleCheck() (string, llm.LLM) {
	a.need("sample")
	v := a.Visitor()
	l, err := a.m.Sample.Check(a.turn().t.Context(), v.Payer, v.Audience)
	if err != nil {
		a.throw(sampleFail(err))
	}
	return v.Payer, l
}

// sampleModule is use('sample') in actors: sample(input, opts) awaits the
// model (an await on real I/O: the turn ends there), with allowed(),
// limits() and json().
func (a *Actor) sampleModule() goja.Value {
	call := func(input, opts goja.Value, asJSON bool) goja.Value {
		payer, l := a.sampleCheck()
		raw, err := llm.InputOf(a.export(input))
		if err != nil {
			a.throw(sampleFail(err))
		}
		in := llm.In{Input: raw}
		if o, ok := a.export(opts).(map[string]any); ok {
			in.ModelTier, _ = o["modelTier"].(string)
			in.Model, _ = o["model"].(string)
			in.Effort, _ = o["effort"].(string)
			if n, ok := o["maxTokens"].(json.Number); ok {
				m, _ := n.Int64()
				in.MaxTokens = int(m)
			}
		}
		req, err := llm.NewRequest("ac", in, false)
		if err != nil {
			a.throw(sampleFail(err))
		}
		sp := a.m.Sample
		return a.io(func() (any, error) {
			ctx, cancel := context.WithTimeout(context.Background(), SampleTimeout)
			defer cancel()
			ans, err := sp.Run(ctx, payer, l, req, nil, nil)
			if err != nil {
				return nil, sampleFail(err)
			}
			if f := ans.Failure; f != nil { // a backend error event: unavailable, unless the budget ran out
				if f.Code == "quota_exceeded" {
					return nil, fail(f.Code, "%s", f.Message)
				}
				return nil, fail("unavailable", "%s", f.Message)
			}
			return ans, nil
		}, func(v any) (goja.Value, error) {
			ans := v.(llm.Answer)
			if asJSON {
				x, err := llm.ParseJSON(ans.Text)
				if err != nil {
					return nil, sampleFail(err)
				}
				return a.vm.ToValue(x), nil
			}
			return a.toJS(map[string]any{"text": ans.Text, "model": ans.Model,
				"usage": map[string]int64{"input": ans.Usage.Input, "output": ans.Usage.Output}}), nil
		})
	}
	fn := a.vm.ToValue(func(c goja.FunctionCall) goja.Value { return call(c.Argument(0), c.Argument(1), false) }).(*goja.Object)
	_ = fn.Set("json", func(c goja.FunctionCall) goja.Value { return call(c.Argument(0), c.Argument(1), true) })
	// limits is what this turn's visitor may spend (nothing when the
	// policy does not allow sample for them).
	limits := func() llm.LLM {
		v := a.Visitor()
		if !a.m.allowed(a, "sample") {
			return llm.LLM{}
		}
		return a.m.Sample.Limits(a.turn().t.Context(), v.Payer, v.Audience)
	}
	// allowed: whether this turn's visitor may sample now (no throw).
	_ = fn.Set("allowed", func() bool {
		l := limits()
		return l.Allowed && (l.Remaining == nil || *l.Remaining > 0)
	})
	_ = fn.Set("limits", func() goja.Value {
		l := limits()
		return a.toJS(map[string]any{"allowed": l.Allowed, "remaining": l.Remaining})
	})
	return fn
}
