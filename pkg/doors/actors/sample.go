package actors

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
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
	return &capsample.Sampler{Ledger: s.Ledger, Backend: m.LLM()}
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
		tools, fns := sampleTools(a, opts)
		in.Tools = tools
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
		var execute llm.ExecuteTool
		if len(fns) > 0 {
			execute = toolRunner(a, fns)
		}
		return a.IO(func() (any, error) {
			ctx, cancel := context.WithTimeout(context.Background(), SampleTimeout)
			defer cancel()
			ans, err := sp.Run(ctx, payer, l, req, nil, execute)
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

// ToolTimeout bounds one tool call of an actor's sample: the turn that runs
// it, and the promise it returns.
var ToolTimeout = 60 * time.Second

// sampleTools reads opts.tools: [{name, description, inputSchema, execute}].
// The model sees the first three; execute is the actor's own function.
func sampleTools(a *actor.Actor, opts goja.Value) ([]llm.Tool, map[string]goja.Callable) {
	o, ok := opts.(*goja.Object)
	if !ok || opts == nil {
		return nil, nil
	}
	tv := o.Get("tools")
	if tv == nil || goja.IsUndefined(tv) || goja.IsNull(tv) {
		return nil, nil
	}
	list, ok := a.FromJS(tv).([]any)
	if !ok {
		a.Throw("invalid_argument", "tools is a list of {name, description, inputSchema, execute}")
	}
	arr := tv.ToObject(a.VM())
	var tools []llm.Tool
	fns := map[string]goja.Callable{}
	for i := range list {
		t := arr.Get(strconv.Itoa(i)).ToObject(a.VM())
		name := t.Get("name")
		if name == nil || goja.IsUndefined(name) || name.String() == "" {
			a.Throw("invalid_argument", "a tool needs a name")
		}
		n := name.String()
		if fns[n] != nil {
			a.Throw("invalid_argument", "two tools are called "+n)
		}
		fn, ok := goja.AssertFunction(t.Get("execute"))
		if !ok {
			a.Throw("invalid_argument", "tool "+n+" needs an execute function")
		}
		desc := ""
		if d := t.Get("description"); d != nil && !goja.IsUndefined(d) {
			desc = d.String()
		}
		schema := json.RawMessage(`{"type":"object","properties":{}}`)
		if sv := t.Get("inputSchema"); sv != nil && !goja.IsUndefined(sv) && !goja.IsNull(sv) {
			b, err := json.Marshal(a.FromJS(sv))
			if err != nil {
				a.Throw("invalid_argument", "tool "+n+": inputSchema is not JSON")
			}
			schema = b
		}
		tools = append(tools, llm.Tool{Name: n, Description: desc, InputSchema: schema})
		fns[n] = fn
	}
	return tools, fns
}

// toolRunner runs the model's tool calls in the actor: each is a new turn
// of the event that called sample (actor.Later), whose writes commit with
// it; one that throws rolls back and the model reads the error. A tool may
// return a promise (it awaited I/O); its result is what the promise
// settles to.
func toolRunner(a *actor.Actor, fns map[string]goja.Callable) llm.ExecuteTool {
	later := a.Later()
	vm := a.VM()
	return func(ctx context.Context, e llm.Event) (llm.ToolResult, error) {
		fn := fns[e.Name]
		if fn == nil {
			return toolError("there is no tool " + e.Name), nil
		}
		done := make(chan llm.ToolResult, 1)
		send := func(r llm.ToolResult) {
			select {
			case done <- r:
			default:
			}
		}
		value := func(v goja.Value) llm.ToolResult {
			if v == nil || goja.IsUndefined(v) {
				return llm.ToolResult{Value: json.RawMessage("null")}
			}
			b, err := json.Marshal(a.FromJS(v))
			if err != nil {
				return toolError("the tool's result is not JSON")
			}
			return llm.ToolResult{Value: b}
		}
		later(func() error {
			args := goja.Value(vm.NewObject())
			if len(e.Input) > 0 {
				var x any
				if err := json.Unmarshal(e.Input, &x); err != nil {
					return fmt.Errorf("the tool's input is not JSON: %w", err)
				}
				args = a.ToJS(x)
			}
			v, err := fn(goja.Undefined(), args)
			if err != nil {
				return err // the turn rolls back; failed sends the error
			}
			// The tool's outcome is reported by the actor (SLOP3-017 F8): a
			// result once the turn it settled in has committed, a rejection
			// after that turn rolled back, whether it settles now or after
			// I/O, in a continuation turn. A plain value is a settled promise.
			p, ok := v.Export().(*goja.Promise)
			if !ok {
				var resolve func(any) error
				p, resolve, _ = vm.NewPromise()
				if err := resolve(v); err != nil {
					return err
				}
			}
			a.Watch(p, func(r goja.Value, err error) {
				if err != nil {
					send(toolError(errorMessage(err)))
					return
				}
				send(value(r))
			})
			return nil
		}, func(err error) { send(toolError(errorMessage(err))) })
		timer := time.NewTimer(ToolTimeout)
		defer timer.Stop()
		select {
		case r := <-done:
			return r, nil
		case <-ctx.Done():
			return llm.ToolResult{}, ctx.Err()
		case <-timer.C:
			return toolError("the tool did not answer within " + ToolTimeout.String()), nil
		}
	}
}

// errorMessage is what the model reads of a tool's error: its message, after
// its code when the thrown value had one of its own (permission_denied: …).
func errorMessage(err error) string {
	var ae *actor.Error
	if errors.As(err, &ae) {
		if ae.Code != "" && ae.Code != "actor_error" {
			return ae.Code + ": " + ae.Message
		}
		return ae.Message
	}
	return err.Error()
}

func toolError(msg string) llm.ToolResult {
	b, _ := json.Marshal(map[string]string{"error": msg})
	return llm.ToolResult{Value: b, IsError: true}
}
