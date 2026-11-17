// Package apptypes holds the TypeScript declarations slop gives apps
// (SLOP3-024, design §5): page.d.ts, window.claude's type, built from
// web/runtime (make runtime), and actor.d.ts, the actor runtime's globals,
// ctx, definition and built-in modules, written by hand. app.types returns
// them with an app's modules.d.ts, which the actor manager generates;
// slop types writes all three into an app's .slop/types/.
package apptypes

import _ "embed" // the declaration files

// Page is page.d.ts.
//
//go:embed page.d.ts
var Page string

// Actor is actor.d.ts (pkg/host's TestActorTypesDrift checks it against
// the runtime).
//
//go:embed actor.d.ts
var Actor string
