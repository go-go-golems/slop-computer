package agent

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/httpapi"
	"sync/atomic"

	"github.com/go-go-golems/geppetto/pkg/events"
	"github.com/go-go-golems/geppetto/pkg/inference/engine"
	geptools "github.com/go-go-golems/geppetto/pkg/inference/tools"
	"github.com/go-go-golems/geppetto/pkg/turns"
	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// meteredEngine holds budget for each model round, as sample's rounds do
// (SLOP3-007): before the provider is contacted it checks the person's LLM
// access, reserves the round's estimated cost on the ledger and caps the
// round's output to the hold; the round's usage settles it, and a round
// that reported no usage is charged in full.
type meteredEngine struct {
	inner    engine.Engine
	ledger   *llm.Ledger
	payer    string
	audience string
	call     string
	maxOut   int
	round    atomic.Int64
}

var _ engine.Engine = (*meteredEngine)(nil)

func (m *meteredEngine) RunInference(ctx context.Context, t *turns.Turn) (*turns.Turn, error) {
	l := m.ledger.LLMFor(ctx, m.payer, m.audience)
	switch {
	case !l.Allowed:
		return nil, httpapi.Coded("permission_denied", "no LLM access")
	case l.Remaining != nil && *l.Remaining <= 0:
		return nil, httpapi.Coded("quota_exceeded", "token budget used up for this month")
	}
	meter := m.ledger.NewMeter(m.payer, l.Budget, m.call)
	defer meter.Close()
	est := llm.Estimate{InputTokens: estimate(ctx, t), MaxOutputTokens: int64(m.maxOut)}
	capped, err := meter.Before(ctx, int(m.round.Add(1)-1), est)
	var f *llm.Failure
	if errors.As(err, &f) {
		return nil, httpapi.Coded(f.Code, f.Message)
	}
	if err != nil {
		return nil, err
	}
	out := m.maxOut
	if capped > 0 && capped < int64(out) {
		out = int(capped)
	}
	cfg, _, _ := engine.KeyInferenceConfig.Get(t.Data)
	cfg.MaxResponseTokens = &out
	if err := engine.KeyInferenceConfig.Set(&t.Data, cfg); err != nil {
		return nil, err
	}
	return m.inner.RunInference(events.WithEventSinks(ctx, usageSink{meter}), t)
}

// estimate is a conservative input size: one token per byte of the turn,
// plus the tool definitions sent with the round and the request framing.
func estimate(ctx context.Context, t *turns.Turn) int64 {
	n := int64(framingTokens)
	if raw, err := json.Marshal(t.Blocks); err == nil {
		n += int64(len(raw))
	}
	if reg, ok := geptools.RegistryFrom(ctx); ok && reg != nil {
		if raw, err := json.Marshal(reg.ListTools()); err == nil {
			n += int64(len(raw))
		}
	}
	return n
}

// usageSink settles the round's hold with the provider's usage.
type usageSink struct{ meter *llm.BudgetMeter }

func (s usageSink) PublishEvent(e events.Event) error {
	if f, ok := e.(*events.EventProviderCallFinished); ok && f.Usage != nil {
		s.meter.Usage(llm.Usage{Input: int64(f.Usage.InputTokens), Output: int64(f.Usage.OutputTokens)})
	}
	return nil
}
