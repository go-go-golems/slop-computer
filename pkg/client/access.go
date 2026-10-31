package client

import (
	"context"
	"net/http"
	"net/url"
	"time"
)

// Access is who may open a target and who has it open (GET
// /api/rt/targets/{t}/access).
type Access struct {
	Target string `json:"target"`
	App    string `json:"app"`
	Owner  *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"owner"`
	Grants []struct {
		Subject   string    `json:"subject"`
		Level     string    `json:"level"`
		Name      string    `json:"name"`
		Via       string    `json:"via"`
		CreatedAt time.Time `json:"createdAt"`
	} `json:"grants"`
	Links []Link `json:"links"`
	Views []struct {
		View      string    `json:"view"`
		Principal string    `json:"principal"`
		Name      string    `json:"name"`
		Kind      string    `json:"kind"`
		Level     string    `json:"level"`
		Since     time.Time `json:"since"`
	} `json:"views"`
	Routes []struct {
		Host   string `json:"host"`
		Path   string `json:"path"`
		Access string `json:"access"`
		URL    string `json:"url"`
	} `json:"routes"`
}

// Link is a share link of a target.
type Link struct {
	ID        string     `json:"id"`
	Level     string     `json:"level"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt"`
}

// NewLink is a link just made: its token is shown this once.
type NewLink struct {
	Link  Link     `json:"link"`
	Token string   `json:"token"`
	URLs  []string `json:"urls"`
}

func (c *Client) Access(ctx context.Context, target string) (Access, error) {
	var out Access
	return out, c.get(ctx, "/api/rt/targets/"+url.PathEscape(target)+"/access", nil, &out)
}

func (c *Client) Grant(ctx context.Context, target, subject, level string) error {
	return c.send2(ctx, http.MethodPut, "/api/rt/targets/"+url.PathEscape(target)+"/grants/"+url.PathEscape(subject), map[string]string{"level": level}, nil)
}

func (c *Client) Revoke(ctx context.Context, target, subject string) error {
	return c.do(ctx, request{method: http.MethodDelete, path: "/api/rt/targets/" + url.PathEscape(target) + "/grants/" + url.PathEscape(subject)}, nil)
}

func (c *Client) CreateLink(ctx context.Context, target, level string, days int) (NewLink, error) {
	var out NewLink
	return out, c.send2(ctx, http.MethodPost, "/api/rt/targets/"+url.PathEscape(target)+"/links", map[string]any{"level": level, "days": days}, &out)
}

func (c *Client) RevokeLink(ctx context.Context, target, id string) error {
	return c.do(ctx, request{method: http.MethodDelete, path: "/api/rt/targets/" + url.PathEscape(target) + "/links/" + url.PathEscape(id)}, nil)
}
