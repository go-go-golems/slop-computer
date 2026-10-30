package client

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// DB runs one op of a target's document store (the ArtifactData surface):
// get, list, query, set, update, str_replace, delete or batch. in carries
// the op's fields: path, collection, data, query, field/old/new,
// if_version, as_level, limit, ops.
func (c *Client) DB(ctx context.Context, target string, in map[string]any, out any) error {
	return c.send2(ctx, http.MethodPost, "/api/rt/targets/"+url.PathEscape(target)+"/db", in, out)
}

// AgentView is a view an agent opened on a target: a room peer.
type AgentView struct {
	View   string         `json:"view"`
	Secret string         `json:"secret"`
	Level  string         `json:"level"`
	Caps   map[string]any `json:"caps"`
}

// OpenAgentView opens an agent view on a target.
func (c *Client) OpenAgentView(ctx context.Context, target string) (AgentView, error) {
	var v AgentView
	err := c.send2(ctx, http.MethodPost, "/api/rt/targets/"+url.PathEscape(target)+"/views", map[string]any{}, &v)
	return v, err
}

// ViewRPC calls a capability method as the view.
func (c *Client) ViewRPC(ctx context.Context, v AgentView, method string, args any, out any) error {
	var res struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	err := c.do(ctx, request{method: http.MethodPost, path: "/api/rt/rpc", body: map[string]any{"method": method, "args": args},
		headers: map[string]string{"Authorization": "Bearer " + v.Secret}}, &res)
	if err != nil {
		return err
	}
	if res.Error != nil {
		return &Error{Status: 400, Code: res.Error.Code, Message: res.Error.Message}
	}
	if out != nil {
		return json.Unmarshal(res.Result, out)
	}
	return nil
}

// ViewEvent is one event of a view's stream.
type ViewEvent struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// WatchView follows a view's stream until fn returns an error or ctx ends.
func (c *Client) WatchView(ctx context.Context, v AgentView, fn func(ViewEvent) error) error {
	resp, err := c.send(ctx, request{method: http.MethodGet, path: "/api/rt/events",
		headers: map[string]string{"Authorization": "Bearer " + v.Secret, "Accept": "text/event-stream"}})
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
			if err := fn(ViewEvent{Type: typ, Data: json.RawMessage(data)}); err != nil {
				return err
			}
			typ, data = "", ""
		}
	}
	return sc.Err()
}
