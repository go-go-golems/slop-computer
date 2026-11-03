// Package llm is the model backend interface for the sample capability.
// gepp implements it on Geppetto with Pi's agent directory (~/.pi/agent:
// models, credentials, settings); credentials stay in Pi's files on the
// server host, and pages only see text. Fake is the deterministic backend
// for tests and --llm fake.
//
// Copied from slop-computer pkg/piworker (itself ported from
// github.com/go-go-golems/francois pkg/piworker).
package llm

import (
	"context"
	"encoding/json"
)

type Model struct {
	Provider       string   `json:"provider"`
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Reasoning      bool     `json:"reasoning"`
	ThinkingLevels []string `json:"thinkingLevels,omitempty"`
	Images         bool     `json:"images"`
	Tier           string   `json:"tier,omitempty"`
}
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
}
type Options struct {
	ModelTier string `json:"modelTier"`
	Model     string `json:"model,omitempty"`
	Effort    string `json:"effort,omitempty"`
}
type Image struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}
type Request struct {
	Images  []Image         `json:"images,omitempty"`
	CallID  string          `json:"callId"`
	Input   json.RawMessage `json:"input"`
	Options Options         `json:"options"`
	Tools   []Tool          `json:"tools,omitempty"`
	// MaxRounds bounds tool rounds; only the server sets it (0 = default 5).
	MaxRounds       int `json:"maxRounds,omitempty"`
	MaxOutputTokens int `json:"maxOutputTokens,omitempty"`
	// Meter is asked before each model round (SLOP3-007 phase 5); nil
	// meters nothing. Only the server sets it.
	Meter Meter `json:"-"`
}

// Meter reserves budget before a model round. Before returns the round's
// output cap (0: no cap), which the backend must apply so the round cannot
// spend more than its hold, or an error that ends the call before the
// provider is contacted (a *Failure with code quota_exceeded when the
// budget is used up).
type Meter interface {
	Before(ctx context.Context, round int, est Estimate) (int64, error)
}

// Estimate is what a round may cost: a conservative input size (one token
// per byte of context) and the output the backend would allow.
type Estimate struct {
	InputTokens     int64
	MaxOutputTokens int64 // 0: the backend has no cap of its own
}
type Result struct {
	Thinking         string  `json:"thinking,omitempty"`
	FinalText        *string `json:"finalText,omitempty"`
	Text             string  `json:"text"`
	Truncated        bool    `json:"truncated"`
	ModelTierApplied string  `json:"modelTierApplied"`
	ModelApplied     string  `json:"modelApplied,omitempty"`
	ModelUsed        string  `json:"modelUsed,omitempty"`
}
type Failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Text    string `json:"text,omitempty"`
}

func (f *Failure) Error() string { return f.Message }

type Event struct {
	Type       string          `json:"type"`
	CallID     string          `json:"callId"`
	Text       string          `json:"text,omitempty"`
	Delta      string          `json:"delta,omitempty"`
	ToolCallID string          `json:"toolCallId,omitempty"`
	Name       string          `json:"name,omitempty"`
	Input      json.RawMessage `json:"input,omitempty"`
	Result     *Result         `json:"result,omitempty"`
	Error      *Failure        `json:"error,omitempty"`
	Models     []Model         `json:"models,omitempty"`
	Usage      *Usage          `json:"usage,omitempty"`
}

// Usage is a private per-round accounting event; it is never forwarded to
// pages. Cost may be zero or estimated for subscription/OAuth providers.
type Usage struct {
	Input      int64   `json:"input"`
	Output     int64   `json:"output"`
	CacheRead  int64   `json:"cacheRead"`
	CacheWrite int64   `json:"cacheWrite"`
	Cost       float64 `json:"cost"`
	Model      string  `json:"model,omitempty"`
}
type ToolResult struct {
	Value   json.RawMessage `json:"value"`
	IsError bool            `json:"isError"`
}
type ExecuteTool func(context.Context, Event) (ToolResult, error)
type Backend interface {
	Models() []Model
	Sample(context.Context, Request, func(Event), ExecuteTool) error
	Close() error
}

// Answer is what one whole call came to (pkg/caps/sample): the final text,
// the model that answered, and the tokens it used. Failure is an error the
// backend reported as an event (already streamed to a caller that streams).
type Answer struct {
	Text    string      `json:"text"`
	Model   string      `json:"model"`
	Usage   AnswerUsage `json:"usage"`
	Result  *Result     `json:"-"`
	Failure *Failure    `json:"-"`
}

// AnswerUsage is an answer's tokens, over all its rounds.
type AnswerUsage struct {
	Input  int64 `json:"input"`
	Output int64 `json:"output"`
}
