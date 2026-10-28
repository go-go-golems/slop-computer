// Copied from github.com/go-go-golems/francois@106776a pkg/catalog/client/client.go (studio/admin/account services removed).
// Package client is a typed Go client for slop's HTTP API, authenticated with
// a personal API token. The CLI uses it and never talks to the database, so
// the server's guard and checks apply to every call.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// maxJSONResponse bounds decoded response bodies; downloads stream instead.
const maxJSONResponse = 8 << 20

// Client calls one portal origin with one token.
type Client struct {
	base    string
	token   string
	http    *http.Client
	host    string
	retries int
	strict  bool
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient replaces the default client (2 minute timeout).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithHost overrides the Host header; the server routes by host, so tests
// and tunnels need it.
func WithHost(host string) Option { return func(c *Client) { c.host = host } }

// WithRetries sets how often GET and HEAD are retried on connection errors
// and 502/503/504 (default 3). Mutations are never retried.
func WithRetries(n int) Option { return func(c *Client) { c.retries = n } }

// WithHandler sends requests straight into an http.Handler, without a
// network hop. The remote MCP server uses it to call the portal in-process,
// through the same guard as any external caller.
func WithHandler(h http.Handler) Option {
	return func(c *Client) { c.http = &http.Client{Transport: handlerTransport{h}} }
}

// WithStrictDecoding rejects response fields the client types do not know.
// Contract tests use it to notice server changes the client has not followed.
func WithStrictDecoding() Option { return func(c *Client) { c.strict = true } }

// New returns a client for server (a portal origin such as
// https://slop.computer) authenticated with token (slp_…).
func New(server, token string, opts ...Option) *Client {
	c := &Client{base: strings.TrimRight(server, "/"), token: token, http: &http.Client{Timeout: 2 * time.Minute}, retries: 3}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Server is the portal origin the client calls.
func (c *Client) Server() string { return c.base }

type handlerTransport struct{ h http.Handler }

func (t handlerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	rec := httptest.NewRecorder()
	t.h.ServeHTTP(rec, r)
	return rec.Result(), nil
}

// request describes one call.
type request struct {
	method, path string
	query        url.Values
	body         any       // JSON-encoded unless bodyReader is set
	bodyReader   io.Reader // raw body
	contentType  string
	headers      map[string]string
}

func (c *Client) newRequest(ctx context.Context, rq request, payload []byte) (*http.Request, error) {
	u := c.base + rq.path
	if len(rq.query) > 0 {
		u += "?" + rq.query.Encode()
	}
	var body io.Reader
	switch {
	case rq.bodyReader != nil:
		body = rq.bodyReader
	case payload != nil:
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, rq.method, u, body)
	if err != nil {
		return nil, err
	}
	if c.token != "" { // the device login endpoints take no token
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Accept", "application/json")
	if rq.contentType != "" {
		req.Header.Set("Content-Type", rq.contentType)
	} else if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range rq.headers {
		req.Header.Set(k, v)
	}
	if c.host != "" {
		req.Host = c.host
	}
	return req, nil
}

// send performs the request with retries for idempotent methods and returns
// the response, which the caller must close. Status ≥ 300 becomes *Error.
func (c *Client) send(ctx context.Context, rq request) (*http.Response, error) {
	var payload []byte
	if rq.body != nil && rq.bodyReader == nil {
		var err error
		if payload, err = json.Marshal(rq.body); err != nil {
			return nil, err
		}
	}
	idempotent := rq.method == http.MethodGet || rq.method == http.MethodHead
	for attempt := 0; ; attempt++ {
		req, err := c.newRequest(ctx, rq, payload)
		if err != nil {
			return nil, err
		}
		start := time.Now()
		resp, err := c.http.Do(req)
		retry := idempotent && attempt < c.retries && (err != nil || resp.StatusCode == 502 || resp.StatusCode == 503 || resp.StatusCode == 504)
		if err == nil {
			log.Debug().Str("method", rq.method).Str("path", rq.path).Int("status", resp.StatusCode).Dur("took", time.Since(start)).Msg("api call")
		}
		if retry {
			if resp != nil {
				_ = resp.Body.Close()
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(250<<attempt) * time.Millisecond):
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		if resp.StatusCode >= 300 {
			defer func() { _ = resp.Body.Close() }()
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxJSONResponse))
			return nil, decodeError(resp.StatusCode, raw)
		}
		return resp, nil
	}
}

// do sends rq and decodes a JSON response into out (nil discards it).
func (c *Client) do(ctx context.Context, rq request, out any) error {
	resp, err := c.send(ctx, rq)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, maxJSONResponse))
	if c.strict {
		dec.DisallowUnknownFields()
	}
	return dec.Decode(out)
}

func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	return c.do(ctx, request{method: http.MethodGet, path: path, query: q}, out)
}

func (c *Client) send2(ctx context.Context, method, path string, in, out any) error {
	return c.do(ctx, request{method: method, path: path, body: in}, out)
}

// download streams a response body to w and returns its size.
func (c *Client) download(ctx context.Context, path string, w io.Writer) (int64, error) {
	resp, err := c.send(ctx, request{method: http.MethodGet, path: path})
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	return io.Copy(w, resp.Body)
}

func esc(s string) string { return url.PathEscape(s) }

func itoa(n int) string { return strconv.Itoa(n) }
