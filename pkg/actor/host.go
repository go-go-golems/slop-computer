package actor

// The actor reaches its JavaScript runtime only through a host (SLOP3-016
// design doc 02, "migrating the actor VM to a go-go-goja engine runtime").
// Every entry into the VM from Go (loading actor.js, an event's turn,
// activation's setup) is one host.Run; module code runs inside those calls
// and keeps using the VM directly.
//
// The one host is engineHost: a go-go-goja engine runtime, whose event loop
// owns the VM (enginehost.go). The bare goja runtime driven by the caller's
// goroutine (directHost, actors.runtime: direct) was removed in SLOP3-021.

import (
	"context"
	"time"

	"github.com/dop251/goja"
)

// vmHost owns an actor's VM.
type vmHost interface {
	// VM is the runtime. Use it only inside Run (module code called from
	// JavaScript runs inside Run).
	VM() *goja.Runtime
	// Run executes fn with exclusive use of the VM and returns its error.
	// op names the entry for tracing ("load", "setup", "turn action").
	Run(ctx context.Context, op string, fn func(vm *goja.Runtime) error) error
	// Interrupt stops the JavaScript running in the VM (any goroutine).
	Interrupt(reason any)
	// ClearInterrupt clears an interrupt that did not stop anything.
	ClearInterrupt()
	// Close releases the runtime. The actor never uses it afterwards.
	Close(ctx context.Context) error
}

// enter runs fn on the actor's VM through its host (and the manager's
// Around hook, when one is set).
func (a *Actor) enter(ctx context.Context, op string, fn func(vm *goja.Runtime) error) error {
	around := a.m.Around
	return a.host.Run(ctx, op, func(vm *goja.Runtime) error {
		if around == nil {
			return fn(vm)
		}
		return around(op, func() error { return fn(vm) })
	})
}

// limited runs fn under the turn limit: after it the host interrupts
// the JavaScript with reason. Call it inside enter.
func (a *Actor) limited(reason string, fn func() error) error {
	timer := time.AfterFunc(a.m.turnLimit(), func() { a.host.Interrupt(reason) })
	defer func() {
		timer.Stop()
		a.host.ClearInterrupt()
	}()
	return fn()
}

// release closes the actor's runtime (a build that is not used, an actor
// whose loop ended, activation's throwaway actor).
func (a *Actor) release() {
	if a == nil || a.host == nil {
		return
	}
	_ = a.host.Close(context.Background())
}
