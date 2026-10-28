package render

import (
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/records"
)

func TestInject(t *testing.T) {
	boot := Boot{Mode: ModePreview, Data: map[string][]records.Record{"posts": {{"id": "x", "title": "</script><script>alert(1)</script>"}}}, Tokens: &records.Tokens{Colors: map[string]string{"ink": "#000"}}}
	out := string(Inject([]byte("<!doctype html><html><head><title>t</title></head><body>hi</body></html>"), boot))
	if !strings.HasPrefix(out, `<!doctype html><html><head><script type="application/json" id="slop-boot">`) {
		t.Fatal(out)
	}
	if strings.Contains(out, "</script><script>alert") {
		t.Fatal("boot JSON must not close its script element")
	}
	if !strings.Contains(out, `/_slop/bridge.js`) || !strings.Contains(out, `<style data-slop="tokens">html:root{--ink:#000}</style></head>`) {
		t.Fatal(out)
	}
	site := string(Inject([]byte("<p>no head"), Boot{Mode: ModeSite}))
	if !strings.HasPrefix(site, `<script type="application/json" id="slop-boot">`) || strings.Contains(site, "bridge.js") {
		t.Fatal(site)
	}
	dt := string(Inject([]byte("<!DOCTYPE html>\n<p>x"), Boot{Mode: ModeSite}))
	if !strings.HasPrefix(dt, "<!DOCTYPE html><script") {
		t.Fatal(dt)
	}
}
