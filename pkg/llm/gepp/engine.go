package gepp

import (
	"context"

	"github.com/go-go-golems/geppetto/pkg/inference/engine"
	"github.com/go-go-golems/geppetto/pkg/steps/ai/providers/pi"
	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// Engine is the Geppetto engine for options (tier, explicit model, effort),
// as sample's rounds use it: the agent capability's engine source. An empty
// or "inherit" tier is the default tier.
func (b *Backend) Engine(ctx context.Context, o llm.Options) (engine.Engine, llm.EngineInfo, error) {
	if o.ModelTier == "" || o.ModelTier == "inherit" {
		o.ModelTier = "default"
	}
	ch, _ := b.pick(o)
	res, err := b.dir.Resolve(ctx, ch.model.Ref(), pi.ResolveOptions{Thinking: b.level(o, ch)})
	if err != nil {
		return nil, llm.EngineInfo{}, err
	}
	eng, err := res.Engine()
	if err != nil {
		return nil, llm.EngineInfo{}, err
	}
	return eng, llm.EngineInfo{Model: ch.model.Ref(), MaxTokens: ch.model.MaxTokens}, nil
}
