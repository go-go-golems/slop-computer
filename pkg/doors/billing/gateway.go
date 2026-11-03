package billing

import (
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
)

// Gateway builds the Stripe gateway the config's stripe block names, and
// whether its key is a live one; nil without a stripe block (only comps
// exist then).
func Gateway(cfg *config.Config) (stripe.Gateway, bool, error) {
	c := cfg.Stripe
	if c.SecretKeyFile == "" {
		return nil, false, nil
	}
	key, err := web.ReadSecret(c.SecretKeyFile)
	if err != nil {
		return nil, false, err
	}
	var hooks []string
	if c.WebhookSecretFile != "" {
		h, err := web.ReadSecret(c.WebhookSecretFile)
		if err != nil {
			return nil, false, err
		}
		hooks = strings.Fields(h) // current and previous, for rotation
	}
	g, err := stripe.NewStripe(key, hooks)
	if err != nil {
		return nil, false, err
	}
	return g, strings.HasPrefix(key, "sk_live_") || strings.HasPrefix(key, "rk_live_"), nil
}
