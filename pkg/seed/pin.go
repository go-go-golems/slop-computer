package seed

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Links to a data artifact's files at main (/_d/<artifact>/main/…) are
// place URLs: a browser revalidates them on every use. When the seed pushes
// that artifact first, links to it in the files pushed after it name its
// version instead (/_d/<artifact>/<n>/…), a content URL cached for good
// (SLOP-012). A later push that changes the linked artifact changes the
// linking files too, so they get a new version with the new number.

var mainLink = regexp.MustCompile(`/_d/([a-z0-9][a-z0-9-]{0,62})/main/`)

// pinLinks rewrites links to main of artifacts in mains to their version.
func pinLinks(b []byte, mains map[string]int) []byte {
	return mainLink.ReplaceAllFunc(b, func(m []byte) []byte {
		id := string(mainLink.FindSubmatch(m)[1])
		if n := mains[id]; n > 0 {
			return []byte("/_d/" + id + "/" + strconv.Itoa(n) + "/")
		}
		return m
	})
}

var textExt = map[string]bool{".json": true, ".md": true, ".html": true, ".htm": true, ".css": true, ".js": true,
	".txt": true, ".yaml": true, ".yml": true, ".csv": true, ".tsv": true, ".svg": true}

// isText reports whether a file may hold links worth pinning.
func isText(p string) bool { return textExt[strings.ToLower(filepath.Ext(p))] }

// linksToData reports whether any text file of an artifact's versions links
// to a data artifact at main.
func linksToData(dir string, a Artifact) bool {
	found := false
	for _, v := range a.Versions {
		_ = filepath.WalkDir(VersionDir(dir, a.ID, v.N), func(p string, d fs.DirEntry, err error) error {
			if err != nil || found || d.IsDir() || !isText(p) {
				return err
			}
			b, err := os.ReadFile(p) // #nosec G304 -- files of the seed directory
			if err == nil && mainLink.Match(b) {
				found = true
				return filepath.SkipAll
			}
			return nil
		})
	}
	return found
}
