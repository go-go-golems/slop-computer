package records

import (
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	post := Parse("posts/routes-not-templates.md", []byte("---\ntitle: Routes, not templates\ndate: 2026-10-26\ntags: [workshop, routing]\ndraft: false\n---\nUntil now, **every** URL lived in the server.\n"))
	if post["id"] != "routes-not-templates" || post["title"] != "Routes, not templates" || post["draft"] != false {
		t.Fatalf("post %v", post)
	}
	if tags := post["tags"].([]string); len(tags) != 2 || tags[1] != "routing" {
		t.Fatalf("tags %v", post["tags"])
	}
	if !strings.Contains(post["html"].(string), "<strong>every</strong>") || post["minutes"] != 1 {
		t.Fatalf("html %v minutes %v", post["html"], post["minutes"])
	}
	exp := Parse("experiments/orbits.json", []byte(`{"title":"Orbits","colors":["#000"]}`))
	if exp["id"] != "orbits" || exp["title"] != "Orbits" {
		t.Fatalf("json %v", exp)
	}
	if bad := Parse("x/bad.json", []byte(`{`)); bad["error"] == nil {
		t.Fatal("bad JSON must be marked")
	}
	if meta, body := FrontMatter("no front matter"); len(meta) != 0 || body != "no front matter" {
		t.Fatal("plain text")
	}
}

func TestTokensCSS(t *testing.T) {
	tk := Tokens{Colors: map[string]string{"ink": "#1a1a1a", "sky": "#CEE5FF", "bad;x": "red", "evil": "red}body{x:y"}, Radius: "0"}
	tk.Type.Mono = "ui-monospace"
	css := tk.CSS()
	if css != "html:root{--ink:#1a1a1a;--sky:#CEE5FF;--mono:ui-monospace;--radius:0}" {
		t.Fatal(css)
	}
}
