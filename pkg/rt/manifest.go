package rt

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
)

// Manifest is the runtime part of a page version's slop.json:
//
//	{"capabilities": {"db": {"rules": [...]}, "user": {"scopes": ["profile"]},
//	  "room": {"topics": {"ops": "interact"}}, "assets": {}, "downloads": true,
//	  "comments": {"composer_only": true}, "artifact": {}, "sample": {"images": true},
//	  "slop": {"permissions": ["versions:push"]}}}
//
// Every name but slop is the contract's; slop is slop's own extension: the
// management API, for apps an admin approved.
type Manifest struct {
	Capabilities map[string]json.RawMessage `json:"capabilities"`
}

// Caps is a parsed, validated capability set.
type Caps struct {
	Declared   map[string]bool
	Rules      Rules
	RuleList   []Rule
	Scopes     map[string]bool  // user scopes: profile, email
	Topics     map[string]Level // room topics opened below admin
	Composer   bool             // comments: composer_only
	Images     bool             // sample: images
	Permission []string         // slop: management API permissions
}

// ContractCaps are the capability names a manifest may declare. permissions
// is built in and never declared; self is the old name of artifact.
var ContractCaps = map[string]bool{"artifact": true, "assets": true, "comments": true, "db": true, "downloads": true,
	"files": true, "mcp": true, "room": true, "sample": true, "self": true, "user": true, "slop": true}

var topicRe = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,47}$`)

// ParseManifest reads the capabilities of a version manifest (raw slop.json).
// A version without capabilities is not an app: Declared is empty.
func ParseManifest(raw []byte, slopPermissions map[string]string) (Caps, error) {
	c := Caps{Declared: map[string]bool{}, Scopes: map[string]bool{}, Topics: map[string]Level{}}
	var m Manifest
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &m); err != nil {
			return c, fmt.Errorf("slop.json: %v", err)
		}
	}
	rules, err := CompileRules(nil)
	if err != nil {
		return c, err
	}
	c.Rules = rules
	for name, cfg := range m.Capabilities {
		if !ContractCaps[name] {
			return c, fmt.Errorf("capabilities: unknown capability %q", name)
		}
		if name == "self" {
			name = "artifact"
		}
		c.Declared[name] = true
		switch name {
		case "db":
			var d struct {
				Rules []Rule `json:"rules"`
			}
			if err := unmarshalCfg(cfg, &d); err != nil {
				return c, fmt.Errorf("capabilities.db: %v", err)
			}
			if c.Rules, err = CompileRules(d.Rules); err != nil {
				return c, fmt.Errorf("capabilities.db: %v", err)
			}
			c.RuleList = d.Rules
		case "user":
			var u struct {
				Scopes []string `json:"scopes"`
			}
			if err := unmarshalCfg(cfg, &u); err != nil {
				return c, fmt.Errorf("capabilities.user: %v", err)
			}
			for _, s := range u.Scopes {
				if s != "profile" && s != "email" {
					return c, fmt.Errorf("capabilities.user: unknown scope %q", s)
				}
				c.Scopes[s] = true
			}
		case "room":
			var r struct {
				Topics map[string]string `json:"topics"`
			}
			if err := unmarshalCfg(cfg, &r); err != nil {
				return c, fmt.Errorf("capabilities.room: %v", err)
			}
			if len(r.Topics) > MaxTopics {
				return c, fmt.Errorf("capabilities.room: at most %d topics", MaxTopics)
			}
			for t, lv := range r.Topics {
				l, ok := ParseLevel(lv)
				if !topicRe.MatchString(t) || !ok || (l != LevelInteract && l != LevelAdmin) {
					return c, fmt.Errorf("capabilities.room: topic %q: level must be interact or admin", t)
				}
				c.Topics[t] = l
			}
		case "comments":
			var cm struct {
				ComposerOnly bool `json:"composer_only"`
			}
			if err := unmarshalCfg(cfg, &cm); err != nil {
				return c, fmt.Errorf("capabilities.comments: %v", err)
			}
			c.Composer = cm.ComposerOnly
		case "sample":
			var s struct {
				Images bool `json:"images"`
			}
			if err := unmarshalCfg(cfg, &s); err != nil {
				return c, fmt.Errorf("capabilities.sample: %v", err)
			}
			c.Images = s.Images
		case "slop":
			var s struct {
				Permissions []string `json:"permissions"`
			}
			if err := unmarshalCfg(cfg, &s); err != nil {
				return c, fmt.Errorf("capabilities.slop: %v", err)
			}
			for _, p := range s.Permissions {
				if _, ok := slopPermissions[p]; !ok {
					return c, fmt.Errorf("capabilities.slop: unknown permission %q", p)
				}
			}
			c.Permission = append([]string(nil), s.Permissions...)
			sort.Strings(c.Permission)
		}
	}
	return c, nil
}

// IsApp reports whether the version declares any capability.
func (c Caps) IsApp() bool { return len(c.Declared) > 0 }

// unmarshalCfg accepts true, {} or an object.
func unmarshalCfg(raw json.RawMessage, dst any) error {
	if len(raw) == 0 || string(raw) == "true" || string(raw) == "null" {
		return nil
	}
	return json.Unmarshal(raw, dst)
}

// SlopPermissions are the management API permissions an app can ask for in
// its "slop" capability, in plain words for the approval dialog. Users,
// tokens and the audit log are never grantable; an admin approves each app
// version's list.
var SlopPermissions = map[string]string{
	"artifacts:read": "see artifacts and projects",
	"versions:read":  "read every version's files and records",
	"versions:push":  "push new versions of any artifact and move main",
	"routes:read":    "see every route and its history",
	"routes:write":   "point, add, remove and undo routes on every host",
	"threads:read":   "read comment threads",
	"threads:write":  "comment, reply and resolve threads",
	"events:read":    "follow live changes",
}
