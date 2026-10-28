package client

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Types mirror the server's JSON (pkg/store); they are separate so the CLI
// never imports the store.

type Project struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Brief string `json:"brief"`
}

type Artifact struct {
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Kind    string  `json:"kind"`
	Type    string  `json:"type,omitempty"`
	Viewer  string  `json:"viewer,omitempty"`
	Project *string `json:"project"`
	Main    int     `json:"main"`
	Latest  int     `json:"latest"`
}

type FileEntry struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Type   string `json:"type"`
}

type Version struct {
	Artifact string               `json:"artifact"`
	N        int                  `json:"n"`
	Parent   *int                 `json:"parent"`
	Manifest json.RawMessage      `json:"manifest"`
	Message  string               `json:"message"`
	By       string               `json:"by"`
	Via      string               `json:"via"`
	Session  string               `json:"session,omitempty"`
	At       time.Time            `json:"at"`
	Files    map[string]FileEntry `json:"files"`
}

type Binding struct {
	Artifact string `json:"artifact"`
	Version  *int   `json:"version"`
}

type Route struct {
	Host      string             `json:"host"`
	Path      string             `json:"path"`
	Page      string             `json:"page"`
	Version   *int               `json:"version"`
	Bindings  map[string]Binding `json:"bindings,omitempty"`
	Record    string             `json:"record,omitempty"`
	Access    string             `json:"access,omitempty"`
	ChangedAt time.Time          `json:"changedAt,omitempty"`
	Note      string             `json:"note,omitempty"`
}

type Comment struct {
	ID      int64     `json:"id"`
	By      string    `json:"by"`
	Agent   bool      `json:"agent"`
	Version *int      `json:"version,omitempty"`
	Text    string    `json:"text"`
	At      time.Time `json:"at"`
}

type Thread struct {
	ID       string          `json:"id"`
	Artifact string          `json:"artifact"`
	Version  int             `json:"version"`
	Anchor   json.RawMessage `json:"anchor"`
	By       string          `json:"by"`
	Resolved bool            `json:"resolved"`
	Comments []Comment       `json:"comments"`
}

// CreateArtifact describes an artifact a push creates.
type CreateArtifact struct {
	Title   string  `json:"title"`
	Kind    string  `json:"kind"`
	Type    string  `json:"type,omitempty"`
	Project *string `json:"project,omitempty"`
}

type Reply struct {
	Thread string `json:"thread"`
	Text   string `json:"text"`
}

type PushRequest struct {
	Base     *int              `json:"base,omitempty"`
	Tree     map[string]string `json:"tree"`
	Manifest json.RawMessage   `json:"manifest,omitempty"`
	Message  string            `json:"message,omitempty"`
	Via      string            `json:"via,omitempty"`
	Session  string            `json:"session,omitempty"`
	Reply    *Reply            `json:"reply,omitempty"`
	Create   *CreateArtifact   `json:"create,omitempty"`
	MoveMain *bool             `json:"moveMain,omitempty"`
	Force    bool              `json:"force,omitempty"`
	// Author pushes on behalf of another user; needs the admin scope.
	Author string `json:"author,omitempty"`
}

type PushResult struct {
	Artifact  Artifact `json:"artifact"`
	Version   Version  `json:"version"`
	Created   bool     `json:"created"`
	Unchanged bool     `json:"unchanged"`
	Warnings  []string `json:"warnings"`
}

// WaitResult is a comment that woke `comments wait`.
type WaitResult struct {
	Seq      int64  `json:"seq"`
	Type     string `json:"type"`
	Thread   Thread `json:"thread"`
	Artifact string `json:"artifact"`
	Project  string `json:"project"`
}

func (c *Client) Projects(ctx context.Context) ([]Project, error) {
	var out []Project
	return out, c.get(ctx, "/api/projects", nil, &out)
}

func (c *Client) PutProject(ctx context.Context, p Project) (Project, error) {
	var out Project
	return out, c.send2(ctx, http.MethodPut, "/api/projects/"+esc(p.ID), p, &out)
}

func (c *Client) Artifacts(ctx context.Context, project string) ([]Artifact, error) {
	var out []Artifact
	q := url.Values{}
	if project != "" {
		q.Set("project", project)
	}
	return out, c.get(ctx, "/api/artifacts", q, &out)
}

func (c *Client) Artifact(ctx context.Context, id string) (Artifact, error) {
	var out Artifact
	return out, c.get(ctx, "/api/artifacts/"+esc(id), nil, &out)
}

func (c *Client) Versions(ctx context.Context, id string) ([]Version, error) {
	var out []Version
	return out, c.get(ctx, "/api/artifacts/"+esc(id)+"/versions", nil, &out)
}

// Version returns one version; n 0 is main.
func (c *Client) Version(ctx context.Context, id string, n int) (Version, error) {
	var out Version
	return out, c.get(ctx, "/api/artifacts/"+esc(id)+"/versions/"+versionRef(n), nil, &out)
}

func versionRef(n int) string {
	if n <= 0 {
		return "main"
	}
	return itoa(n)
}

// File streams one file of a version to w.
func (c *Client) File(ctx context.Context, id string, n int, path string, w io.Writer) (int64, error) {
	return c.download(ctx, "/api/artifacts/"+esc(id)+"/versions/"+versionRef(n)+"/files/"+escPath(path), w)
}

func escPath(p string) string {
	u := url.URL{Path: p}
	return u.EscapedPath()
}

func (c *Client) MissingBlobs(ctx context.Context, sums []string) ([]string, error) {
	var out struct {
		Missing []string `json:"missing"`
	}
	return out.Missing, c.send2(ctx, http.MethodPost, "/api/blobs/missing", map[string]any{"sha256": sums}, &out)
}

func (c *Client) PutBlob(ctx context.Context, sum string, data []byte) error {
	return c.do(ctx, request{method: http.MethodPut, path: "/api/blobs/" + sum, bodyReader: bytes.NewReader(data), contentType: "application/octet-stream"}, nil)
}

// User is an account as GET /api/users lists it.
type User struct {
	ID      string `json:"id"`
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

func (c *Client) Users(ctx context.Context) ([]User, error) {
	var out []User
	return out, c.get(ctx, "/api/users", nil, &out)
}

func (c *Client) Push(ctx context.Context, id string, in PushRequest) (PushResult, error) {
	var out PushResult
	return out, c.send2(ctx, http.MethodPost, "/api/artifacts/"+esc(id)+"/versions", in, &out)
}

func (c *Client) Routes(ctx context.Context, host string) ([]Route, error) {
	var out []Route
	q := url.Values{}
	if host != "" {
		q.Set("host", host)
	}
	return out, c.get(ctx, "/api/routes", q, &out)
}

func (c *Client) SetRoute(ctx context.Context, r Route) (Route, error) {
	var out Route
	return out, c.send2(ctx, http.MethodPut, "/api/routes", r, &out)
}

func (c *Client) RemoveRoute(ctx context.Context, host, path string) error {
	q := url.Values{"host": {host}, "path": {path}}
	return c.do(ctx, request{method: http.MethodDelete, path: "/api/routes", query: q}, nil)
}

func (c *Client) UndoRoute(ctx context.Context, host, path string) (*Route, error) {
	var out struct {
		Route *Route `json:"route"`
	}
	return out.Route, c.send2(ctx, http.MethodPost, "/api/routes/undo", map[string]string{"host": host, "path": path}, &out)
}

func (c *Client) Threads(ctx context.Context, artifact, project string, open bool) ([]Thread, error) {
	var out []Thread
	q := url.Values{}
	if artifact != "" {
		q.Set("artifact", artifact)
	}
	if project != "" {
		q.Set("project", project)
	}
	if open {
		q.Set("open", "1")
	}
	return out, c.get(ctx, "/api/threads", q, &out)
}

func (c *Client) ReplyThread(ctx context.Context, thread, text string, version *int) (Thread, error) {
	var out Thread
	return out, c.send2(ctx, http.MethodPost, "/api/threads/"+esc(thread)+"/replies", map[string]any{"text": text, "version": version}, &out)
}

func (c *Client) ResolveThread(ctx context.Context, thread string, resolved bool) (Thread, error) {
	var out Thread
	return out, c.send2(ctx, http.MethodPost, "/api/threads/"+esc(thread)+"/resolve", map[string]bool{"resolved": resolved}, &out)
}

// WaitComments long-polls once; ok is false when the server timed out.
func (c *Client) WaitComments(ctx context.Context, project, artifact string, after int64, timeout int) (WaitResult, bool, error) {
	q := url.Values{"timeout": {strconv.Itoa(timeout)}}
	if project != "" {
		q.Set("project", project)
	}
	if artifact != "" {
		q.Set("artifact", artifact)
	}
	if after > 0 {
		q.Set("after", strconv.FormatInt(after, 10))
	}
	resp, err := c.send(ctx, request{method: http.MethodGet, path: "/api/comments/wait", query: q})
	if err != nil {
		return WaitResult{}, false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNoContent {
		return WaitResult{}, false, nil
	}
	var out WaitResult
	return out, true, json.NewDecoder(io.LimitReader(resp.Body, maxJSONResponse)).Decode(&out)
}

// SandboxURL is the preview URL of a version, optionally in a route context.
func (c *Client) SandboxURL(ctx context.Context, artifact string, n int, host, path string) (string, error) {
	q := url.Values{"artifact": {artifact}, "n": {itoa(n)}}
	if host != "" {
		q.Set("host", host)
		q.Set("path", path)
	}
	var out struct {
		URL string `json:"url"`
	}
	return out.URL, c.get(ctx, "/api/sandbox-url", q, &out)
}

func (c *Client) CreateThread(ctx context.Context, artifact string, version int, anchor json.RawMessage, text string) (Thread, error) {
	var out Thread
	return out, c.send2(ctx, http.MethodPost, "/api/artifacts/"+esc(artifact)+"/threads", map[string]any{"version": version, "anchor": anchor, "text": text}, &out)
}

// PatchArtifact changes title, viewer or project (nil leaves a field alone).
func (c *Client) PatchArtifact(ctx context.Context, id string, fields map[string]any) (Artifact, error) {
	var out Artifact
	return out, c.send2(ctx, http.MethodPatch, "/api/artifacts/"+esc(id), fields, &out)
}
