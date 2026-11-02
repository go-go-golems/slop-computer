package verbs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
)

// EvalTimeout bounds one eval program.
var EvalTimeout = 60 * time.Second

const maxEvalLogs = 1000

func init() {
	Register(&Verb{Name: "eval", Doc: "Run a JavaScript program on the server with every verb in scope as slop.<group>.<verb>(args).", Scope: Read, Action: authz.Program,
		Args: []Arg{{Name: "source", Type: "string", Required: true, Doc: "the program body; top-level return gives the result"},
			{Name: "args", Type: "json", Doc: "passed to the program as args"},
			{Name: "readOnly", Type: "bool", Doc: "writing verbs throw permission_denied"}},
		Run: runEval})
}

// runEval runs a program in a fresh runtime. Each verb it calls is a
// separate, synchronous call with the caller's identity (via eval), so
// every check applies exactly as from the CLI.
func runEval(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
	vm := goja.New()
	inner := *p
	inner.Via = "eval"
	readOnly := a.B("readOnly")
	logs := []string{}

	console := vm.NewObject()
	for _, level := range []string{"log", "info", "warn", "error", "debug"} {
		prefix := ""
		if level == "warn" || level == "error" {
			prefix = level + ": "
		}
		_ = console.Set(level, func(call goja.FunctionCall) goja.Value {
			if len(logs) >= maxEvalLogs {
				return goja.Undefined()
			}
			parts := make([]string, len(call.Arguments))
			for i, arg := range call.Arguments {
				parts[i] = logString(vm, arg)
			}
			logs = append(logs, prefix+strings.Join(parts, " "))
			return goja.Undefined()
		})
	}
	_ = vm.Set("console", console)

	slop := vm.NewObject()
	groups := map[string]*goja.Object{}
	for _, v := range All() {
		if v.Name == "eval" {
			continue
		}
		v := v
		fn := func(call goja.FunctionCall) goja.Value {
			args := Args{}
			if arg := call.Argument(0); !goja.IsUndefined(arg) && !goja.IsNull(arg) {
				m, ok := norm(arg.Export()).(map[string]any)
				if !ok {
					throw(vm, Errf("invalid_argument", "%s takes one object of arguments", v.Name))
				}
				args = m
			}
			if readOnly && v.Scope != Read {
				throw(vm, Errf("permission_denied", "%s writes, and this program is read-only", v.Name))
			}
			res, err := Call(ctx, e, &inner, v.Name, args)
			if err != nil {
				throw(vm, AsError(err))
			}
			return toJS(vm, res)
		}
		if v.Group() == v.Name {
			_ = slop.Set(v.Name, fn)
			continue
		}
		g, ok := groups[v.Group()]
		if !ok {
			g = vm.NewObject()
			groups[v.Group()] = g
			_ = slop.Set(v.Group(), g)
		}
		_ = g.Set(v.Short(), fn)
	}
	_ = vm.Set("slop", slop)
	_ = vm.Set("args", toJS(vm, a["args"]))

	timer := time.AfterFunc(EvalTimeout, func() { vm.Interrupt("eval timed out") })
	defer timer.Stop()
	stop := context.AfterFunc(ctx, func() { vm.Interrupt("eval cancelled") })
	defer stop()

	// Same first line as the source, so error positions match it.
	val, err := vm.RunScript("eval.js", "(function(){"+a.S("source")+"\n})()")
	if err != nil {
		return nil, evalError(err, logs)
	}
	return map[string]any{"result": exportJSON(vm, val), "logs": logs}, nil
}

// throw raises a verb error as a JS Error with .code (and .trace).
func throw(vm *goja.Runtime, e *Error) {
	obj, err := vm.New(vm.Get("Error"), vm.ToValue(e.Message))
	if err != nil {
		panic(vm.NewGoError(e))
	}
	_ = obj.Set("code", e.Code)
	if len(e.Trace) > 0 {
		_ = obj.Set("trace", e.Trace)
	}
	if e.Extra != nil {
		_ = obj.Set("extra", toJS(vm, e.Extra))
	}
	panic(obj)
}

// evalError turns an uncaught exception into a verb error, keeping a
// verb's code when the program let it escape.
func evalError(err error, logs []string) error {
	extra := map[string]any{"logs": logs}
	var ie *goja.InterruptedError
	if errors.As(err, &ie) {
		return &Error{Code: "unavailable", Message: fmt.Sprint(ie.Value()), Extra: extra}
	}
	var ex *goja.Exception
	if errors.As(err, &ex) {
		out := &Error{Code: "eval_error", Message: ex.Error(), Extra: extra}
		if obj, ok := ex.Value().(*goja.Object); ok {
			if c := obj.Get("code"); c != nil && !goja.IsUndefined(c) {
				out.Code = c.String()
				if m := obj.Get("message"); m != nil {
					out.Message = m.String()
				}
				if tv := obj.Get("trace"); tv != nil {
					if t, ok := tv.Export().([]any); ok {
						for _, line := range t {
							out.Trace = append(out.Trace, fmt.Sprint(line))
						}
					}
				}
			}
		}
		return out
	}
	return &Error{Code: "eval_error", Message: err.Error(), Extra: extra}
}

// toJS converts a Go value to plain JS data through JSON.
func toJS(vm *goja.Runtime, v any) goja.Value {
	if v == nil {
		return goja.Null()
	}
	b, err := json.Marshal(v)
	if err != nil {
		return goja.Null()
	}
	var out any
	if json.Unmarshal(b, &out) != nil {
		return goja.Null()
	}
	return vm.ToValue(out)
}

// exportJSON converts a JS value to JSON data with JSON.stringify's rules.
func exportJSON(vm *goja.Runtime, v goja.Value) any {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return nil
	}
	s := jsonStringify(vm, v)
	if s == "" {
		return nil
	}
	return decodeJSON([]byte(s))
}

func jsonStringify(vm *goja.Runtime, v goja.Value) string {
	j := vm.Get("JSON").ToObject(vm)
	stringify, ok := goja.AssertFunction(j.Get("stringify"))
	if !ok {
		return ""
	}
	out, err := stringify(j, v)
	if err != nil || goja.IsUndefined(out) {
		return ""
	}
	return out.String()
}

func logString(vm *goja.Runtime, v goja.Value) string {
	if _, ok := v.(*goja.Object); ok && !isError(v) {
		if s := jsonStringify(vm, v); s != "" {
			return s
		}
	}
	return v.String()
}

func isError(v goja.Value) bool {
	obj, ok := v.(*goja.Object)
	return ok && obj.ClassName() == "Error"
}
