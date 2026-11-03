// Package sample is the sample capability (SLOP3-009 step 5): one call to
// the model backend for every caller. A page's /_rt/sample stream, an
// actor's use('sample') and the sample.run verb (the CLI, the HTTP API)
// check the payer's LLM access and monthly budget here, build and validate
// the request here, and run it here behind a meter that holds budget
// before each model round and settles with its usage (SLOP3-007).
//
// Which app policy applies, who pays, and how tools and partial text reach
// the caller stay with the caller: a page pays as its viewer under the
// app's policy for their audience, an actor as its visitor (or the store's
// owner for alarms), the CLI as the token's person with no app in between.
package sample

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// Sampler runs calls on a backend, metered in the system ledger.
type Sampler struct {
	Backend llm.Backend // nil: no model on this server
	Sys     *system.DB
}

func fail(code, msg string) *llm.Failure { return &llm.Failure{Code: code, Message: msg} }

// Available reports whether the server has a model backend.
func (s *Sampler) Available() bool { return s != nil && s.Backend != nil }

// Models are the backend's models (none without a backend).
func (s *Sampler) Models() []llm.Model {
	if !s.Available() {
		return []llm.Model{}
	}
	return s.Backend.Models()
}

// Limits is what payer may spend as a member of audience (nothing for a
// payer without an id).
func (s *Sampler) Limits(ctx context.Context, payer, audience string) system.LLM {
	if payer == "" || s == nil || s.Sys == nil {
		return system.LLM{}
	}
	return s.Sys.LLMFor(ctx, payer, audience)
}

// Check refuses a call payer may not make now: no backend (unavailable), no
// id or no LLM access (permission_denied), the month's budget used up
// (quota_exceeded). It returns the payer's limits.
func (s *Sampler) Check(ctx context.Context, payer, audience string) (system.LLM, error) {
	if !s.Available() {
		return system.LLM{}, fail("unavailable", "this server has no model backend")
	}
	if payer == "" {
		return system.LLM{}, fail("permission_denied", "a visitor without an id cannot use the LLM")
	}
	l := s.Limits(ctx, payer, audience)
	if !l.Allowed {
		return l, fail("permission_denied", "no LLM access")
	}
	if l.Remaining != nil && *l.Remaining <= 0 {
		return l, fail("quota_exceeded", "token budget used up for this month")
	}
	return l, nil
}

// noTools answers a tool use for callers that offer none.
func noTools(context.Context, llm.Event) (llm.ToolResult, error) {
	return llm.ToolResult{Value: json.RawMessage(`"tools are not available here"`), IsError: true}, nil
}

// Run runs req for payer under the limits l: it meters every round, sends
// emit the call's events except usage (which never leaves the server), and
// hands tool uses to execute (nil: no tools). It returns the answer; an
// error event of the backend is the answer's Failure, already emitted. The
// error is the backend's own: a *llm.Failure quota_exceeded when the
// budget ran out mid-call, else upstream_error.
func (s *Sampler) Run(ctx context.Context, payer string, l system.LLM, req llm.Request, emit func(llm.Event), execute llm.ExecuteTool) (llm.Answer, error) {
	if !s.Available() {
		return llm.Answer{}, fail("unavailable", "this server has no model backend")
	}
	if execute == nil {
		execute = noTools
	}
	meter := s.Sys.NewMeter(payer, l.Budget, req.CallID)
	req.Meter = meter
	var ans llm.Answer
	err := s.Backend.Sample(ctx, req, func(e llm.Event) {
		switch e.Type {
		case "usage":
			if e.Usage != nil {
				meter.Usage(*e.Usage)
				ans.Usage.Input += e.Usage.Input
				ans.Usage.Output += e.Usage.Output
				ans.Model = e.Usage.Model
			}
			return // never forwarded
		case "result":
			if e.Result != nil {
				ans.Result = e.Result
				ans.Text = e.Result.Text
			}
		case "error":
			ans.Failure = e.Error
		}
		if emit != nil {
			emit(e)
		}
	}, execute)
	meter.Close() // a round that reported no usage is charged in full
	var f *llm.Failure
	switch {
	case errors.As(err, &f) && f.Code == "quota_exceeded":
		return ans, f
	case err != nil:
		return ans, fail("upstream_error", "the model failed: "+err.Error())
	}
	return ans, nil
}
