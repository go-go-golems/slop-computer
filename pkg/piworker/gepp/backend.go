// Package gepp is the sample backend on Geppetto: Pi's agent directory
// (models, credentials, settings) through geppetto's providers/pi, and one
// Geppetto engine call per round. It replaces the Node worker
// (web/piworker) with the same behaviour: tiers, explicit models, effort,
// page tools over rounds, one output budget per call, Pi's error codes.
package gepp

import (
	"crypto/rand"
	"encoding/hex"
	"strings"

	"github.com/go-go-golems/geppetto/pkg/steps/ai/providers/pi"
	"github.com/go-go-golems/slop-computer/pkg/piworker"
	"github.com/pkg/errors"
)

var tierNames = []string{"quick", "default", "complex"}

// Config configures New.
type Config struct {
	// AgentDir is Pi's agent directory (~/.pi/agent).
	AgentDir string
	// Tiers maps quick/default/complex to "provider/model[:thinking]"; an
	// empty tier uses Pi's default model.
	Tiers map[string]string
	// Options are passed to pi.LoadAgentDir (tests: WithLocalProviders, WithEnv).
	Options []pi.Option
}

// Backend implements piworker.Backend.
type Backend struct {
	dir      *pi.AgentDir
	tiers    map[string]choice
	baseline string // settings.json's defaultThinkingLevel; "" when off
	models   []piworker.Model
}

var _ piworker.Backend = (*Backend)(nil)

// choice is a model with the thinking level its reference named, if any.
type choice struct {
	model pi.Model
	level string // "", or a Pi level ("off" included)
}

// New loads the agent directory and picks the tier models, as the Node
// worker's init does.
func New(cfg Config) (*Backend, error) {
	opts := append([]pi.Option{
		pi.WithProviderHeaders("lunaroute", lunarouteHeaders()),
	}, cfg.Options...)
	dir, err := pi.LoadAgentDir(cfg.AgentDir, opts...)
	if err != nil {
		return nil, err
	}
	b := &Backend{dir: dir, tiers: map[string]choice{}}
	if l := dir.Settings.DefaultThinkingLevel; l != "off" {
		b.baseline = l
	}
	available := dir.Available()
	eligible := map[string]pi.Model{}
	for _, m := range available {
		eligible[m.Ref()] = m
	}
	preferred, ok := b.preferred(eligible, available)
	for _, tier := range tierNames {
		ref := cfg.Tiers[tier]
		if ref == "" {
			if !ok {
				return nil, errors.Errorf("no authenticated model for %s: configure Pi or pass --model-%s", tier, tier)
			}
			b.tiers[tier] = choice{model: preferred}
			continue
		}
		c, found := b.lookup(ref, eligible)
		if !found {
			return nil, errors.Errorf("no authenticated model %q for %s", ref, tier)
		}
		b.tiers[tier] = c
	}
	seen := map[string]bool{}
	for _, tier := range tierNames {
		m := b.tiers[tier].model
		if !seen[m.Ref()] {
			b.models = append(b.models, publicModel(m, tier))
			seen[m.Ref()] = true
		}
	}
	for _, m := range available {
		if !seen[m.Ref()] {
			b.models = append(b.models, publicModel(m, ""))
		}
	}
	return b, nil
}

// preferred is Pi's default model when it is eligible and in the enabled
// scope, else the first eligible enabled model, else the first eligible one.
func (b *Backend) preferred(eligible map[string]pi.Model, available []pi.Model) (pi.Model, bool) {
	s := b.dir.Settings
	scope := s.EnabledModels
	inScope := func(ref string) bool {
		if len(scope) == 0 {
			return true
		}
		for _, p := range scope {
			if p == ref {
				return true
			}
		}
		return false
	}
	if def := s.DefaultProvider + "/" + s.DefaultModel; s.DefaultModel != "" {
		if m, ok := eligible[def]; ok && inScope(def) {
			return m, true
		}
	}
	for _, p := range scope {
		if m, ok := eligible[p]; ok {
			return m, true
		}
	}
	if len(available) > 0 {
		return available[0], true
	}
	return pi.Model{}, false
}

// lookup resolves "provider/id[:level]" or a bare id that names exactly one
// eligible model.
func (b *Backend) lookup(ref string, eligible map[string]pi.Model) (choice, bool) {
	ref = strings.TrimSpace(ref)
	level := ""
	if i := strings.LastIndex(ref, ":"); i > 0 && isLevel(ref[i+1:]) {
		ref, level = ref[:i], ref[i+1:]
	}
	if m, ok := eligible[ref]; ok {
		return choice{model: m, level: level}, true
	}
	if strings.Contains(ref, "/") {
		return choice{}, false
	}
	var found []pi.Model
	for _, m := range eligible {
		if m.ID == ref {
			found = append(found, m)
		}
	}
	if len(found) != 1 {
		return choice{}, false
	}
	return choice{model: found[0], level: level}, true
}

func isLevel(s string) bool {
	switch s {
	case "off", "minimal", "low", "medium", "high", "xhigh":
		return true
	}
	return false
}

func publicModel(m pi.Model, tier string) piworker.Model {
	return piworker.Model{Provider: m.Provider, ID: m.ID, Name: m.Name, Reasoning: m.Reasoning,
		ThinkingLevels: m.ThinkingLevels(), Images: m.Images(), Tier: tier}
}

// Models lists the tier models first, then every other available model.
func (b *Backend) Models() []piworker.Model { return append([]piworker.Model(nil), b.models...) }

// Close releases nothing: engines hold no long-lived resources.
func (b *Backend) Close() error { return nil }

// lunarouteHeaders are the headers Pi's lunaroute extension sends (see
// web/piworker/src/lunaroute.ts): an agent name and a per-process session.
func lunarouteHeaders() map[string]string {
	var buf [16]byte
	_, _ = rand.Read(buf[:])
	session := hex.EncodeToString(buf[:])
	return map[string]string{"lunaroute-agent": "slop", "x-lunaroute-session": session, "lunaroute-session-id": session}
}
