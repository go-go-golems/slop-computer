package llm

// Building a request from what a caller sends (SLOP3-009 step 5): the same
// for pages, actors and the sample.run verb.

import (
	"encoding/json"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/ids"
)

func fail(code, msg string) *Failure { return &Failure{Code: code, Message: msg} }

// In is one call as its callers describe it.
type In struct {
	Input     json.RawMessage `json:"input"`
	ModelTier string          `json:"modelTier"`
	Model     string          `json:"model"`
	Effort    string          `json:"effort"`
	MaxTokens int             `json:"maxTokens"`
	Tools     []Tool          `json:"tools"`
	Images    []Image         `json:"images"`
}

// NewRequest builds and validates the backend request for in, with a call id
// beginning prefix (sc for pages, ac for actors, vc for verbs). Images are
// dropped unless the caller may send them. A refusal is invalid_argument,
// or prompt_too_large.
func NewRequest(prefix string, in In, images bool) (Request, error) {
	if in.ModelTier == "" || in.ModelTier == "inherit" {
		in.ModelTier = "default"
	}
	if !images {
		in.Images = nil
	}
	req := Request{CallID: prefix + ids.New("", 12), Input: in.Input, Images: in.Images, Tools: in.Tools,
		Options: Options{ModelTier: in.ModelTier, Model: in.Model, Effort: in.Effort}, MaxRounds: 10, MaxOutputTokens: in.MaxTokens}
	if err := ValidateRequest(req); err != nil {
		code := "invalid_argument"
		if strings.Contains(err.Error(), "exceeds") {
			code = "prompt_too_large"
		}
		return req, fail(code, err.Error())
	}
	return req, nil
}

// InputOf is a prompt or a list of messages as the request's input: a
// string, or a JSON list (the actor and verb forms).
func InputOf(v any) (json.RawMessage, error) {
	switch x := v.(type) {
	case string, []any:
		return json.Marshal(x)
	}
	return nil, fail("invalid_argument", "sample takes a string or a list of messages")
}

// ParseJSON is an answer's text as a JSON value, without a ```json fence.
func ParseJSON(text string) (any, error) {
	t := strings.TrimSpace(text)
	t = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(t, "```json"), "```"), "```")
	var x any
	if err := json.Unmarshal([]byte(strings.TrimSpace(t)), &x); err != nil {
		return nil, fail("invalid_argument", "the model did not answer with JSON")
	}
	return x, nil
}
