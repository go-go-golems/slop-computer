package rt

import (
	"regexp"
	"strings"
)

// A db path is slash-separated segments: a document path has an even number
// (tasks/t1, boards/b1/columns/c2), a collection path an odd number (tasks,
// boards/b1/columns).
var segmentRe = regexp.MustCompile(`^[A-Za-z0-9_.~:@+-]+$`)

func validPath(p string, doc bool) bool {
	if p == "" || len(p) > MaxPathBytes {
		return false
	}
	segs := strings.Split(p, "/")
	if len(segs) > MaxPathSegments || (len(segs)%2 == 0) != doc {
		return false
	}
	for _, s := range segs {
		if len(s) > MaxSegmentBytes || s == "." || s == ".." || !segmentRe.MatchString(s) {
			return false
		}
	}
	return true
}

// ValidDocPath reports whether p is a document path.
func ValidDocPath(p string) bool { return validPath(p, true) }

// ValidCollPath reports whether p is a collection path.
func ValidCollPath(p string) bool { return validPath(p, false) }

// CollOf is the collection a document path belongs to.
func CollOf(doc string) string {
	if i := strings.LastIndexByte(doc, '/'); i >= 0 {
		return doc[:i]
	}
	return ""
}

// IDOf is a document path's last segment.
func IDOf(doc string) string { return doc[strings.LastIndexByte(doc, '/')+1:] }

// privateOwner returns the user a data/users/<id>/… path belongs to. Such a
// path is private to that user: everyone else, the owner included, sees it
// as missing and cannot write it.
func privateOwner(p string) (string, bool) {
	segs := strings.SplitN(p, "/", 4)
	if len(segs) >= 3 && segs[0] == "data" && segs[1] == "users" {
		return segs[2], true
	}
	return "", false
}
