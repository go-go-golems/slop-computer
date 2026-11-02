// Package rt is slop's artifact runtime: the server side of the claude.ai
// Artifact runtime contract (window.claude.use and its capabilities). A page
// opened in the Workshop gets a view; the view's calls and live events go to
// this package, which keeps a contract-shaped document store per target
// artifact, rooms, assets, comments and sample. The page side is
// web/runtime (served as /_slop/claude.js).
package rt

// The contract's numbers, in one place. web/runtime/src/limits.ts holds the
// same values; TestLimitsMatchRuntime compares the two files.
const (
	MaxDocBytes        = 256 << 10 // a document body, serialized
	MaxDocDepth        = 32        // nesting of a document body
	MaxDocsPerTarget   = 25000     // live documents of one target
	MaxPathBytes       = 1000      // a db path
	MaxPathSegments    = 16        // segments of a db path
	MaxSegmentBytes    = 200       // one segment
	MaxRules           = 64        // db rules in a manifest
	MaxFilters         = 10        // where() filters in a query
	MaxInValues        = 30        // values of an in / not-in filter
	MaxQueryLimit      = 1000      // limit()
	MaxSubscriptions   = 64        // live subscriptions per view
	MinLeaseMs         = 1000      // acquire ttlMs bounds
	MaxLeaseMs         = 600000    //
	DefaultLeaseMs     = 30000     //
	MaxRoomData        = 4 << 10   // room.emit data, UTF-8 bytes of its JSON
	MaxPresence        = 4 << 10   // a merged presence object
	MaxTopics          = 16        // room topics in a manifest
	MaxRooms           = 16        // named rooms one view joins
	MaxCommentBytes    = 4 << 10   // comment text
	MaxAssetBytes      = 20 << 20  // an asset upload
	MaxCodeAssetBytes  = 16 << 20  // text/css and text/javascript assets
	MaxPromptBytes     = 256 << 10 // sample input text
	MaxToolResultBytes = 32 << 10  // a page tool's result
	MaxSendToClaude    = 4 << 10   // room.sendToClaudeSession data
)
