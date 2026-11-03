package sample

import (
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// RunIn is sample.run's input.
type RunIn struct {
	Input     any    `json:"input" slop:"pos=1" jsonschema_description:"a prompt, or a list of {role, content} messages ending on user"`
	ModelTier string `json:"modelTier,omitempty" jsonschema:"enum=quick,enum=default,enum=complex" jsonschema_description:"which kind of model"`
	Model     string `json:"model,omitempty" jsonschema_description:"a model id (sample.limits lists them); the tier applies when it is unusable"`
	Effort    string `json:"effort,omitempty" jsonschema:"enum=low,enum=medium,enum=high" jsonschema_description:"reasoning effort"`
	MaxTokens int    `json:"maxTokens,omitempty" jsonschema_description:"the most output tokens"`
}

// Part is one partial result of sample.run: the answer so far and what
// was added.
type Part struct {
	Text  string `json:"text"`
	Delta string `json:"delta"`
}

func init() {
	verbs.Register(verbs.Def[RunIn, llm.Answer]{
		Name: "sample.run",
		Doc: "Ask the model, as yourself: charged to your LLM budget, with no app in between. " +
			"The answer streams to callers that accept it (the CLI shows it on stderr).",
		Scope: verbs.Write, Effect: verbs.EffectStream, Action: authz.Account,
		Run: func(r verbs.Req, in RunIn) (llm.Answer, error) {
			sp := &Sampler{Sys: r.Env.Sys}
			if r.Env.A != nil {
				sp.Backend = r.Env.A.LLM
			}
			aud := ""
			if r.Env.K != nil && r.Env.K.Access != nil {
				aud = string(r.Env.K.Access.AudienceOf(r, r.Principal))
			}
			payer := ""
			if r.Principal != nil && r.Principal.Person != nil {
				payer = r.Principal.Person.ID
			}
			l, err := sp.Check(r, payer, aud)
			if err != nil {
				return llm.Answer{}, asVerbError(err)
			}
			raw, err := llm.InputOf(in.Input)
			if err != nil {
				return llm.Answer{}, asVerbError(err)
			}
			req, err := llm.NewRequest("vc", llm.In{Input: raw, ModelTier: in.ModelTier, Model: in.Model, Effort: in.Effort, MaxTokens: in.MaxTokens}, false)
			if err != nil {
				return llm.Answer{}, asVerbError(err)
			}
			ans, err := sp.Run(r, payer, l, req, func(e llm.Event) {
				if e.Type == "text" {
					_ = r.Emit(Part{Text: e.Text, Delta: e.Delta})
				}
			}, nil)
			if err != nil {
				return ans, asVerbError(err)
			}
			if ans.Failure != nil {
				return ans, asVerbError(ans.Failure)
			}
			return ans, nil
		},
	}.Verb())
}

// asVerbError is a sample refusal as a verb error, with its code.
func asVerbError(err error) error {
	if f, ok := err.(*llm.Failure); ok {
		return verbs.Errf(f.Code, "%s", f.Message)
	}
	return err
}
