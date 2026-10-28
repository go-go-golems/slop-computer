// Package doc holds slop's embedded help topics: `slop help <slug>` in the
// CLI, and /help/<slug> on the server for admins.
package doc

import (
	"embed"
	"io/fs"
	"strings"

	"github.com/go-go-golems/glazed/pkg/help"
)

//go:embed topics/*.md
var topics embed.FS

// AddDocToHelpSystem loads the embedded topics.
func AddDocToHelpSystem(hs *help.HelpSystem) error {
	return hs.LoadSectionsFromFS(topics, "topics")
}

// Server and SiteHost are the placeholders topics use for the main host and
// the first site host; the server fills in its own.
const (
	Server   = "https://your-slop-server"
	SiteHost = "site.your-slop-server"
)

// Topic returns a topic's title and Markdown body (front matter removed).
func Topic(slug string) (string, string, bool) {
	raw, err := fs.ReadFile(topics, "topics/"+slug+".md")
	if err != nil {
		return "", "", false
	}
	text, title := string(raw), ""
	if strings.HasPrefix(text, "---\n") {
		if end := strings.Index(text[4:], "\n---\n"); end >= 0 {
			for _, line := range strings.Split(text[4:4+end], "\n") {
				if v, found := strings.CutPrefix(line, "Title: "); found {
					title = strings.TrimSpace(v)
				}
			}
			text = text[4+end+5:]
		}
	}
	return title, text, true
}
