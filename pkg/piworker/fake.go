package piworker

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// Fake is an explicitly selected deterministic backend for offline verification.
type Fake struct{}

var _ Backend = (*Fake)(nil)

func (f *Fake) Models() []Model {
	return []Model{{Provider: "test", ID: "fake", Name: "Deterministic test model", Tier: "all", Images: true}}
}
func (f *Fake) Close() error { return nil }
func (f *Fake) Sample(ctx context.Context, r Request, emit func(Event), execute ExecuteTool) error {
	text := "slop is connected."
	if strings.Contains(string(r.Input), "fixture:json") {
		text = `{"ok":true}`
	}
	if strings.Contains(string(r.Input), "fixture:stream") {
		text = ""
		for _, delta := range []string{"first ", "second ", "third"} {
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
			text += delta
			emit(Event{Type: "text", CallID: r.CallID, Text: text, Delta: delta})
		}
		emit(Event{Type: "result", CallID: r.CallID, Result: &Result{Text: text, ModelTierApplied: r.Options.ModelTier, ModelUsed: "test/fake"}})
		return nil
	}
	if len(r.Tools) > 0 {
		args := json.RawMessage(`{}`)
		if r.Tools[0].Name == "eval" {
			args = json.RawMessage(`{"code":"return 1;"}`)
		}
		result, err := execute(ctx, Event{Type: "tool", CallID: r.CallID, ToolCallID: "fake-tool", Name: r.Tools[0].Name, Input: args})
		if err != nil {
			return err
		}
		if result.IsError {
			text = "The browser tool reported an error."
		} else {
			text = "The browser tool completed successfully."
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if r.MaxOutputTokens > 0 && len(text) > r.MaxOutputTokens {
		text = text[:r.MaxOutputTokens]
	}
	emit(Event{Type: "usage", CallID: r.CallID, Usage: &Usage{Input: int64(len(r.Input)), Output: int64(len(text)), Model: "test/fake"}})
	emit(Event{Type: "text", CallID: r.CallID, Text: text, Delta: text})
	emit(Event{Type: "result", CallID: r.CallID, Result: &Result{Text: text, ModelTierApplied: r.Options.ModelTier, ModelApplied: r.Options.Model, ModelUsed: "test/fake"}})
	return nil
}
