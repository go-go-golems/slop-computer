package verbs

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// Env is what verbs work against; every door shares one.
type Env struct {
	Cfg *config.Config
	Sys *system.DB
	K   *kernel.Kernel
	A   *actor.Manager

	// Billing is the Stripe service (nil without a stripe config).
	Billing *stripe.Service

	// Views that a verb's change affects learn of it from the system log
	// (the page door follows it: SLOP3-009 step 3), not from callbacks.

	confirms     *Confirmations
	confirmsOnce sync.Once
}

// open checks that p holds need on a store and opens it. A denial carries
// the access trace; a store p may not see at all reads as not_found.
func (e *Env) open(ctx context.Context, p *access.Principal, id string, need rt.Level, what string) (*store.Store, access.Decision, error) {
	if id == "" {
		return nil, access.Decision{}, Errf("invalid_argument", "which store?")
	}
	d, _, err := e.K.Access.Can(ctx, p, id, need, what, false)
	if err != nil {
		return nil, d, err
	}
	if !d.OK {
		if d.Code == "not_found" {
			return nil, d, &Error{Code: "not_found", Message: "no store " + id}
		}
		return nil, d, &Error{Code: d.Code, Message: what + " on " + id + " needs " + need.String(), Trace: d.Trace}
	}
	s, err := e.K.Store(ctx, id)
	if errors.Is(err, kernel.ErrNoStore) {
		return nil, d, &Error{Code: "not_found", Message: "no store " + id}
	}
	return s, d, err
}

// who is the store.Who for a principal acting with a decided level.
func who(p *access.Principal, d access.Decision) store.Who {
	return store.Who{ID: p.ID(), Via: p.ViaLabel(), Level: d.LevelName(), Code: authz.CodeRightOf(p)}
}

// fileErr maps an error from a file, snapshot or ref write: a D9 refusal
// keeps its code; anything else is a bad argument.
func fileErr(err error) error {
	if err == nil || errors.Is(err, store.ErrAppCode) {
		return storeErr(err)
	}
	var ve *Error
	if errors.As(err, &ve) {
		return ve
	}
	return Errf("invalid_argument", "%s", err.Error())
}

// storeErr maps store errors to verb errors.
func storeErr(err error) error {
	var de *store.DocError
	var ve *Error
	switch {
	case err == nil:
		return nil
	case errors.As(err, &ve):
		return ve
	case errors.Is(err, store.ErrAppCode):
		return &Error{Code: "permission_denied", Message: err.Error()}
	case errors.As(err, &de):
		code := "invalid_argument"
		if strings.HasPrefix(de.Msg, "conflict") {
			code = "conflict"
		} else if strings.HasPrefix(de.Msg, "quota_exceeded") {
			code = "quota_exceeded"
		}
		return &Error{Code: code, Message: de.Msg}
	case errors.Is(err, store.ErrNotFound):
		return &Error{Code: "not_found", Message: err.Error()}
	}
	return err
}

// norm round-trips a value through JSON so numbers are json.Number, as
// they are when read back from a store.
func norm(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		return v
	}
	return decodeJSON(b)
}

func decodeJSON(b []byte) any {
	var out any
	dec := json.NewDecoder(bytesReader(b))
	dec.UseNumber()
	if dec.Decode(&out) != nil {
		return nil
	}
	return out
}

// obj returns an argument as a JSON object (an object, or a string of one).
func (a Args) obj(k string) (map[string]any, bool) {
	switch v := a[k].(type) {
	case map[string]any:
		m, _ := norm(v).(map[string]any)
		return m, true
	case string:
		if m, ok := decodeJSON([]byte(v)).(map[string]any); ok {
			return m, true
		}
	}
	return nil, false
}

// list returns an argument as a JSON array (an array, or a string of one).
func (a Args) list(k string) ([]any, bool) {
	switch v := a[k].(type) {
	case []any:
		l, _ := norm(v).([]any)
		return l, true
	case string:
		if l, ok := decodeJSON([]byte(v)).([]any); ok {
			return l, true
		}
	}
	return nil, false
}
