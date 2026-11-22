// Package agent serves the agent capability: server-held agent sessions for
// pages (SLOP3-025). A page opens a session, registers the tools it runs,
// sends one message at a time and reads events; the conversation and the
// tool loop stay on the server. It is pinocchio's chat HTTP API
// (pkg/chatapp/httpapi) with slop's parts: the principal and app of the
// view, the person's own sessions in the app, the runtime of each message
// from slop's model backend and the page's settings, and a hold on the LLM
// ledger before every model round, as sample's rounds have (SLOP3-007).
// It lives in the pages door, which alone serves it (on the sandbox origin):
// it is HTTP through and through, which capabilities (pkg/caps) may not be.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-go-golems/geppetto/pkg/inference/engine"
	"github.com/go-go-golems/geppetto/pkg/inference/middleware"
	"github.com/go-go-golems/geppetto/pkg/inference/toolloop"
	geptools "github.com/go-go-golems/geppetto/pkg/inference/tools"
	"github.com/go-go-golems/geppetto/pkg/turns"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/agentserver"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/frontendtools"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/httpapi"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/plugins"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/serverkit"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/sessions"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/toolkit/scripted"
	"github.com/go-go-golems/pinocchio/pkg/chatapp/toolkit/toolexec"
	infruntime "github.com/go-go-golems/pinocchio/pkg/inference/runtime"
	chatstore "github.com/go-go-golems/pinocchio/pkg/persistence/chatstore"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/pkg/errors"
)

// Prefix is where the pages door serves the capability on a sandbox origin.
const Prefix = "/_rt/agent"

// Limits of a session's settings: the page may lower them, not raise them.
const (
	MaxSystemBytes     = 256 << 10
	MaxContextBytes    = 64 << 10
	DefaultMaxRounds   = 30
	MaxRounds          = 60
	DefaultToolTimeout = 10 * time.Minute
	MaxToolTimeout     = 30 * time.Minute
	DefaultMaxTokens   = 16384
	MaxTokens          = 65536
	ResultCut          = 16000
	framingTokens      = 256
)

// View is who a request comes from, as the pages door resolved it.
type View struct {
	User     string // the person, who pays; never empty here
	App      string // the view's target: sessions belong to one app
	Audience string // the person's audience in the app (LLM policy)
}

type viewKey struct{}

// WithView returns ctx carrying v; the door sets it before calling Handler.
func WithView(ctx context.Context, v View) context.Context {
	return context.WithValue(ctx, viewKey{}, v)
}

// ViewFrom returns the view a request carries.
func ViewFrom(ctx context.Context) (View, bool) {
	v, ok := ctx.Value(viewKey{}).(View)
	return v, ok && v.User != "" && v.App != ""
}

// Data is the part of a session's data this package reads: the page's
// settings, fixed at creation so the prompt prefix stays the same.
type Data struct {
	System      string `json:"system,omitempty"`
	MaxRounds   int    `json:"maxRounds,omitempty"`
	ToolTimeout int64  `json:"toolTimeout,omitempty"` // milliseconds
	MaxTokens   int    `json:"maxTokens,omitempty"`   // output tokens per model round
}

// Engines is a backend that gives Geppetto engines (gepp.Backend).
type Engines interface {
	Engine(ctx context.Context, o llm.Options) (engine.Engine, llm.EngineInfo, error)
}

// Config configures New.
type Config struct {
	// Dir holds sessions.db, turns.db and timeline.db; "" keeps them in
	// memory (tests).
	Dir string
	// Ledger meters every model round.
	Ledger *llm.Ledger
	// Backend is the server's model backend, read per message (it is set
	// after the server is built); nil: none.
	Backend func() llm.Backend
	// ScriptDelay is the scripted engine's delay between words (llm.Fake).
	ScriptDelay time.Duration
}

// Service is the capability's HTTP API.
type Service struct {
	cfg     Config
	api     *httpapi.Server
	handler http.Handler
	texts   agentserver.Texts
	closers []func() error
}

// New builds the service.
func New(cfg Config) (*Service, error) {
	if cfg.Ledger == nil {
		return nil, errors.New("agent: a ledger is required")
	}
	if cfg.Backend == nil {
		cfg.Backend = func() llm.Backend { return nil }
	}
	s := &Service{cfg: cfg, texts: agentserver.DefaultTexts()}
	opts := []httpapi.Option{
		httpapi.WithPrefix(Prefix),
		httpapi.WithRuntimeResolver(httpapi.RuntimeResolverFunc(s.resolve)),
		httpapi.WithAuthenticator(authenticate),
		httpapi.WithAuthorizer(authorize),
		httpapi.WithCreateHook(s.complete),
		httpapi.WithBlocks(contextBlocks),
		httpapi.WithFrontendTools(frontendtools.NewManager()),
		httpapi.WithChatPlugins(frontendtools.NewPlugin(), plugins.NewReasoningPlugin(), plugins.NewToolCallPlugin()),
		httpapi.WithMaxBodyBytes(MaxSystemBytes + 64<<10),
	}
	if cfg.Dir != "" {
		stores, err := s.openStores()
		if err != nil {
			_ = s.Close()
			return nil, err
		}
		opts = append(opts, stores...)
	}
	api, err := httpapi.New(opts...)
	if err != nil {
		_ = s.Close()
		return nil, err
	}
	s.api = api
	mux := http.NewServeMux()
	api.Register(mux)
	s.handler = mux
	return s, nil
}

func (s *Service) openStores() ([]httpapi.Option, error) {
	if err := os.MkdirAll(s.cfg.Dir, 0o700); err != nil {
		return nil, errors.Wrap(err, "agent state directory")
	}
	store, err := sessions.NewSQLiteStore("file:" + filepath.Join(s.cfg.Dir, "sessions.db") + "?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return nil, errors.Wrap(err, "open agent session store")
	}
	s.closers = append(s.closers, store.Close)
	turnsDB := filepath.Join(s.cfg.Dir, "turns.db")
	turnStore, err := chatstore.NewSQLiteTurnStore(turnsDB)
	if err != nil {
		return nil, errors.Wrap(err, "open agent turn store")
	}
	s.closers = append(s.closers, turnStore.Close)
	return []httpapi.Option{
		httpapi.WithSessionStore(store),
		httpapi.WithTurnStore(turnStore),
		httpapi.WithTurnsDBPath(turnsDB),
		httpapi.WithHydrationStoreSpec(serverkit.StoreSpec{Backend: serverkit.StoreBackendSQLite, Path: filepath.Join(s.cfg.Dir, "timeline.db")}),
	}, nil
}

// Close stops runs and closes the stores.
func (s *Service) Close() error {
	var first error
	if s.api != nil {
		first = s.api.Close()
	}
	for i := len(s.closers) - 1; i >= 0; i-- {
		if err := s.closers[i](); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// ServeHTTP serves the API. The request must carry a View (WithView); a
// session listing is limited to the view's app.
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if v, ok := ViewFrom(r.Context()); ok && r.Method == http.MethodGet && strings.TrimSuffix(r.URL.Path, "/") == Prefix+"/sessions" {
		q := r.URL.Query()
		labels := q["label"][:0:0]
		for _, l := range q["label"] {
			if k, _, _ := strings.Cut(l, ":"); strings.TrimSpace(k) != "app" {
				labels = append(labels, l)
			}
		}
		q["label"] = append(labels, "app:"+v.App)
		r = r.Clone(r.Context())
		r.URL.RawQuery = q.Encode()
	}
	s.handler.ServeHTTP(w, r)
}

// API is the underlying httpapi server.
func (s *Service) API() *httpapi.Server { return s.api }

func authenticate(r *http.Request) (httpapi.Principal, error) {
	v, ok := ViewFrom(r.Context())
	if !ok {
		return httpapi.Principal{}, errors.New("no view")
	}
	return httpapi.Principal{ID: v.User, Attrs: map[string]string{"app": v.App, "audience": v.Audience}}, nil
}

// authorize allows a person their own sessions in the view's app.
func authorize(_ context.Context, p httpapi.Principal, _ httpapi.Action, info *sessions.Info) error {
	if info == nil {
		return nil
	}
	if info.Owner != p.ID || info.Labels["app"] != p.Attrs["app"] {
		return httpapi.ErrForbidden
	}
	return nil
}

type codedError struct{ code, msg string }

func (e codedError) Error() string { return e.msg }
func (e codedError) Code() string  { return e.code }

// complete is the create hook: the app label, the page's key once per
// person and app, and the settings within slop's limits.
func (s *Service) complete(ctx context.Context, p httpapi.Principal, info *sessions.Info) error {
	if info.Labels == nil {
		info.Labels = map[string]string{}
	}
	info.Labels["app"] = p.Attrs["app"]
	for k, v := range info.Labels {
		if len(k) > 64 || len(v) > 256 {
			return codedError{httpapi.CodeInvalidRequest, "a label is at most 64 bytes of key and 256 of value"}
		}
	}
	if key := info.Labels["key"]; key != "" {
		same, err := s.api.Sessions().List(ctx, sessions.Filter{Owner: p.ID, Labels: map[string]string{"app": info.Labels["app"], "key": key}, Limit: 1})
		if err != nil {
			return err
		}
		if len(same) > 0 {
			return codedError{httpapi.CodeSessionExists, fmt.Sprintf("a session with key %q exists: %s", key, same[0].ID)}
		}
	}
	d, err := dataOf(*info)
	if err != nil {
		return codedError{httpapi.CodeInvalidRequest, err.Error()}
	}
	if len(d.System) > MaxSystemBytes {
		return codedError{"prompt_too_large", fmt.Sprintf("a system prompt is at most %d bytes", MaxSystemBytes)}
	}
	d.MaxRounds = clamp(d.MaxRounds, DefaultMaxRounds, MaxRounds)
	d.ToolTimeout = int64(clamp(int(d.ToolTimeout), int(DefaultToolTimeout/time.Millisecond), int(MaxToolTimeout/time.Millisecond)))
	d.MaxTokens = clamp(d.MaxTokens, DefaultMaxTokens, MaxTokens)
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	info.Data = raw
	return nil
}

func clamp(v, def, limit int) int {
	switch {
	case v <= 0:
		return def
	case v > limit:
		return limit
	}
	return v
}

func dataOf(info sessions.Info) (Data, error) {
	var d Data
	if len(info.Data) == 0 || string(info.Data) == "null" {
		return d, nil
	}
	if err := json.Unmarshal(info.Data, &d); err != nil {
		return d, errors.Wrap(err, "session data")
	}
	return d, nil
}

// contextBlocks appends a message's "context" after the person's message.
func contextBlocks(_ context.Context, _ sessions.Info, msg httpapi.MessageRequest) ([]turns.Block, error) {
	if len(msg.Raw) == 0 {
		return nil, nil
	}
	var extra struct {
		Context string `json:"context"`
	}
	if err := json.Unmarshal(msg.Raw, &extra); err != nil {
		return nil, err
	}
	if strings.TrimSpace(extra.Context) == "" {
		return nil, nil
	}
	if len(extra.Context) > MaxContextBytes {
		return nil, codedError{"prompt_too_large", fmt.Sprintf("a message's context is at most %d bytes", MaxContextBytes)}
	}
	return []turns.Block{turns.NewUserTextBlock(extra.Context)}, nil
}

// resolve builds one message's runtime: the engine for the session's tier,
// metered for the person; the page's system prompt; the loop and tool limits.
func (s *Service) resolve(ctx context.Context, r *http.Request, info sessions.Info, _ httpapi.MessageRequest) (*infruntime.ComposedRuntime, error) {
	v, ok := ViewFrom(r.Context())
	if !ok {
		return nil, codedError{httpapi.CodeUnauthenticated, "no view"}
	}
	d, err := dataOf(info)
	if err != nil {
		return nil, err
	}
	opts := llm.Options{ModelTier: info.Labels["tier"], Model: info.Labels["model"], Effort: info.Labels["effort"]}
	base, model, err := s.engine(ctx, opts)
	if err != nil {
		return nil, err
	}
	maxOut := clamp(d.MaxTokens, DefaultMaxTokens, MaxTokens)
	if model.MaxTokens > 0 && model.MaxTokens < maxOut {
		maxOut = model.MaxTokens
	}
	metered := &meteredEngine{
		inner: base, ledger: s.cfg.Ledger, payer: v.User, audience: v.Audience,
		call: "agent:" + info.ID, maxOut: maxOut,
	}
	mws := []middleware.Middleware{middleware.NewToolResultReorderMiddleware()}
	if strings.TrimSpace(d.System) != "" {
		mws = append(mws, middleware.NewSystemPromptMiddleware(d.System))
	}
	rounds := clamp(d.MaxRounds, DefaultMaxRounds, MaxRounds)
	loop := toolloop.DefaultLoopConfig().WithMaxIterations(rounds).WithFinalAnswer(toolloop.FinalAnswer{
		Prompt:            func(n int) turns.Block { return turns.NewUserTextBlock(fmt.Sprintf(s.texts.FinalRound, n)) },
		RefusedToolResult: s.texts.RefusedTool,
	})
	timeout := time.Duration(clamp(int(d.ToolTimeout), int(DefaultToolTimeout/time.Millisecond), int(MaxToolTimeout/time.Millisecond))) * time.Millisecond
	toolCfg := geptools.DefaultToolConfig()
	toolCfg.ExecutionTimeout = timeout + 5*time.Second // the deadline below acts first
	toolCfg.MaxParallelTools = 1
	toolCfg.RetryConfig.MaxRetries = 0 // a retried page tool would run page code twice
	return &infruntime.ComposedRuntime{
		Engine:     handlerEngine{handler: middleware.Chain(metered.RunInference, mws...)},
		Loop:       &loop,
		ToolConfig: &toolCfg,
		WrapToolExecutor: toolexec.Compose(
			toolexec.Deadline(timeout, s.texts.ToolTimeout),
			toolexec.CutResults(ResultCut, s.texts.ResultCut),
		),
		RuntimeKey:         "agent",
		RuntimeFingerprint: "agent:" + model.Model,
	}, nil
}

// engine is the backend's engine for opts; the fake backend gets the
// scripted engine (/tool name {json}, else an echo).
func (s *Service) engine(ctx context.Context, opts llm.Options) (engine.Engine, llm.EngineInfo, error) {
	b := s.cfg.Backend()
	switch b := b.(type) {
	case nil:
		return nil, llm.EngineInfo{}, codedError{"unavailable", "this server has no model backend"}
	case *llm.Fake:
		return &scripted.Engine{Delay: s.cfg.ScriptDelay}, llm.EngineInfo{Model: scripted.Model.Ref}, nil
	case Engines:
		eng, info, err := b.Engine(ctx, opts)
		if err != nil {
			return nil, info, errors.Wrap(err, "model")
		}
		return eng, info, nil
	}
	return nil, llm.EngineInfo{}, codedError{"unavailable", "this server's model backend cannot run agents"}
}

type handlerEngine struct{ handler middleware.HandlerFunc }

func (e handlerEngine) RunInference(ctx context.Context, t *turns.Turn) (*turns.Turn, error) {
	return e.handler(ctx, t)
}
