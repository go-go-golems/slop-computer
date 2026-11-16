package pages

import (
	"strings"
	"testing"
)

// instrument (SLOP3-022 C.1): body elements get their source line, the
// rest of the page is left byte for byte.
func TestInstrument(t *testing.T) {
	page := "<!doctype html>\n<html><head><title>T</title>\n<style>p > a { color: red }</style></head>\n" +
		"<body class=\"x\">\n<main id=m>\n  <p>one <a href=\"#\">two</a></p>\n" +
		"  <input name=q\n    type=text/>\n  <img src=\"a.png\"/><div data-src=\"keep:9\">k</div>\n" +
		"  <script>if (a<b) document.write('<p>no</p>')</script>\n<br></main>\n</body></html>\n"
	got := string(instrument([]byte(page), "index.html"))
	for _, want := range []string{
		`<body class="x" data-src="index.html:4">`,
		`<main id=m data-src="index.html:5">`,
		`<p data-src="index.html:6">one <a href="#" data-src="index.html:6">two</a></p>`,
		"<input name=q\n    type=text/ data-src=\"index.html:7\">", // the slash is the unquoted value's
		`<img src="a.png" data-src="index.html:9"/>`,               // after the two-line input
		`<div data-src="keep:9">k</div>`,
		`<script>if (a<b) document.write('<p>no</p>')</script>`,
		`<title>T</title>`,
		`<style>p > a { color: red }</style>`,
		"<br></main>",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in\n%s", want, got)
		}
	}
	if strings.Count(got, "data-src=") != 7 {
		t.Errorf("data-src count = %d, want 7 (body, main, p, a, input, img, the kept div):\n%s", strings.Count(got, "data-src="), got)
	}
	// Without <body>, every element that renders is instrumented.
	if got := string(instrument([]byte("<title>t</title><ul>\n<li>a</li></ul>"), "f.html")); got != `<title>t</title><ul data-src="f.html:1">`+"\n"+`<li data-src="f.html:2">a</li></ul>` {
		t.Errorf("no body: %s", got)
	}
	// A file name cannot break out of the attribute.
	if got := string(instrument([]byte(`<p>x</p>`), `a"b.html`)); got != `<p data-src="a&#34;b.html:1">x</p>` {
		t.Errorf("escaping: %s", got)
	}
}
