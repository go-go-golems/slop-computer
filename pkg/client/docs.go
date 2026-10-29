package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Doc is a live document of a design artifact (Pinup's file, layers,
// feedback, history and inbox). Data is null for a tombstone.
type Doc struct {
	Path string          `json:"path"`
	Data json.RawMessage `json:"data"`
	Rev  int64           `json:"rev"`
	By   *string         `json:"by,omitempty"`
	At   time.Time       `json:"at"`
}

// DocEvent is one event of a design's docs stream: a document change
// ("doc"), a peer's presence ("presence"), or the end of the replay
// ("ready", Rev only).
type DocEvent struct {
	Type string          `json:"type"`
	Path string          `json:"path,omitempty"`
	Rev  int64           `json:"rev,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
	Big  bool            `json:"big,omitempty"`
	Raw  json.RawMessage `json:"raw"`
}

func docURL(artifact, path string) string {
	coll, id, _ := strings.Cut(path, "/")
	return "/api/docs/" + url.PathEscape(artifact) + "/" + url.PathEscape(coll) + "/" + url.PathEscape(id)
}

// Docs lists a design's documents under prefix changed after rev (0: the
// live ones), with the design's newest rev.
func (c *Client) Docs(ctx context.Context, artifact, prefix string, after int64) ([]Doc, int64, error) {
	var out struct {
		Docs []Doc `json:"docs"`
		Rev  int64 `json:"rev"`
	}
	q := url.Values{}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if after > 0 {
		q.Set("after", strconv.FormatInt(after, 10))
	}
	err := c.get(ctx, "/api/docs/"+url.PathEscape(artifact), q, &out)
	return out.Docs, out.Rev, err
}

// Doc reads one live document.
func (c *Client) Doc(ctx context.Context, artifact, path string) (Doc, error) {
	var d Doc
	return d, c.get(ctx, docURL(artifact, path), nil, &d)
}

// PutDoc writes a document (a JSON object) and returns its rev.
func (c *Client) PutDoc(ctx context.Context, artifact, path string, data json.RawMessage) (int64, error) {
	var out struct {
		Rev int64 `json:"rev"`
	}
	err := c.do(ctx, request{method: http.MethodPut, path: docURL(artifact, path), bodyReader: bytes.NewReader(data), contentType: "application/json"}, &out)
	return out.Rev, err
}

// DeleteDoc deletes a document and returns the tombstone's rev.
func (c *Client) DeleteDoc(ctx context.Context, artifact, path string) (int64, error) {
	var out struct {
		Rev int64 `json:"rev"`
	}
	err := c.do(ctx, request{method: http.MethodDelete, path: docURL(artifact, path)}, &out)
	return out.Rev, err
}

// WatchDocs follows a design's docs stream from after, reconnecting from
// the last rev it saw, until ctx ends or fn returns an error.
func (c *Client) WatchDocs(ctx context.Context, artifact string, after int64, fn func(DocEvent) error) error {
	last := after
	for {
		err := c.watchOnce(ctx, artifact, &last, fn)
		var stop stopWatch
		if errors.As(err, &stop) {
			return stop.err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if IsNotFound(err) || IsCode(err, "invalid_request") || IsCode(err, "grant_permission") {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

type stopWatch struct{ err error }

func (s stopWatch) Error() string { return s.err.Error() }

func (c *Client) watchOnce(ctx context.Context, artifact string, last *int64, fn func(DocEvent) error) error {
	q := url.Values{"after": {strconv.FormatInt(*last, 10)}}
	resp, err := c.send(ctx, request{method: http.MethodGet, path: "/api/docs/" + url.PathEscape(artifact) + "/events", query: q})
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	typ, data := "", ""
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			typ = line[7:]
		case strings.HasPrefix(line, "data: "):
			data += line[6:]
		case line == "" && typ != "":
			ev := DocEvent{Type: typ, Raw: json.RawMessage(data)}
			_ = json.Unmarshal([]byte(data), &ev)
			ev.Type = typ
			if typ == "doc" && ev.Rev > *last {
				*last = ev.Rev
			}
			if err := fn(ev); err != nil {
				return stopWatch{err}
			}
			typ, data = "", ""
		}
	}
	return sc.Err()
}
