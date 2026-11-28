package doc

import (
	"io/fs"
	"strings"
	"testing"

	"github.com/go-go-golems/glazed/pkg/help/model"
)

// Every embedded page must parse (the loader skips a bad one silently), and
// every slug must be unique.
func TestEveryPageLoads(t *testing.T) {
	slugs := map[string]string{}
	n := 0
	err := fs.WalkDir(FS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".md") {
			return err
		}
		b, err := fs.ReadFile(FS, path)
		if err != nil {
			return err
		}
		s, err := model.ParseSectionFromMarkdown(b)
		if err != nil {
			t.Errorf("%s: %v", path, err)
			return nil
		}
		n++
		if s.Slug == "" || s.Title == "" || s.Short == "" {
			t.Errorf("%s: Slug, Title and Short are required", path)
		}
		if prev, ok := slugs[s.Slug]; ok {
			t.Errorf("%s: slug %q is also used by %s", path, s.Slug, prev)
		}
		slugs[s.Slug] = path
		if strings.HasPrefix(strings.TrimSpace(s.Content), "# ") {
			t.Errorf("%s: no top-level # heading (Glazed renders the title)", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("no pages embedded")
	}
}
