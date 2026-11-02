package server

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/llm"
)

const aiActor = `
const sample = use('sample'), db = use('db'), secrets = use('secrets'), platform = use('platform');
defineActor({
  actions: {
    async ask(ctx, { q }) {
      ctx.need('interact');
      if (!sample) ctx.fail('permission_denied', 'no sample module');
      const r = await sample(q || 'hi');
      return { text: r.text, usage: r.usage };
    },
    can(ctx) { return { allowed: sample ? sample.allowed() : false, limits: sample ? sample.limits() : null, visitor: ctx.visitor }; },
    token(ctx) { return secrets ? secrets.get('TOKEN') : 'no secrets module'; },
    make(ctx, { id }) { return platform ? platform.stores.create({ id }) : 'no platform module'; },
  },
  every: {
    digest: { every: '1h', async run(ctx) {
      const r = await sample('digest');
      db.doc('digests/last').set({ text: r.text, payer: ctx.visitor.id });
    } },
  },
});
`

// aiApp pushes an app that uses sample, secrets and platform; members may
// interact with it.
func aiApp(t *testing.T, h *harness, admin string) {
	t.Helper()
	h.a.LLM = &llm.Fake{}
	h.call(admin, "store.new", map[string]any{"id": "ai"})
	h.call(admin, "files.push", map[string]any{"store": "ai", "files": files(map[string]string{
		"app.json":   `{"title":"AI","actor":"actor.js","capabilities":{"sample":{},"db":{}},"slop":{"secrets":["TOKEN"],"platform":["stores.create"]}}`,
		"actor.js":   aiActor,
		"index.html": "<!doctype html><title>ai</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": "ai", "subject": "@member", "level": "interact"})
}

// P6 exit: a subscriber samples until the monthly budget is used up, then
// gets quota_exceeded; a member is denied; policy off denies even a person
// with access; an alarm's call is charged to the store's owner.
func TestLLMBudgets(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	aiApp(t, h, admin)
	sam := h.tokenFor("sam@example.com")
	mia := h.tokenFor("mia@example.com")
	h.call(admin, "sub.grant", map[string]any{"person": "sam@example.com", "until": "30d"})
	ask := func(tok string) (int, map[string]any) {
		return api(t, h, tok, "actor.call", map[string]any{"store": "ai", "action": "ask", "args": map[string]any{"q": "hi"}})
	}
	code := func(out map[string]any) string {
		e, _ := out["error"].(map[string]any)
		if e == nil {
			return ""
		}
		return e["code"].(string)
	}

	// Policy off (the default) denies everyone, even the admin, whose
	// @admin LLM row allows unlimited use. use('sample') is null because no
	// audience may use it.
	if st, out := ask(admin); st == 200 || !strings.Contains(out["error"].(map[string]any)["message"].(string), "no sample module") {
		t.Fatalf("admin with policy off: %d %v", st, out)
	}
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@member", "value": "on"})
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@subscriber", "value": "on"})
	// Now the module exists, and admins are members (SLOP3-007 groups):
	// the @member cell reaches the admin, whose @admin row is unlimited.
	if st, out := ask(admin); st != 200 {
		t.Fatalf("admin through the @member cell: %d %v", st, out)
	}
	// The member's audience is on, but members have no LLM access.
	if _, out := ask(mia); code(out) != "permission_denied" || !strings.Contains(out["error"].(map[string]any)["message"].(string), "no LLM access") {
		t.Fatalf("member: %v", out)
	}
	// Subscribers: 60 tokens a month. The fake model charges the input's
	// JSON length plus its answer ("slop is connected.", 18): 22 a call.
	h.call(admin, "llm.set", map[string]any{"subject": "@subscriber", "value": "on", "budget": 60})
	can := h.call(sam, "actor.call", map[string]any{"store": "ai", "action": "can"}).(map[string]any)
	if can["allowed"] != true || can["limits"].(map[string]any)["remaining"] != 60.0 || can["visitor"].(map[string]any)["llm"].(map[string]any)["remaining"] != 60.0 {
		t.Fatalf("can = %v", can)
	}
	for i, wantLeft := range []float64{38, 16, 0} {
		st, out := ask(sam)
		if st != 200 || out["result"].(map[string]any)["text"] != "slop is connected." {
			t.Fatalf("call %d: %d %v", i, st, out)
		}
		u := h.call(sam, "llm.usage", map[string]any{}).(map[string]any)["llm"].(map[string]any)
		if u["remaining"] != wantLeft {
			t.Fatalf("after call %d: %v", i, u)
		}
	}
	// The third call started with 16 left and finished over budget; the
	// fourth is refused.
	if _, out := ask(sam); code(out) != "quota_exceeded" {
		t.Fatalf("over budget: %v", out)
	}
	if got := h.call(admin, "llm.usage", map[string]any{"person": "sam@example.com"}).(map[string]any)["llm"].(map[string]any); got["used"] != 66.0 {
		t.Fatalf("sam's usage = %v", got)
	}
	// An admin resets the month.
	h.call(admin, "llm.reset", map[string]any{"person": "sam@example.com"})
	if st, _ := ask(sam); st != 200 {
		t.Fatalf("after reset: %d", st)
	}

	// An alarm's call is charged to the store's owner (the admin, whose
	// audience must have the policy on).
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@admin", "value": "on"})
	before := h.call(admin, "llm.usage", map[string]any{}).(map[string]any)["llm"].(map[string]any)["used"].(float64)
	samBefore := h.call(sam, "llm.usage", map[string]any{}).(map[string]any)["llm"].(map[string]any)["used"].(float64)
	h.call(admin, "alarm.fire", map[string]any{"store": "ai", "name": "digest"})
	waitFor(t, "the digest", func() bool { return docBody(h, admin, "ai", "digests/last") != nil })
	d := docBody(h, admin, "ai", "digests/last")
	if d["payer"] != "store:ai" || d["text"] != "slop is connected." {
		t.Fatalf("digest = %v", d)
	}
	after := h.call(admin, "llm.usage", map[string]any{}).(map[string]any)["llm"].(map[string]any)["used"].(float64)
	samAfter := h.call(sam, "llm.usage", map[string]any{}).(map[string]any)["llm"].(map[string]any)["used"].(float64)
	if after <= before || samAfter != samBefore {
		t.Fatalf("alarm charged owner %v -> %v, sam %v -> %v", before, after, samBefore, samAfter)
	}
}

// The page side: the sample capability appears only when the policy
// allows it for the viewer's audience; a call streams and is charged.
func TestPageSampleBudget(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	aiApp(t, h, admin)
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/ai", "store": "ai"})
	h.call(admin, "llm.set", map[string]any{"subject": "@member", "value": "on", "budget": 100})

	b := h.browser()
	b.signIn("ivy@example.com")
	s := h.site(live)
	signInSite(t, h, s, b, live, "/ai")
	_, v := openView(s, live, "/ai", "")
	if v["caps"].(map[string]any)["sample"] != nil {
		t.Fatalf("sample granted with the policy off: %v", v["caps"])
	}
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "sample", "audience": "@member", "value": "on"})
	_, v = openView(s, live, "/ai", "")
	if v["caps"].(map[string]any)["sample"] == nil {
		t.Fatalf("sample not granted with the policy on: %v", v["caps"])
	}
	lim := rpc(s, v, "sample.limits", map[string]any{})["result"].(map[string]any)
	if lim["allowed"] != true || lim["remaining"] != 100.0 || lim["available"] != true {
		t.Fatalf("limits = %v", lim)
	}
	// One streamed call.
	u := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	resp, _ := s.do("POST", u, "/_rt/sample", map[string]any{"input": "hello", "modelTier": "default"},
		map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	if resp.StatusCode != 200 {
		t.Fatalf("sample: %d", resp.StatusCode)
	}
	evs := events(t, resp, 4, 3*time.Second)
	var result map[string]any
	for _, e := range evs {
		if e["_type"] == "result" {
			result = e
		}
	}
	if result == nil || result["text"] != "slop is connected." {
		t.Fatalf("events = %v", evs)
	}
	// Charged: "hello" as JSON is 7, plus 18.
	lim = rpc(s, v, "sample.limits", map[string]any{})["result"].(map[string]any)
	if lim["remaining"] != 75.0 {
		t.Fatalf("after one call: %v", lim)
	}
	// Used up: the next call is refused before it starts.
	h.call(admin, "llm.set", map[string]any{"subject": "@member", "value": "on", "budget": 25})
	resp, out := s.do("POST", u, "/_rt/sample", map[string]any{"input": "again"}, map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	if resp.StatusCode != 429 || out["error"].(map[string]any)["code"] != "quota_exceeded" {
		t.Fatalf("over budget: %d %v", resp.StatusCode, out)
	}
	// user.me() shows what is left (§9.5): the hello event carries it.
	hello := openStream(t, s, v).next(t, "hello", 2*time.Second)
	me := hello["me"].(map[string]any)
	if l := me["llm"].(map[string]any); l["allowed"] != true || l["remaining"] != 0.0 {
		t.Fatalf("me.llm = %v", me["llm"])
	}
}

// Secrets and platform follow the policy per audience; use() is null when
// no audience may use them; secret values are never listed.
func TestSecretsAndPlatformPolicy(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	aiApp(t, h, admin)
	mia := h.tokenFor("mia@example.com")
	h.call(admin, "secret.set", map[string]any{"app": "ai", "name": "TOKEN", "value": "s3cret"})
	names := h.call(admin, "secret.ls", map[string]any{"app": "ai"}).([]any)
	if len(names) != 1 || names[0].(map[string]any)["name"] != "TOKEN" || strings.Contains(fmtAny(names), "s3cret") {
		t.Fatalf("secret.ls = %v", names)
	}
	// Nobody may: the module is null.
	if got := h.call(admin, "actor.call", map[string]any{"store": "ai", "action": "token"}); got != "no secrets module" {
		t.Fatalf("token, policy off = %v", got)
	}
	// Admins may; members may not.
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "secrets", "audience": "@admin", "value": "on"})
	if got := h.call(admin, "actor.call", map[string]any{"store": "ai", "action": "token"}); got != "s3cret" {
		t.Fatalf("token as admin = %v", got)
	}
	h.fail(mia, "actor.call", map[string]any{"store": "ai", "action": "token"}, "permission_denied")
	// The stored value is encrypted.
	var raw []byte
	if err := h.sys.QueryRowContext(context.Background(), `SELECT value_enc FROM secrets WHERE app = 'ai' AND name = 'TOKEN'`).Scan(&raw); err != nil || strings.Contains(string(raw), "s3cret") {
		t.Fatalf("secret at rest = %q %v", raw, err)
	}
	// A policy cell for a capability the app does not declare is refused.
	h.fail(admin, "policy.set", map[string]any{"app": "ai", "capability": "fetch", "audience": "@member", "value": "on"}, "invalid_argument")
	m := h.call(admin, "policy.ls", map[string]any{"app": "ai"}).(map[string]any)
	if len(m["declared"].([]any)) != 3 { // sample, secrets, platform
		t.Fatalf("policy.ls = %v", m)
	}

	// Platform: members may create stores through the app, as themselves.
	h.call(admin, "policy.set", map[string]any{"app": "ai", "capability": "platform", "audience": "@member", "value": "on"})
	got := h.call(mia, "actor.call", map[string]any{"store": "ai", "action": "make", "args": map[string]any{"id": "mias-notes"}}).(map[string]any)
	if got["id"] != "mias-notes" {
		t.Fatalf("platform.stores.create = %v", got)
	}
	row, err := h.sys.StoreByID(context.Background(), "mias-notes")
	mp, _ := h.sys.PersonByEmail(context.Background(), "mia@example.com")
	if err != nil || row.Owner != mp.ID {
		t.Fatalf("created store = %+v %v (want owner %s)", row, err, mp.ID)
	}
}
