package authz

import "github.com/go-go-golems/slop-computer/pkg/access"

// CodeRight is the authority to change app code (decision D9): the tree
// and refs of a store that holds app.json, or app.json itself. The store
// refuses those writes to a turn without it, whoever the caller is, and
// only this package makes one: a grep for CodeRightOf and KernelCodeRight
// lists every way to hold it.
type CodeRight struct{ ok bool }

// OK reports whether the right is held.
func (c CodeRight) OK() bool { return c.ok }

// CodeRightOf is p's right: admins (and the kernel itself) push app code,
// nobody else, actors included.
func CodeRightOf(p *access.Principal) CodeRight { return CodeRight{ok: p.IsAdmin()} }

// KernelCodeRight is for writes the kernel makes on its own account
// (tests that build app stores directly).
func KernelCodeRight() CodeRight { return CodeRight{ok: true} }
