package actors

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	capsample "github.com/go-go-golems/slop-computer/pkg/caps/sample"
	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// SampleTimeout bounds one LLM call from an actor.
const SampleTimeout = 3 * time.Minute

// sampler is the sample capability (pkg/caps/sample) on the manager's
// backend, read per call: the host sets the backend after it is built.
func (s *Door) sampler(m *actor.Manager) *capsample.Sampler {
	return &capsample.Sampler{Ledger: s.Ledger, Backend: m.LLM}
}

// sampleFail is a capability refusal as an actor error; a backend failure
// is unavailable to an actor.
func sampleFail(err error) *actor.Error {
	var f *llm.Failure
	if !errors.As(err, &f) {
		return &actor.Error{Code: "unavailable", Message: "the model failed: " + err.Error()}
	}
	if f.Code == "upstream_error" {
		return &actor.Error{Code: "unavailable", Message: f.Message}
	}
	return &actor.Error{Code: f.Code, Message: f.Message}
}

// sampleModule is use('sample') in actors: sample(input, opts) awaits the
// model (an await on real I/O: the turn ends there), with allowed(),
// limits() and json(). It is null unless the app declares sample, a
// backend is configured and the policy allows it for some audience.
func (s *Door) sampleModule(m *actor.Manager, a *actor.Actor) goja.Value {
	if !a.Manifest().Caps.Declared["sample"] || !s.sampler(m).Available() || !a.AllowedAny("sample") {
		return nil
	}
	// check applies guide §9.3 for the current turn: the policy for the
	// visitor's audience, then the payer's access and monthly budget.
	check := func() (string, llm.LLM) {
		a.Need("sample")
		v := a.Visitor()
		l, err := s.sampler(m).Check(a.Turn().Context(), v.Payer, v.Audience)
		if err != nil {
			a.ThrowError(sampleFail(err))
		}
		return v.Payer, l
	}
	vm := a.VM()
	call := func(input, opts goja.Value, asJSON bool) goja.Value {
		payer, l := check()
		raw, err := llm.InputOf(a.FromJS(input))
		if err != nil {
			a.ThrowError(sampleFail(err))
		}
		in := llm.In{Input: raw}
		if o, ok := a.FromJS(opts).(map[string]any); ok {
			in.ModelTier, _ = o["modelTier"].(string)
			in.Model, _ = o["model"].(string)
			in.Effort, _ = o["effort"].(string)
			if n, ok := o["maxTokens"].(json.Number); ok {
				mt, _ := n.Int64()
				in.MaxTokens = int(mt)
			}
		}
		req, err := llm.NewRequest("ac", in, false)
		if err != nil {
			a.ThrowError(sampleFail(err))
		}
		sp := s.sampler(m)
		return a.IO(func() (any, error) {
			ctx, cancel := context.WithTimeout(context.Background(), SampleTimeout)
			defer cancel()
			ans, err := sp.Run(ctx, payer, l, req, nil, nil)
			if err != nil {
				return nil, sampleFail(err)
			}
			if f := ans.Failure; f != nil { // a backend error event: unavailable, unless the budget ran out
				if f.Code == "quota_exceeded" {
					return nil, &actor.Error{Code: f.Code, Message: f.Message}
				}
				return nil, &actor.Error{Code: "unavailable", Message: f.Message}
			}
			return ans, nil
		}, func(v any) (goja.Value, error) {
			ans := v.(llm.Answer)
			if asJSON {
				x, err := llm.ParseJSON(ans.Text)
				if err != nil {
					return nil, sampleFail(err)
				}
				return vm.ToValue(x), nil
			}
			return a.ToJS(map[string]any{"text": ans.Text, "model": ans.Model,
				"usage": map[string]int64{"input": ans.Usage.Input, "output": ans.Usage.Output}}), nil
		})
	}
	fn := vm.ToValue(func(c goja.FunctionCall) goja.Value { return call(c.Argument(0), c.Argument(1), false) }).(*goja.Object)
	_ = fn.Set("json", func(c goja.FunctionCall) goja.Value { return call(c.Argument(0), c.Argument(1), true) })
	// limits is what this turn's visitor may spend (nothing when the
	// policy does not allow sample for them).
	limits := func() llm.LLM {
		v := a.Visitor()
		if !a.Allowed("sample") {
			return llm.LLM{}
		}
		return s.sampler(m).Limits(a.Turn().Context(), v.Payer, v.Audience)
	}
	// allowed: whether this turn's visitor may sample now (no throw).
	_ = fn.Set("allowed", func() bool {
		l := limits()
		return l.Allowed && (l.Remaining == nil || *l.Remaining > 0)
	})
	_ = fn.Set("limits", func() goja.Value {
		l := limits()
		return a.ToJS(map[string]any{"allowed": l.Allowed, "remaining": l.Remaining})
	})
	return fn
}
