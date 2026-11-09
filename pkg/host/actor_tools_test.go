package host

import (
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// SLOP3-016 phase 6: an actor's sample takes tools whose execute functions
// are the actor's own JavaScript. Each tool call runs in its own turn of the
// event that called sample: its writes commit with that turn, and a tool
// that throws rolls its turn back and the model reads the error. A tool may
// itself await I/O.
const toolsActor = `
const sample = use('sample'), db = use('db');
defineActor({ actions: {
  agent: { requires: 'interact', async run(ctx, args) {
    const mode = (args && args.mode) || 'ok';
    const r = await sample('use the tool', { tools: [
      { name: 'note', description: 'write a note', inputSchema: { type: 'object', properties: {} },
        execute(input) {
          db.doc('notes/' + mode).set({ by: ctx.visitor.id, mode });
          if (mode === 'throw') throw new Error('nope');
          // awaits I/O, writes in the continuation turn, then throws: that
          // turn rolls back (SLOP3-017 F8)
          if (mode === 'late') return (async () => { await sample('hi'); db.doc('notes/after').set({ after: true }); throw new Error('after the await'); })();
          if (mode === 'nested') return (async () => { const inner = await sample('hi'); return { inner: inner.text }; })();
          return { ok: true };
        } },
    ] });
    return { text: r.text, written: db.doc('notes/' + mode).get().exists, after: db.doc('notes/after').get().exists };
  } },
  optional: { requires: 'interact', run() {
    db.doc('x/1').set({ at: 2 }); db.doc('x/2').set({ at: 1 });
    return { first: db.collection('x').orderBy('at').get().docs[0].id, files: use('files').list().length };
  } },
  bad: { requires: 'interact', async run() {
    return await sample('x', { tools: [{ name: 'nothing' }] });
  } },
} });`

func TestActorSampleTools(t *testing.T) {
	h := newHarness(t)
	h.a.SetLLM(&llm.Fake{})
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "tools"})
	h.call(admin, "files.push", map[string]any{"store": "tools", "files": files(map[string]string{
		"app.json": `{"title":"Tools","actor":"actor.js","capabilities":{"sample":{},"db":{}}}`,
		"actor.js": toolsActor,
	})})
	h.call(admin, "policy.set", map[string]any{"app": "tools", "capability": "sample", "audience": "@member", "value": "on"})
	agent := func(mode string) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "tools", "action": "agent", "args": map[string]any{"mode": mode}}).(map[string]any)
	}
	// The fake model calls the first tool once, then says how it went.
	if r := agent("ok"); r["text"] != "The browser tool completed successfully." || r["written"] != true {
		t.Fatalf("ok: %v", r)
	}
	// The tool threw after writing: its turn rolled back; the model read
	// the error, and the handler went on.
	if r := agent("throw"); r["text"] != "The browser tool reported an error." || r["written"] != false {
		t.Fatalf("throw: %v", r)
	}
	// A tool that awaits I/O (another sample) answers when it settles.
	if r := agent("nested"); r["text"] != "The browser tool completed successfully." || r["written"] != true {
		t.Fatalf("nested: %v", r)
	}
	// A tool that awaited I/O, wrote, then threw: the turn it threw in rolled
	// back (its write is gone), the model read the error, the handler went
	// on. The write before the await had committed with its own turn.
	if r := agent("late"); r["text"] != "The browser tool reported an error." || r["written"] != true || r["after"] != false {
		t.Fatalf("late throw: %v", r)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "tools", "action": "bad"}, "invalid_argument")
	// Optional arguments left out (orderBy without a direction, files.list
	// without a prefix) once crashed the turn with a nil pointer.
	if r := h.call(admin, "actor.call", map[string]any{"store": "tools", "action": "optional"}).(map[string]any); r["first"] != "2" {
		t.Fatalf("orderBy(field): %v", r)
	}
}
