// Package doc is slop's help: Glazed help entries embedded in the binary and
// shown by `slop help` (SLOP3-026). topics/ holds concepts and references,
// tutorials/ step-by-step guides, examples/ single tasks, applications/
// end-to-end uses of shipped apps. Every page must parse: the loader skips a
// page with bad frontmatter silently, so doc_test.go checks them all.
package doc

import (
	"embed"
	"fmt"

	"github.com/go-go-golems/glazed/pkg/help"
)

//go:embed all:topics all:tutorials all:examples all:applications
var FS embed.FS

// AddDocToHelpSystem loads every page into the help system. The Glazed
// parser panics on some malformed frontmatter (a bare `on` in a list is a
// YAML bool); a bad page must cost the help, not the whole CLI.
func AddDocToHelpSystem(hs *help.HelpSystem) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("a help page did not parse: %v", r)
		}
	}()
	return hs.LoadSectionsFromFS(FS, ".")
}
