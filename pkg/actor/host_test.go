package actor

import (
	"context"
	"testing"

	"github.com/dop251/goja"
)

// BenchmarkHostRun is one entry into the VM with nothing to do: the cost a
// host adds to every turn (the engine's is a hand-off to its loop and back).
func BenchmarkHostRun(b *testing.B) {
	for _, rt := range []string{RuntimeDirect, RuntimeEngine} {
		b.Run(rt, func(b *testing.B) {
			m := &Manager{Runtime: rt}
			h, err := m.newHost(&Actor{m: m})
			if err != nil {
				b.Fatal(err)
			}
			defer func() { _ = h.Close(context.Background()) }()
			ctx := context.Background()
			fn := func(*goja.Runtime) error { return nil }
			b.ReportAllocs()
			for b.Loop() {
				if err := h.Run(ctx, "bench", fn); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkHostNew is making one actor runtime (and closing it).
func BenchmarkHostNew(b *testing.B) {
	for _, rt := range []string{RuntimeDirect, RuntimeEngine} {
		b.Run(rt, func(b *testing.B) {
			m := &Manager{Runtime: rt}
			b.ReportAllocs()
			for b.Loop() {
				h, err := m.newHost(&Actor{m: m})
				if err != nil {
					b.Fatal(err)
				}
				_ = h.Close(context.Background())
			}
		})
	}
}
