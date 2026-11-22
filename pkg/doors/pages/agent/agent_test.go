package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/stretchr/testify/require"
)

type fixture struct {
	t      *testing.T
	url    string
	ledger *llm.Ledger
}

// start serves the capability with the fake backend; the test's requests
// name their view in headers (the pages door resolves it from the secret).
func start(t *testing.T) *fixture {
	t.Helper()
	db, err := sysdb.Open(context.Background(), filepath.Join(t.TempDir(), "system.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	ledger := llm.NewLedger(db)
	svc, err := New(Config{Dir: t.TempDir(), Ledger: ledger, Backend: func() llm.Backend { return &llm.Fake{} }})
	require.NoError(t, err)
	t.Cleanup(func() { _ = svc.Close() })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v := View{User: r.Header.Get("X-User"), App: r.Header.Get("X-App"), Audience: "member"}
		svc.ServeHTTP(w, r.WithContext(WithView(r.Context(), v)))
	}))
	t.Cleanup(srv.Close)
	return &fixture{t: t, url: srv.URL + Prefix, ledger: ledger}
}

func (f *fixture) allow(user string, budget *int64) {
	f.t.Helper()
	require.NoError(f.t, f.ledger.SetLLM(context.Background(), "usr_admin", "test", user, true, budget))
}

func (f *fixture) do(user, app, method, path, body string) (int, []byte) {
	f.t.Helper()
	req, err := http.NewRequest(method, f.url+path, strings.NewReader(body))
	require.NoError(f.t, err)
	req.Header.Set("X-User", user)
	req.Header.Set("X-App", app)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	require.NoError(f.t, err)
	defer func() { _ = res.Body.Close() }()
	out, err := io.ReadAll(res.Body)
	require.NoError(f.t, err)
	return res.StatusCode, out
}

type uiEvent struct {
	Name    string          `json:"name"`
	Payload json.RawMessage `json:"payload"`
}

// events reads the session's SSE stream into a channel of UI events.
func (f *fixture) events(user, app, id string) <-chan uiEvent {
	f.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	f.t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.url+"/sessions/"+id+"/events", nil)
	require.NoError(f.t, err)
	req.Header.Set("X-User", user)
	req.Header.Set("X-App", app)
	res, err := http.DefaultClient.Do(req)
	require.NoError(f.t, err)
	require.Equal(f.t, http.StatusOK, res.StatusCode)
	ch := make(chan uiEvent, 256)
	go func() {
		defer func() { _ = res.Body.Close() }()
		defer close(ch)
		sc := bufio.NewScanner(res.Body)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		kind := ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				kind = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: ") && kind == "ui":
				var e uiEvent
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &e) == nil {
					ch <- e
				}
			}
		}
	}()
	return ch
}

func next(t *testing.T, ch <-chan uiEvent, names ...string) uiEvent {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case e, ok := <-ch:
			require.True(t, ok, "stream closed before %v", names)
			for _, n := range names {
				if e.Name == n {
					return e
				}
			}
		case <-deadline:
			t.Fatalf("no %v within 10s", names)
		}
	}
}

func (f *fixture) create(user, app, body string) string {
	f.t.Helper()
	status, out := f.do(user, app, http.MethodPost, "/sessions", body)
	require.Equal(f.t, http.StatusCreated, status, string(out))
	var created struct {
		SessionID string `json:"sessionId"`
	}
	require.NoError(f.t, json.Unmarshal(out, &created))
	return created.SessionID
}

const evalManifest = `{"clientInstanceId":"tab","connectionId":"c1","revision":1,"tools":[
	{"name":"eval","description":"run code in the page","mode":"frontend","inputSchema":{"type":"object","properties":{"code":{"type":"string"}}},"available":true}]}`

func TestAPageToolRoundTripIsMeteredOnTheLedger(t *testing.T) {
	f := start(t)
	f.allow("usr_a", nil)
	id := f.create("usr_a", "bench", `{"labels":{"key":"t1","tier":"default"},"data":{"system":"You are a test.","maxRounds":500}}`)

	status, out := f.do("usr_a", "bench", http.MethodGet, "/sessions/"+id, "")
	require.Equal(t, http.StatusOK, status, string(out))
	var got struct {
		Session struct {
			Owner  string            `json:"owner"`
			Labels map[string]string `json:"labels"`
			Data   Data              `json:"data"`
		} `json:"session"`
	}
	require.NoError(t, json.Unmarshal(out, &got))
	require.Equal(t, "usr_a", got.Session.Owner)
	require.Equal(t, "bench", got.Session.Labels["app"], "the server sets the app")
	require.Equal(t, MaxRounds, got.Session.Data.MaxRounds, "a page may not raise a limit")
	require.Equal(t, int64(DefaultToolTimeout/time.Millisecond), got.Session.Data.ToolTimeout)

	ev := f.events("usr_a", "bench", id)
	status, out = f.do("usr_a", "bench", http.MethodPost, "/sessions/"+id+"/tools/manifest", evalManifest)
	require.Equal(t, http.StatusOK, status, string(out))
	var ack struct {
		Executor json.RawMessage `json:"executor"`
	}
	require.NoError(t, json.Unmarshal(out, &ack))

	status, out = f.do("usr_a", "bench", http.MethodPost, "/sessions/"+id+"/messages", `{"prompt":"/tool eval {\"code\":\"6*7\"}","context":"Files: index.html"}`)
	require.Equal(t, http.StatusAccepted, status, string(out))

	call := next(t, ev, "ChatFrontendToolCallRequested")
	var req struct {
		ToolCallID string `json:"toolCallId"`
	}
	require.NoError(t, json.Unmarshal(call.Payload, &req))
	status, out = f.do("usr_a", "bench", http.MethodPost, "/sessions/"+id+"/tools/results",
		`{"toolCallId":"`+req.ToolCallID+`","toolName":"eval","status":"success","result":42,"executor":`+string(ack.Executor)+`}`)
	require.Equal(t, http.StatusOK, status, string(out))
	next(t, ev, "ChatRunFinished")

	status, out = f.do("usr_a", "bench", http.MethodGet, "/sessions/"+id+"/turns?format=yaml", "")
	require.Equal(t, http.StatusOK, status)
	require.Contains(t, string(out), "You are a test.", "the page's system prompt")
	require.Contains(t, string(out), "Files: index.html", "the message's context")
	require.Contains(t, string(out), "eval returned: 42")

	used := f.ledger.LLMUsed(context.Background(), "usr_a", llm.Period(time.Now()))
	require.Positive(t, used, "both model rounds are charged to the person")
	require.Zero(t, f.ledger.LLMReserved(context.Background(), "usr_a", llm.Period(time.Now())), "no hold stays open")

	// The next message's rounds are charged too: its holds are its own.
	status, out = f.do("usr_a", "bench", http.MethodPost, "/sessions/"+id+"/messages", `{"prompt":"thanks"}`)
	require.Equal(t, http.StatusAccepted, status, string(out))
	next(t, ev, "ChatRunFinished")
	require.Greater(t, f.ledger.LLMUsed(context.Background(), "usr_a", llm.Period(time.Now())), used, "a second message's round reuses no hold of the first")
}

func TestSessionsBelongToOnePersonInOneApp(t *testing.T) {
	f := start(t)
	f.allow("usr_a", nil)
	id := f.create("usr_a", "bench", `{"labels":{"key":"t1"}}`)

	status, _ := f.do("usr_b", "bench", http.MethodGet, "/sessions/"+id, "")
	require.Equal(t, http.StatusForbidden, status, "another person")
	status, _ = f.do("usr_a", "notes", http.MethodGet, "/sessions/"+id, "")
	require.Equal(t, http.StatusForbidden, status, "the same person in another app")
	status, _ = f.do("usr_a", "notes", http.MethodPost, "/sessions/"+id+"/messages", `{"prompt":"hi"}`)
	require.Equal(t, http.StatusForbidden, status)

	status, out := f.do("usr_a", "notes", http.MethodGet, "/sessions?label=app:bench", "")
	require.Equal(t, http.StatusOK, status)
	require.JSONEq(t, `{"sessions":[]}`, string(out), "a listing is limited to the view's app, whatever the query says")
	status, out = f.do("usr_a", "bench", http.MethodGet, "/sessions?label=key:t1", "")
	require.Equal(t, http.StatusOK, status)
	require.Contains(t, string(out), id)

	status, out = f.do("usr_a", "bench", http.MethodPost, "/sessions", `{"labels":{"key":"t1"}}`)
	require.Equal(t, http.StatusConflict, status, string(out))
	require.Contains(t, string(out), "session_exists")
	f.create("usr_a", "notes", `{"labels":{"key":"t1"}}`) // a key is per app
}

func TestARunStopsWithoutLLMAccessOrBudget(t *testing.T) {
	f := start(t)
	id := f.create("usr_c", "bench", `{}`)
	ev := f.events("usr_c", "bench", id)
	status, out := f.do("usr_c", "bench", http.MethodPost, "/sessions/"+id+"/messages", `{"prompt":"hi"}`)
	require.Equal(t, http.StatusAccepted, status, string(out))
	failed := next(t, ev, "ChatRunFailed", "ChatRunFinished")
	require.Equal(t, "ChatRunFailed", failed.Name)
	require.Contains(t, string(failed.Payload), "permission_denied")

	one := int64(1)
	f.allow("usr_c", &one)
	status, out = f.do("usr_c", "bench", http.MethodPost, "/sessions/"+id+"/messages", `{"prompt":"hi again"}`)
	require.Equal(t, http.StatusAccepted, status, string(out))
	failed = next(t, ev, "ChatRunFailed", "ChatRunFinished")
	require.Equal(t, "ChatRunFailed", failed.Name)
	require.Contains(t, string(failed.Payload), "quota_exceeded", "the hold is refused before the provider is contacted")
	require.Zero(t, f.ledger.LLMUsed(context.Background(), "usr_c", llm.Period(time.Now())))
}
