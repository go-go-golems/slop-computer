package verbs

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

)

// ConfirmTTL is how long a confirmation waits, and how long an approval
// lasts.
const ConfirmTTL = 2 * time.Minute

// A Confirmation is a governance change an app's actor asked to make for a
// person (SLOP3-002). The person allows it in the shell, outside the app's
// frame, or with slop confirm approve; until then the call fails with
// confirmation_required. An approval holds for the same person, view and
// call until it expires, so the app can simply retry.
type Confirmation struct {
	ID       string `json:"id"`
	Person   string `json:"-"`
	View     string `json:"-"`
	Hash     string `json:"-"`
	App      string `json:"app"`
	Title    string `json:"title"`
	Verb     string `json:"verb"`
	Summary  string `json:"summary"`
	Approved bool   `json:"approved"`
	Expires  int64  `json:"expiresAt"`
}

// Confirmations are kept in memory: they last two minutes.
type Confirmations struct {
	mu sync.Mutex
	m  map[string]*Confirmation
}

var redacted = map[string][]string{"secret.set": {"value"}}

// Check reports whether a call is approved; when it is not, it returns the
// pending confirmation the person must allow (the same one while it waits).
func (c *Confirmations) Check(person, view, app, title, verb string, args map[string]any) (*Confirmation, bool) {
	raw, _ := json.Marshal(args) // map keys are sorted: a canonical form
	sum := sha256.Sum256([]byte(verb + "\x00" + string(raw)))
	hash := hex.EncodeToString(sum[:])
	now := time.Now().UnixMilli()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[string]*Confirmation{}
	}
	var pending *Confirmation
	for id, x := range c.m {
		switch {
		case x.Expires < now:
			delete(c.m, id)
		case x.Person == person && x.View == view && x.Hash == hash:
			if x.Approved {
				return x, true
			}
			pending = x
		}
	}
	if pending != nil {
		return pending, false
	}
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	x := &Confirmation{ID: "cfm_" + hex.EncodeToString(b), Person: person, View: view, Hash: hash, App: app, Title: title,
		Verb: verb, Summary: summarize(verb, args), Expires: now + ConfirmTTL.Milliseconds()}
	c.m[x.ID] = x
	return x, false
}

// Get returns a person's unexpired confirmation.
func (c *Confirmations) Get(id, person string) (*Confirmation, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	x, ok := c.m[id]
	if !ok || x.Person != person || x.Expires < time.Now().UnixMilli() {
		return nil, false
	}
	cp := *x
	return &cp, true
}

// Approve allows a person's confirmation; the approval lasts ConfirmTTL.
func (c *Confirmations) Approve(id, person string) (*Confirmation, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	x, ok := c.m[id]
	if !ok || x.Person != person || x.Expires < time.Now().UnixMilli() {
		return nil, false
	}
	x.Approved = true
	x.Expires = time.Now().Add(ConfirmTTL).UnixMilli()
	cp := *x
	return &cp, true
}

// summarize describes a call from its verb and arguments (secret values
// left out): the server writes it, never the app.
func summarize(verb string, args map[string]any) string {
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := []string{verb}
	for _, k := range keys {
		v := fmt.Sprint(args[k])
		for _, r := range redacted[verb] {
			if r == k {
				v = "(hidden)"
			}
		}
		if len(v) > 80 {
			v = v[:80] + "…"
		}
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, " ")
}

// NewConfirmations is an empty confirmation book: the host owns one, and
// hands it to the doors that ask people to confirm.
func NewConfirmations() *Confirmations { return &Confirmations{} }
