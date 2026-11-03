package actors

import (
	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/actor"
)

// roomModule is use('room') in actors: the room capability (pkg/caps/room)
// for the actor's own store. emit reaches the store's views once the turn
// commits; peers lists who has a page open in the unnamed room.
func (s *Door) roomModule(a *actor.Actor) goja.Value {
	o := a.VM().NewObject()
	id := a.Store().ID
	_ = o.Set("emit", func(topic string, data goja.Value) goja.Value {
		payload := a.FromJS(data)
		if s.Rooms != nil {
			a.AfterCommit(func() { s.Rooms.EmitFromStore(id, topic, payload) })
		}
		return goja.Undefined()
	})
	_ = o.Set("peers", func() goja.Value {
		if s.Rooms == nil {
			return a.VM().NewArray()
		}
		return a.ToJS(s.Rooms.StorePeers(id))
	})
	return o
}
