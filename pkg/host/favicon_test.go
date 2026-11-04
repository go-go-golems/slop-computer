package host

import (
	"strings"
	"testing"
)

// The main host and the live hosts serve slop's icon; a static host serves
// only its sites' files (a site may ship its own favicon).
func TestFavicon(t *testing.T) {
	h := newHarness(t)
	for _, c := range []struct {
		host, path, ctype string
	}{
		{h.cfg.Hosts.Main, "/favicon.ico", "image/x-icon"},
		{h.cfg.Hosts.Main, "/favicon.svg", "image/svg+xml"},
		{h.cfg.Hosts.Live[0], "/favicon.ico", "image/x-icon"},
		{h.cfg.Hosts.Live[0], "/favicon.svg", "image/svg+xml"},
	} {
		resp, body := h.get(c.host, c.path)
		if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != c.ctype || len(body) < 100 {
			t.Errorf("%s%s: %d %s, %d bytes", c.host, c.path, resp.StatusCode, resp.Header.Get("Content-Type"), len(body))
		}
	}
	if _, body := h.get(h.cfg.Hosts.Main, "/favicon.svg"); !strings.HasPrefix(body, "<svg") {
		t.Errorf("favicon.svg is not an SVG: %.40q", body)
	}
	if resp, _ := h.get(h.cfg.Hosts.Static[0], "/favicon.ico"); resp.StatusCode == 200 {
		t.Error("a static host serves slop's icon over its sites'")
	}
}
