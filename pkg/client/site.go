package client

import (
	"context"
	"net/url"
)

// SiteIndex is the public URLs of a site host, one record each (GET
// /api/site): what a page reads as "$site". host "" is the first site host.
func (c *Client) SiteIndex(ctx context.Context, host string) ([]map[string]any, error) {
	q := url.Values{}
	if host != "" {
		q.Set("host", host)
	}
	var out []map[string]any
	err := c.get(ctx, "/api/site", q, &out)
	return out, err
}
