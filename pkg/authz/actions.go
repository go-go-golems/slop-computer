// Package authz names what operations do. Every verb and every runtime
// method declares an Action; the action's Spec is the least access any
// caller needs, checked by the dispatcher before the operation runs. An
// operation may ask for more (db rules per path, D9 for app code, policy
// cells), never for less.
package authz

import (
	"fmt"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// Action is what an operation does.
type Action string

// Actions on one store, named by the operation's arguments (verbs) or the
// view's target (runtime methods).
const (
	StoreRead  Action = "store.read"  // metadata, files, refs, the log, bindings
	DocRead    Action = "doc.read"    // documents; the db rules decide per path
	DocWrite   Action = "doc.write"   // documents; the db rules decide per path
	ActorCall  Action = "actor.call"  // an actor action; the actor decides further
	Room       Action = "room"        // rooms; the manifest's topic levels decide further
	UserRead   Action = "user.read"   // profiles; the manifest's scopes and the user.email cell
	Sample     Action = "sample"      // models; the sample cell, LLM access and budget
	AssetWrite Action = "asset.write" // uploads; the assets cell, and a person to own them
	StoreAdmin Action = "store.admin" // files, snapshots, refs, grants, bindings, alarms, SQL
	CodePush   Action = "code.push"   // replacing an app's code (the artifact capability; D9)
	StoreOwner Action = "store.owner" // share links
)

// Actions not on one store.
const (
	StoreCreate   Action = "store.create"   // a new store, owned by the caller
	Account       Action = "account"        // the caller's own tokens, billing, confirmations; admins may look at others
	Platform      Action = "platform"       // facts about the server anyone may read
	PlatformAdmin Action = "platform.admin" // people, policy, LLM access, secrets, trust, mounts
	Program       Action = "program"        // eval and imports: each step is checked as it runs
)

// Spec is an action's floor.
type Spec struct {
	Store bool     // the action is on one store
	Level rt.Level // the least level there
	Admin bool     // the caller must be an admin
}

// Specs is the table of actions.
var Specs = map[Action]Spec{
	StoreRead:  {Store: true, Level: rt.LevelView},
	DocRead:    {Store: true, Level: rt.LevelView},
	DocWrite:   {Store: true, Level: rt.LevelView},
	ActorCall:  {Store: true, Level: rt.LevelView},
	Room:       {Store: true, Level: rt.LevelView},
	UserRead:   {Store: true, Level: rt.LevelView},
	Sample:     {Store: true, Level: rt.LevelView},
	AssetWrite: {Store: true, Level: rt.LevelInteract},
	StoreAdmin: {Store: true, Level: rt.LevelAdmin},
	CodePush:   {Store: true, Level: rt.LevelAdmin, Admin: true},
	StoreOwner: {Store: true, Level: rt.LevelOwner},

	StoreCreate:   {},
	Account:       {},
	Platform:      {},
	PlatformAdmin: {Admin: true},
	Program:       {},
}

// Of is a's spec; ok is false for an undeclared action.
func Of(a Action) (Spec, bool) {
	s, ok := Specs[a]
	return s, ok
}

// Floor decides whether a caller holding level on the action's store, with
// the admin role or not, clears act's floor; why says what is missing.
// The dispatchers (verbs.Call, the runtime's viewRPC) and explain.can all
// decide with it.
func Floor(act Action, level rt.Level, admin bool) (ok bool, why string) {
	spec, known := Specs[act]
	switch {
	case !known:
		return false, fmt.Sprintf("%q is not an action", act)
	case spec.Admin && !admin:
		return false, fmt.Sprintf("%s is for admins", act)
	case spec.Store && level < spec.Level:
		return false, fmt.Sprintf("%s needs %s on the store, not %s", act, spec.Level, level)
	}
	return true, ""
}
