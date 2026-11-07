package actor

// engineHost runs an actor's VM on a go-go-goja engine runtime (SLOP3-016
// design doc 02, phase 2). The runtime's event loop owns the VM; every
// host.Run is one Owner.Call from the actor's goroutine, which waits for
// it, so events still run one at a time in inbox order.
//
// The runtime is built empty: no default modules (even the data-only set
// has timers) and none of the globals the engine would install (console,
// console timers, performance, Buffer, URL). The actor installs its own
// globals in load, as on the direct host.
//
// Modules from go-go-goja find the runtime's owner through runtimebridge.
// The actor gives them a turnOwner instead of the engine's: a Post becomes
// a continuation turn, and a Call runs only inside a turn.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/dop251/goja"
	"github.com/go-go-golems/go-go-goja/pkg/engine"
	"github.com/go-go-golems/go-go-goja/pkg/runtimebridge"
)

// Runtimes an actor can run on (slop.yaml actors.runtime).
const (
	RuntimeDirect = "direct" // a bare goja runtime (default)
	RuntimeEngine = "engine" // a go-go-goja engine runtime
)

// engineFactory builds the actor runtimes of one manager.
type engineFactory struct {
	once sync.Once
	f    *engine.RuntimeFactory
	err  error
}

func (ef *engineFactory) get() (*engine.RuntimeFactory, error) {
	ef.once.Do(func() {
		ef.f, ef.err = engine.NewRuntimeFactoryBuilder(
			engine.WithImplicitDefaultRegistryModules(false),
			engine.WithDataOnlyDefaultRegistryModules(false),
			engine.WithoutDefaultGlobals(engine.DefaultGlobals()...),
		).Build()
	})
	return ef.f, ef.err
}

// newHost makes the host of a new actor, on the manager's runtime.
func (m *Manager) newHost(a *Actor) (vmHost, error) {
	switch m.Runtime {
	case "", RuntimeDirect:
		return newDirectHost(), nil
	case RuntimeEngine:
		f, err := m.engines.get()
		if err != nil {
			return nil, err
		}
		h := &engineHost{}
		rt, err := f.NewRuntime(engine.WithRuntimeBridgeOwner(func(_ *goja.Runtime, base runtimebridge.RuntimeOwner) runtimebridge.RuntimeOwner {
			return &turnOwner{a: a, h: h, base: base}
		}))
		if err != nil {
			return nil, err
		}
		h.rt = rt
		return h, nil
	}
	return nil, fmt.Errorf("unknown actor runtime %q (direct or engine)", m.Runtime)
}

// engineHost is an engine runtime driven through its owner.
type engineHost struct {
	rt *engine.Runtime
	// inRun is true while a Run's function executes on the loop: the only
	// time a module may touch the VM. loopG is the loop's goroutine.
	inRun atomic.Bool
	loopG atomic.Uint64
}

var _ vmHost = (*engineHost)(nil)

func (h *engineHost) VM() *goja.Runtime { return h.rt.VM }

// Run executes fn on the loop and waits for it. The context is never
// cancelled under a running call (a turn's transaction is in use there;
// the turn limit bounds it instead). A panic in fn is carried back and
// raised again on the caller's goroutine, so a turn that panics fails as
// it does on the direct host ("turn panicked", a crash).
func (h *engineHost) Run(ctx context.Context, op string, fn func(vm *goja.Runtime) error) error {
	var (
		panicked bool
		value    any
	)
	_, err := h.rt.Owner.Call(context.WithoutCancel(ctx), op, func(_ context.Context, vm *goja.Runtime) (any, error) {
		if h.loopG.Load() == 0 {
			h.loopG.Store(goid())
		}
		h.inRun.Store(true)
		defer func() {
			h.inRun.Store(false)
			if r := recover(); r != nil {
				panicked, value = true, r
			}
		}()
		return nil, fn(vm)
	})
	if panicked {
		panic(value)
	}
	return err
}

func (h *engineHost) Interrupt(reason any) { h.rt.VM.Interrupt(reason) }

func (h *engineHost) ClearInterrupt() { h.rt.VM.ClearInterrupt() }

// Close stops the runtime's loop (once; later calls do nothing).
func (h *engineHost) Close(ctx context.Context) error { return h.rt.Close(ctx) }

// onLoop reports whether the caller is the loop inside a Run.
func (h *engineHost) onLoop() bool {
	return h.inRun.Load() && h.loopG.Load() == goid()
}

// turnOwner is the owner go-go-goja modules see for an actor's VM.
type turnOwner struct {
	a    *Actor
	h    *engineHost
	base runtimebridge.RuntimeOwner
}

var _ runtimebridge.RuntimeOwner = (*turnOwner)(nil)

// errOutsideTurn: a module reached for the VM when no turn was running.
var errOutsideTurn = errors.New("actor: a module used the runtime outside a turn")

// Call runs fn on the VM, only inside a turn: a module calling from its own
// goroutine would otherwise run JavaScript between turns, outside any
// transaction. Inside a turn, on the loop, it runs at once.
func (o *turnOwner) Call(ctx context.Context, op string, fn func(context.Context, *goja.Runtime) (any, error)) (any, error) {
	return o.base.Call(ctx, op, func(ctx context.Context, vm *goja.Runtime) (any, error) {
		if !o.h.inRun.Load() {
			return nil, errOutsideTurn
		}
		return fn(ctx, vm)
	})
}

// Post schedules fn as a continuation turn of the event being handled (as
// io does): it runs later, in its own transaction, as that event's visitor.
// A Post from the module's own goroutine cannot say which event it belongs
// to and is refused: such modules are not bridged (design doc 02, D2).
func (o *turnOwner) Post(ctx context.Context, op string, fn func(context.Context, *goja.Runtime)) error {
	if !o.h.onLoop() || o.a.cur == nil {
		o.a.log("error", "a module settled "+op+" outside a turn; it was dropped")
		return errOutsideTurn
	}
	ev := o.a.cur.ev
	if ev.parent != nil {
		ev = ev.parent
	}
	ctx = context.WithoutCancel(ctx)
	o.a.continueWith(ev, func() error {
		fn(ctx, o.a.vm)
		return nil
	})
	return nil
}

// goid is the current goroutine's id (from its stack header).
func goid() uint64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	f := bytes.Fields(buf[:n])
	if len(f) < 2 {
		return 0
	}
	id, _ := strconv.ParseUint(string(f[1]), 10, 64)
	return id
}

// Runtime names what the actor runs on: RuntimeDirect or RuntimeEngine.
func (a *Actor) Runtime() string {
	if _, ok := a.host.(*engineHost); ok {
		return RuntimeEngine
	}
	return RuntimeDirect
}
