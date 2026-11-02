# A Pattern Language for Hosted Apps

Nov 2, 2026 · @Manuel Odendahl

Permissions, credentials, background code and budgets for platforms that run other people's apps.

## How to read this

This document collects nineteen patterns for platforms that run code they did not write. Such a platform has a host process, apps written by other people, and data that belongs to tenants. Each pattern names one recurring problem in deciding who may do what, and one arrangement of the system that keeps the problem from recurring. The patterns refer to each other: larger ones set the context for smaller ones, so applying them in order produces one design rather than a collection of checks.

The bugs these patterns address rarely come from a check nobody wrote. They come from checks that each look correct and disagree with each other. A platform grows entry points (pages, an HTTP API, a CLI, agents, scheduled jobs), kinds of principal (people, guests, tokens, apps acting on their own) and kinds of resource (documents, files, tables, paid model calls). Every new combination is another place where a rule has to be restated, and eventually one restatement differs. A pattern describes the arrangement in which the rule is stated once and holds everywhere.

### The form of each pattern

The form borrows from Christopher Alexander's *A Pattern Language* (a numbered pattern, a problem stated in bold, a solution that begins "Therefore", links to larger and smaller patterns) and from *Design Patterns* by Gamma, Helm, Johnson and Vlissides (consequences, sample code, known uses). Not every pattern needs every part.

| Part | What it says |
| --- | --- |
| Name, number, stars | ★★ marks an invariant: a design without it gets the bug the pattern describes. ★ marks a strong default with known exceptions. No star marks one reasonable choice among several |
| Context | Which larger patterns this one helps complete |
| Problem | One bold sentence, then the forces that make it hard |
| Therefore | The solution, in one bold sentence, then how it works |
| Sample code | Host code in Go, app code in TypeScript |
| Consequences | What the pattern buys and what it costs |
| How it goes wrong | The concrete bug that appears without it |
| Known uses | Systems that already work this way |
| Completed by | Smaller patterns that finish the job |

### The running example

One small platform appears in every example, so the patterns can be compared on the same ground.

- The **host** is one server process written in Go. It owns the databases, signs people in, and runs app code in a sandboxed JavaScript runtime.
- A **workspace** is one tenant's data: a database of documents and tables. `acme` is a team's workspace; `beta` is another team's.
- An **app** is code the host runs against workspaces: browser pages and server code. `wiki` is an app, and `acme` runs it. A second app, `guestbook`, runs on a public workspace of the same name, where anyone may sign.
- **Ana** owns `acme`. **Bo** is a member of the platform with edit access to `acme`. **Cy** is a paying subscriber. A visitor without an account arrives as guest `g7`. Ana's coding agent holds a read-only token, `tok_3`.
- `wiki` offers actions to its pages (`savePage`, `summarize`) and runs a nightly job, `digest`, that calls a paid language model.

One request shows how much the host has to decide. Bo's browser asks `wiki` to summarize the page `notes/q3` in `acme`. Before any app code runs, the host must settle five questions: who is asking, whether that person may call `summarize` on `acme`, whether the `wiki` code may read `notes/q3` and call a model, whose budget pays and whether enough remains, and what to say if any answer is no. Here is the answer a platform built from these patterns would print. It is a sketch of the target, not the output of an existing system, and every term in it is defined in the next section:

```
request    wiki.summarize on acme  {page: "notes/q3"}
who        usr:bo, browser session
may call   usr:bo holds edit on acme; summarize requires edit           allow
may read   wiki reads notes/q3 as ws:acme, within its manifest (notes/*)  allow
may spend  usr:bo has 410,000 of 500,000 µUSD left; round 1 holds 90,000  allow
pays       usr:bo
```

Each pattern below answers one of those questions so that the answer is the same however the request arrives: from a page, the API, an agent, or the nightly job.

## Terms

The patterns use a small vocabulary, and each term below depends only on the ones above it. The words are common, but several (subject, credential, effect) are used more narrowly than usual.

| Term | Meaning | In the example |
| --- | --- | --- |
| Host | The process that owns the data and runs app code. It is trusted; apps are not | the Go server |
| Workspace | One tenant's container of resources, the unit that access is given on | `acme` |
| Resource | Anything inside a workspace that can be read or changed, named by a path | `acme/docs/notes/q3` |
| App | Code written by someone other than the host's authors, in a specific version, with a manifest declaring what it needs | `wiki@17` |
| Subject | Something accountable in the audit log: a person, a guest, a workspace acting on its own, or the host | `usr:bo`, `guest:g7`, `ws:acme` |
| Authentication | Turning the bytes of a request into a subject and a credential | a session cookie becomes `usr:bo` |
| Credential | How a request arrived and the most it may ask for: a session, a token, a page's session, a delegate | Ana's read-only token |
| Level | A subject's standing on one workspace, from an ordered list | none < view < edit < admin < owner |
| Group | A set of subjects defined by a rule over their attributes, not listed by hand | `@member`, `@subscriber` |
| Grant | A stored fact: a subject or group holds a level on a workspace | `usr:bo` holds edit on `acme` |
| Operation | Something the host can do to a resource, from one fixed list | `doc.read`, `doc.write`, `model.call` |
| Action | A named entry point an app offers to its pages and to callers | `wiki.summarize` |
| Turn | One run of app code for one event, as one transaction | Bo's `summarize` call |
| Effect | One use of an operation by running code | the turn reads `notes/q3` |
| Decision | The host's answer for one effect: allow or deny, with the reasons | the trace in the introduction |
| Epoch | A counter of changes to authority state; a cached decision is valid only at the epoch it was made at | epoch 812 |
| Limit, balance, hold | How much may be spent in a period; how much has been spent and is held; one amount set aside before an expensive step | 500,000 µUSD a month; 90,000 held for a round |

µUSD is a millionth of a US dollar, so 500,000 µUSD is 50 cents.

## The language at a glance

Pattern 1 is the root: every other pattern either shapes the decision it makes or makes sure every request reaches it. Read the map from left to right, from large patterns to the smaller ones that complete them. Each pattern lists its other connections in its own text; the map shows one parent for each, to keep the shape visible.

&#91;embedded content: the language at a glance · 19 patterns, each completing a larger one\]

## Part I. The shape of authority

The first seven patterns decide what authority *is*: which facts produce it, which facts limit it, and how it passes from one holder to another. Get these right and the later patterns only have to make sure every request reaches them.

### 1. One decision over current state ★★

*The top of the language. Completed by 2, 8, 9, 11, 15 and 17.*

**When each entry point checks access on its own, the checks drift apart, and every new entry point is a new chance to leave one out.**

A platform starts with one entry point, and the access check lives next to it. Then a second door appears: an API for scripts, a CLI, an endpoint for agents, a job that imports a backup. Each gets a copy of the check, adapted slightly to its arguments. The copies are correct when written and diverge as the rules change. The failure is never "we forgot to check access"; it is "the import path checks membership but not the rule about who may replace app code". There is a second, quieter version of the same problem: a check made once and stored, such as a session that recorded the user's level when it opened, keeps answering for state that has since changed.

**Therefore: route every access question through one function that takes the subject, the credential, the operation and the resource, reads authority state as it is now, and returns a decision with its reasons.**

```go
type Request struct {
	Credential Credential // who is asking, and the most they may ask for (pattern 3)
	Op         Op         // a row of the operation table (pattern 8)
	Resource   Resource   // workspace and path
}

type Decision struct {
	Allow     bool
	Op        Op
	Resource  Resource
	Level     Level
	Sources   []string // what entered the max (pattern 2)
	Ceilings  []string // what entered the min
	Need      string   // what the operation required
	DecidedBy string   // the source, ceiling or need that settled it (pattern 17)
	Epoch     int64     // the state it was decided at (pattern 11)
	Expires   time.Time // the soonest end among the links and caveats it used
}

// Decide is the only code that answers "may they?".
func (a *Authz) Decide(ctx context.Context, r Request) Decision
```

The function does not enforce anything; it answers. Enforcement happens where resources are touched (pattern 9), and it asks this function. Security literature calls the two halves a policy decision point and policy enforcement points; the terms appear in XACML and in earlier IETF work on policy-based admission control, and the split is the point of the pattern.

**Consequences.**

- Every rule change is one diff in one place, and one table of test cases covers every entry point.
- `Decide` sits on every hot path, so it needs a cache that cannot go stale (pattern 11).
- Every input to authority must be reachable from it. An input it cannot see, such as a flag read only in one handler, is a second decision point that nobody reviews.

**How it goes wrong.** A platform's page API checks `level >= edit` before writing a document. Its CLI checks the token's scope. Its folder import restores documents and app code through a third path that checks only membership. All three are correct for the rules their authors had in mind, and the third lets a member replace an app's code.

**Known uses.** AWS IAM evaluates every request with one documented algorithm. Cedar exposes a single `is_authorized` call. Open Policy Agent is deployed as a decision service that enforcement code queries.

### 2. Sources and ceilings ★★

*Completes 1. Completed by 3, 4 and 5.*

**Authority comes from several places and is limited by several others; when code combines them branch by branch, some branch skips a limit.**

Bo may edit `acme` because of a grant. Ana may do everything because she owns it. A platform admin may administer every workspace. Those facts add authority. Other facts remove it: a guest may never go beyond edit, a disabled account holds nothing, a read-only token holds at most view. The natural code tests each case in turn and returns as soon as one matches. Early returns are where the limits get skipped: the ownership branch returns `owner` before the line that caps guests is reached.

**Therefore: classify every input as a source or a ceiling. The level is the maximum over the sources, then the minimum over the ceilings, computed as one expression with no other branch.**

```go
// Effective has no branches: every source enters the max, every ceiling the min.
func Effective(sources, ceilings []Level) Level {
	l := None
	for _, s := range sources {
		l = max(l, s)
	}
	for _, c := range ceilings {
		l = min(l, c)
	}
	return l
}
```

| Input | Kind | Value it contributes |
| --- | --- | --- |
| Owns the workspace | source | owner |
| A grant to the subject or one of its groups | source | the grant's level |
| Platform admin | source | admin |
| Guest, or account not yet approved | ceiling | edit |
| Disabled account | ceiling | none |
| Read-only token | ceiling | view |

A guest who has been granted admin by mistake gets `min(max(admin), edit) = edit`. A disabled owner gets `min(max(owner), none) = none`. Levels form an ordered list, so max and min are always defined, and three laws follow without further work: adding a source never lowers a level, adding a ceiling never raises one, and no combination of sources gets past any ceiling.

**Consequences.** The laws make access easy to reason about locally: an owner can grant without checking what else applies. The cost is discipline about what counts as an input. A condition such as "only while the document is unpublished" is neither a source nor a ceiling; it belongs in the action's own code, behind a declared floor (pattern 10).

**How it goes wrong.**

```go
if ws.Owner == p.ID {
	return Owner // returns before the cap below
}
l := highestGrant(p, ws)
return min(l, capFor(p))
```

An owner whose account is later restricted to guest-level access keeps owner on everything they created.

**Known uses.** AWS IAM computes effective permissions as what identity policies allow, intersected with permission boundaries and organization policies: sources and ceilings under other names.

### 3. Narrowing credentials ★★

*Completes 2. Completed by 6.*

**Giving someone part of your access usually means minting a new credential, and any code that mints can mint too much.**

Ana wants her coding agent to read but not write, a token that stops working after a week, and a child app to see one folder. Each is "Ana, but less". The usual implementation creates a token with its own list of permissions and checks at creation time that the list does not exceed Ana's. That check compares two permission sets, which is easy to get subtly wrong, and it happens once: when Ana is later demoted, the token keeps what it was given.

**Therefore: represent a credential as a root subject plus a list of caveats, where a caveat can only restrict. Delegate by appending caveats, and evaluate the whole chain against current state on every use.**

```go
// Caveat is a closed set: the unexported method stops other packages adding kinds.
type Caveat interface{ narrow(*Ceilings) }

type MaxLevel Level      // level ≤ this
type Within string       // resource path prefix
type OnlyOps []Op        // operations allowed
type Until time.Time     // expiry
type AppIs string        // only through this app (pattern 13)
type OnlyCaps []string   // only capabilities this app declared (pattern 13)

type Credential struct {
	root    Subject
	caveats []Caveat
}

// Narrow is the only way to derive a credential. Nothing can widen one.
func (c Credential) Narrow(cv Caveat) Credential {
	return Credential{root: c.root, caveats: append(slices.Clone(c.caveats), cv)}
}
```

From app code, the same idea reads as a chain of restrictions:

```ts
const calc = await host.delegate()
  .within("acme/docs/apps/calc/")
  .maxLevel("edit")
  .only("doc.read", "doc.write")
  .until(Date.now() + 60 * 60 * 1000)
  .issue();
```

```
calc reads acme/docs/apps/calc/state     allow
calc reads acme/docs/notes/diary         deny  outside within acme/docs/apps/calc/
Ana loses ownership of acme              calc's next call: deny, its root holds nothing
```

**Consequences.** Non-amplification holds by construction: a derived credential's limits are its parent's limits plus more, so nothing has to compare permission sets. Revoking or demoting the root reaches every credential derived from it on their next use. The cost is that every use walks the chain and checks the root's current state, and the caveat vocabulary must stay small enough that each one is cheap and obviously restrictive.

**How it goes wrong.** A "create token" endpoint accepts the scopes the caller asks for and checks them against the caller's role. The check is right on the day the token is made. Six months later the caller has left the admin group, and the token still carries admin scope.

**Known uses.** Macaroons (Birgisson and others, 2014) chain caveats with HMACs so a holder can narrow a token offline. Biscuit tokens do the same with public-key signatures and a Datalog policy language. Object-capability systems such as E and KeyKOS build on the same rule: holding a reference is the authority, and you can only pass on what you hold.

### 4. Ceilings instead of denials ★

*Completes 2.*

**Deny rules make the effect of every grant depend on every other rule, and they break the promise that a new grant or a delegation can only add.**

Every public workspace eventually needs to keep one person out: a guest who spams a public guestbook, a former contractor. The obvious tool is a deny rule beside the allow rules. Once denies exist, every decision needs an order of evaluation (does a deny on a group beat an allow on the person?), and the laws of pattern 2 stop holding: adding a grant to `@member` might now interact with a deny somewhere else. Reasoning about access stops being local.

**Therefore: do not store deny rules. Express every exclusion as a ceiling on a subject, kept as its own kind of fact and applied in the min.**

```go
// A ceiling fact is not a grant: it can only lower, and it lives in its own table.
type CeilingFact struct {
	Subject   string // "guest:g7" or "usr:bo"
	Workspace string
	Max       Level  // None bans
	Reason    string
	SetBy     string
}
```

```
guest:g7 on guestbook
sources   @anyone holds edit on guestbook        max  edit
ceilings  kind guest ≤ edit; ceiling fact ≤ none  min  none
deny      banned by usr:ana: "posted spam"
```

**Consequences.** Grants stay monotone, and bans are a short list someone can review. The cost is expressiveness: "everyone in `@member` except Bo" becomes a grant to `@member` plus a ceiling on Bo, which is the same thing stated in two places.

**How it goes wrong.** An operator adds a deny on `@member` to keep ordinary members out of a billing page. Groups nest (pattern 5), so every admin is also in `@member`, and the deny locks the admins out of their own billing page. The fix needs a second rule that beats the first, and the evaluation order becomes something people must learn.

**Known uses.** Kubernetes RBAC permits only allow rules. AWS IAM made the other choice and supports explicit denies; its documentation needs a dedicated evaluation-logic flowchart to explain how they interact with allows.

### 5. Groups, not ladders ★

*Completes 2. Completed by 7.*

**A single ordered scale of "who you are" mixes independent facts such as signed in, paying and staff, and each check that reads it decides for itself whether to compare by rank or by equality.**

Many platforms start with a ladder: guest < member < subscriber < admin. It is compact until two checks disagree about how to read it. One check asks `audience >= member` and lets subscribers in; another asks `audience == member` and shuts them out. A member who starts paying loses a feature. The ladder also puts unrelated facts on one axis: paying is a commercial fact, admin is an operational one, and nothing says an admin must rank above a subscriber.

**Therefore: compute group memberships in one function from the subject's attributes, decide nesting there and only there, and make every check ask whether the subject is in a group.**

```go
func Groups(p Person) []Group {
	switch {
	case p.Disabled:
		return nil
	case p.Guest, p.Pending:
		return []Group{Anyone}
	}
	gs := []Group{Anyone, Member}
	if p.Subscribed() || p.Admin { // nesting is decided here, once
		gs = append(gs, Subscriber)
	}
	if p.Admin {
		gs = append(gs, Admin)
	}
	return gs
}
```

| Question | As a group test |
| --- | --- |
| May this person create workspaces? | `In(groups, Member)` |
| Is the model feature on for them in `wiki`? | any group in `groups` with the feature on |
| What is their monthly model budget? | their own allotment, else the largest among their groups |

**Consequences.** Attributes change independently, and nesting is one reviewed decision. The cost of nesting is monotonicity: a feature on for `@member` is on for `@subscriber` too, so turning something off for a higher group needs a separate group.

**How it goes wrong.** The feature flag table matches the audience exactly while grants match "at least". An admin turns a feature on for members, and paying customers lose it.

**Known uses.** Google's Zanzibar lets one relation imply another through rewrite rules, so nesting is declared once instead of repeated in each check. LDAP directories offer dynamic groups whose members are computed by a search over attributes rather than listed.

### 6. Provenance ★★

*Completes 3. Completed by 11.*

**Authority derived from other authority, such as a share link's grants, a delegate or a link between workspaces, outlives its origin unless something remembers to clean it up.**

Ana makes a share link that gives edit on `acme`, and Cy opens it. The platform writes a grant for Cy. Later Ana revokes the link, or the link expires, or Ana leaves the company. Each of those events needs code that finds and removes what the link produced, and each is a place to forget: revocation deletes the grants, expiry does not, and nobody wrote the code for Ana leaving.

**Therefore: record on every derived fact the fact it came from, and count the derived fact only while its parent still holds, checked at decision time.**

```go
type Grant struct {
	Subject string
	Level   Level
	Via     string // "" for a direct grant, otherwise the link that produced it
}

// live reports whether a grant still counts. A derived grant needs its link
// to be current and the link's creator to still hold the link's level.
func (a *Authz) live(ctx context.Context, g Grant, ws string) bool {
	if g.Via == "" {
		return true
	}
	l := a.link(ctx, g.Via)
	return l.RevokedAt == nil &&
		a.now().Before(l.ExpiresAt) &&
		a.directLevel(ctx, l.Creator, ws) >= l.Level // ignores derived grants, so no cycles
}
```

**Consequences.** Every way a parent can stop holding (revoked, expired, its creator demoted or disabled) reaches the derived facts at once, with no cleanup job. Access listings can say why someone has access. The cost is an extra lookup per derived fact, which pattern 11 caches, and a rule that a parent's level is computed without derived facts, so no cycle can form.

**How it goes wrong.** Revoking a link deletes its grants, but expiry only blocks new redemptions, so everyone who opened an expired link keeps access indefinitely.

**Known uses.** X.509 certificate chains: a certificate is valid only while every issuer above it is. Macaroons: each caveat is bound to the one before it by an HMAC chain.

### 7. A small kernel vocabulary ★

*Completes 5. Completed by 10.*

**A short fixed list of levels is easy to compare and explain but cannot say "may moderate" without handing out "admin"; letting each app invent permissions makes the list impossible to reason about.**

The host's own operations, such as managing grants, replacing app code or deleting a workspace, need words that mean the same thing in every app. Apps need finer words: a guestbook wants moderators who can remove entries but not manage access. If the only answer is "make them admin", apps rebuild permissions themselves in their own data, where the host cannot see or explain them.

**Therefore: keep a short ordered list of levels for the host's operations, and let apps declare named rights, each implied by a level, that only the app's own requirements can name.**

```json
{
  "rights": {
    "post":     { "impliedBy": "edit",  "label": "Sign the guestbook" },
    "moderate": { "impliedBy": "admin", "label": "Edit or remove any entry" }
  }
}
```

```go
// Authority is a level plus a set of app rights. Grants combine by max and
// union; caveats by min and intersection, so pattern 3 still holds.
type Authority struct {
	Level  Level
	Rights map[string]bool // namespaced inside the host: "guestbook:moderate"
}

func (a Authority) Has(app Manifest, right string) bool {
	implied, declared := app.ImpliedBy(right)
	if !declared {
		return false // a right the manifest does not declare is held by nobody
	}
	return a.Rights[app.ID+":"+right] || a.Level >= implied
}

// Host operations ask for levels only; no app right can satisfy them.
```

**Consequences.** Moderators exist without admin, and the share dialog can show "Edit or remove any entry" instead of a level name. Because host operations never accept an app right, no app can mint something equivalent to admin. The cost is a second concept beside levels, and grants that stop having any effect when an app version drops a right.

**How it goes wrong.** A platform lets apps define custom roles as arbitrary bundles of permissions, including host ones. An app ships a role called "editor" that includes managing grants, and every editor can now make themselves owner.

**Known uses.** Google Docs keeps a fixed list (viewer, commenter, editor, owner). GitHub's custom repository roles start from a built-in base role and add specific permissions, which is the "implied by a level" structure.

## Part II. Enforcement

Part I defines one correct answer. Part II makes sure every request gets it: through one list of operations, at the resource itself, before app code runs, from caches that cannot go stale, and with responses that cannot be misread.

### 8. One operation table ★

*Completes 1. Completed by 9 and 10.*

**Every entry point describes what it does in its own terms, so nobody can list what the platform can do, or check that every path asks the decision function the same question.**

The same write reaches a workspace from a page call, an HTTP route, a CLI command, an agent tool and a helper that app code imports. If each describes its effect in its own vocabulary, the decision function receives five different questions for one operation, and a new entry point is free to invent a sixth.

**Therefore: keep one table of operations, each row saying what the operation touches and the least it requires, and make every entry point name a row. Entry points translate their input into a row and a resource; they do not decide.**

```go
type Reach int

const (
	Local    Reach = iota // the workspace's own authority (pattern 13); the default
	Personal              // the caller's authority, narrowed to the app
)

type OpSpec struct {
	Floor Level   // the least level on the workspace
	Group Group   // a group the subject must also be in, if any
	Cap   string  // a capability the app must declare, if any
	Reach Reach   // whose authority the effect uses (pattern 13)
	Cost  CostFn  // how it is charged, nil when free (pattern 16)
}

var Ops = map[Op]OpSpec{
	"doc.read":   {Floor: View},
	"doc.write":  {Floor: Edit},
	"grant.set":  {Floor: Admin, Reach: Personal},
	"code.push":  {Floor: Admin, Group: AdminGroup, Reach: Personal},
	"model.call": {Floor: View, Cap: "model", Reach: Personal, Cost: perRound},
}

// Entry points bind to rows; they translate input and nothing else.
httpAPI.Handle("PUT /ws/{ws}/docs/{path...}", bind("doc.write", resourceFromPath))
cli.Command("docs set", bind("doc.write", resourceFromArgs))
pageRPC.Method("db.set", bind("doc.write", resourceFromView))
```

A structural test turns "every path names an operation" into something CI checks:

```go
func TestEveryEntryPointNamesAnOp(t *testing.T) {
	for _, ep := range AllEntryPoints() {
		if _, ok := Ops[ep.Op]; !ok {
			t.Errorf("%s names no operation", ep.Name)
		}
	}
}
```

**Consequences.** API references, agent tool catalogs and permission screens can be generated from one table. A new entry point cannot invent semantics. The cost is that the table becomes a point of coordination, and its rows must stay coarse enough that there are dozens of them, not hundreds.

**How it goes wrong.** An agent tool wraps "write a document" with its own permission check written by the agent team. It checks the workspace level but not the per-path rules that the page API applies, so agents can write where pages cannot.

**Known uses.** Kubernetes authorizes every request as a verb (such as get, list, watch, create, update, patch and delete) on a resource type, with the same evaluation for every client.

### 9. Evidence at the resource ★★

*Completes 1 and 8. Completed by 12 and 13.*

**A check at an entry point protects that entry point; the resource is protected only if every path to it passes a check, and new paths keep appearing.**

Pattern 8 makes entry points declare operations, but a declaration is still something a path can lack. The function that actually writes the document is the one place every path must go through. If that function demands proof of a decision, a path without one does not compile.

**Therefore: make the functions that read or change a resource require evidence of a decision for that operation and resource, and make that evidence impossible to construct anywhere except in the decision code.**

```go
package authz

// Permit is evidence that Decide allowed one operation on one resource.
// Its fields are unexported, so no other package can make a valid one; Covers rejects the zero value.
type Permit struct {
	op    Op
	res   Resource
	epoch int64
}

func (a *Authz) Permit(ctx context.Context, r Request) (Permit, error)

// SystemPermit is for the host's own bookkeeping. Only package kernel calls
// it, so a search for SystemPermit lists every bypass.
func SystemPermit(reason string) Permit
```

```go
package store

func (w *Workspace) WriteDoc(p authz.Permit, path string, body []byte) error {
	if !p.Covers("doc.write", w.ID, path) {
		return ErrWrongPermit
	}
	// ... the write
}

// Reads that return many rows take the read rule as a predicate and apply it
// inside the query, before any LIMIT.
func (w *Workspace) Query(p authz.ReadPermit, q Query) ([]Doc, error)
```

In TypeScript the same guarantee comes from a class with a private constructor or a unique-symbol brand, within one program. Across a process boundary, the evidence has to be a signed value.

**Consequences.** A missing check becomes a type error, and the deliberate bypasses can be listed by search. The cost is threading permits through internal APIs, and a second permit shape for queries, which must filter before they limit.

**How it goes wrong.** A listing endpoint fetches 50 rows and then drops the ones the caller may not read. The caller gets fewer than 50 rows and can infer that hidden ones exist, and pagination skips visible ones.

**Known uses.** PostgreSQL row-level security applies read policies inside the query plan, so ordinary callers cannot forget them; superusers, roles with `BYPASSRLS` and, unless `FORCE ROW LEVEL SECURITY` is set, table owners skip them. Object-capability languages make the reference itself the evidence.

### 10. Declared requirements, fail closed ★★

*Completes 7 and 8.*

**When app code checks its own caller, one forgotten line opens an operation to everyone who can reach it.**

Apps offer their own entry points: actions their pages call, routes, tools. The host can check that the caller may reach the app at all, but only the app knows that `remove` should need admin while `stats` needs only view. If the app expresses that as a line of code at the top of each handler, the handler without the line is open.

**Therefore: make each app entry point declare what it requires, have the host check the declaration before running any app code, and give undeclared entry points the strictest reasonable default.**

```ts
export default defineApp({
  actions: {
    savePage: { requires: "edit", run: async (ctx, { path, body }) => ctx.db.set(path, body) },
    stats:    { requires: "view", run: (ctx) => ctx.db.get("stats/main") },
    remove:   { requires: "moderate", run: (ctx, { path }) => ctx.db.delete(path) }, // an app right (pattern 7)
    purge:    { run: (ctx) => ctx.db.deleteAll("drafts") }, // undeclared: the host requires admin
  },
});
```

```go
func (h *Host) CallAction(ctx context.Context, app *App, name string, cred Credential, args any) (any, error) {
	action, ok := app.Actions[name]
	if !ok {
		return nil, ErrNotFound
	}
	need := action.Requires
	if need == "" {
		need = "admin" // fail closed; activation already warned about it
	}
	if d := h.authz.Decide(ctx, actionRequest(cred, app, need)); !d.Allow {
		return nil, Denied(d)
	}
	return h.runtime.Run(ctx, app, action, cred, args)
}
```

The default has to be stricter than anything a workspace gives to everyone. A public workspace such as `guestbook` grants edit to `@anyone`, so a default of edit would let every guest run every undeclared action there. Admin is the safe default; refusing to activate an app with undeclared actions is stricter still.

Checks that depend on data stay in the action. "Authors may edit their own entries" needs the entry, so it is a line of app code inside a declared floor, not a replacement for one.

**Consequences.** A forgotten declaration locks an action down instead of opening it. The host can list every action with its requirement, which is what an agent needs to know before calling. The cost is that read-only actions must say so, and existing apps need a pass to declare their actions.

**How it goes wrong.** A `remove` action begins with `if (ctx.visitor.level !== "admin") throw ...`. A later refactor moves the body into a helper and drops the line. The host only checked that the caller may view the workspace, so every guest can now delete entries.

**Known uses.** Spring Security's `@PreAuthorize` and Django REST framework's `permission_classes` attach requirements to handlers and run them before the handler. Django REST framework also lets a project set a default permission class for views that declare none; the shipped default allows any request, so a project following this pattern sets a strict one.

### 11. Stamped decisions ★

*Completes 1 and 6.*

**Deciding on every call costs time, so decisions get cached in sessions and open pages, and a cached decision outlives the state it was made from.**

An open page makes hundreds of calls. Recomputing Bo's level on `acme` for each one means reading grants, groups and policy each time, so the page caches the answer when it opens. Then Ana downgrades Bo to view. The usual fix is a hook: whatever changes a grant must also tell every open page. Every new kind of change (a group membership, a feature setting for a group, a revoked link) needs the hook too, and the one that forgets leaves pages writing with old access.

**Therefore: keep a counter that moves on every change to authority state, stamp every cached decision with the counter's value and with the earliest expiry among the facts it used, and decide again when the counter has moved or that time has passed.**

```go
// In the store: every committed transaction on authority state moves the epoch.
func (db *DB) Tx(ctx context.Context, fn func(*sql.Tx) error) error {
	// ... begin, run fn, commit
	db.epoch.Add(1)
	return nil
}

type stamped struct {
	d       Decision
	epoch   int64
	expires time.Time // earliest expiry among the links and caveats the decision used
}

// In an open page: one cached decision per operation, valid only while the
// epoch is unchanged and no fact it relied on has expired.
func (v *View) May(ctx context.Context, op Op) bool {
	e, now := v.host.Epoch(), v.host.Now()
	if s, ok := v.cache[op]; ok && s.epoch == e && now.Before(s.expires) {
		return s.d.Allow
	}
	d := v.host.authz.Decide(ctx, v.request(op))
	v.cache[op] = stamped{d: d, epoch: e, expires: d.Expires}
	return d.Allow
}
```

Time is the one input that changes without a write. A link that expires or a credential with an `Until` caveat stops holding at a moment, not at a commit, so the counter alone would miss it; that is why each decision also carries its earliest expiry. `Decide` reports it as `Decision.Expires`, the soonest end among the links and caveats it relied on.

A coarse counter that moves on any write is the safe default. It invalidates more than strictly necessary, but it cannot miss a writer, which is the property that matters. Writes that are frequent and carry no authority, such as usage counters or audit rows, should go through a path that does not move it, or every model call would invalidate every open page.

**Consequences.** Nothing has to remember to notify anyone, and invalidation costs one comparison. The cost is extra recomputation after busy write periods, and the counter's scope: an in-process counter is right for in-process caches, while caches in several processes need a shared version number.

**How it goes wrong.** An open tab keeps saving after its user was downgraded, because the code path that changes group membership did not call the hook that the grant path calls.

**Known uses.** Zanzibar issues consistency tokens it calls zookies, so a check is evaluated against a snapshot at least as fresh as the change the client saw. HTTP entity tags make caches revalidate against a version instead of trusting age.

### 12. Untrusted bytes as a type ★

*Completes 9.*

**A platform that serves user content from the same origin as its own pages will run that content as its own code the first time one handler forgets one response header.**

The host serves its own trusted pages (sign-in, settings, the admin console) and bytes that users and apps uploaded. If an uploaded HTML file is served from the trusted origin without a sandbox policy, the browser runs it with the visitor's session for that origin. Each handler that serves bytes has to remember the right headers, and the next handler written for a new feature may not.

**Therefore: make every response on a trusted origin one of a few types, set security headers in the one writer that sends them, and give user-supplied bytes a type that can only be sent sandboxed.**

```go
type Response interface{ isResponse() }

type TrustedPage struct{ HTML []byte }    // the host's own pages
type JSON struct{ Status int; Body any }
type UserBytes struct{ File File }        // never rendered as this origin's page

// App pages need their scripts, so they are never served from a trusted
// origin at all: each app gets its own origin, with its own policy.
type AppPage struct{ App AppID; File File }

func (h hostPolicy) Write(w http.ResponseWriter, res Response) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	switch r := res.(type) {
	case TrustedPage:
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
		w.Write(r.HTML)
	case UserBytes:
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		if !r.File.IsMedia() {
			w.Header().Set("Content-Disposition", "attachment")
		}
		r.File.WriteTo(w)
	case AppPage:
		h.redirectToAppOrigin(w, r) // a trusted origin never serves app code
	case JSON:
		// ...
	}
}
```

Handlers choose a type; none of them sets a security header. The same rule applies at a larger scale by serving user content from a separate domain, so the browser never treats it as the platform's own.

**Consequences.** A new handler cannot forget the sandbox, because it has no way to send user bytes except as `UserBytes`. The cost is a small set of response types, and a type for each streaming shape the host uses.

**How it goes wrong.** A download route added for a new export feature serves files from the main origin with their stored content type. A user uploads an HTML file, shares the link, and the page it serves reads the viewer's data with their session.

**Known uses.** Google serves user content from `googleusercontent.com` and GitHub from `raw.githubusercontent.com`, keeping it off the origins that hold sessions. The `sandbox` directive of Content Security Policy gives a response a unique origin without permissions even when it is served from a trusted host.

## Part III. Code that acts

Apps are not just resources to protect; they act. Every effect they cause draws on someone's authority, and the two patterns here decide whose.

### 13. Whose authority ★★

*Completes 8 and 9. Completed by 14 and 15.*

**Hosted code acts for two parties at once, the workspace it runs in and the person who called it, and code that uses whichever authority is nearest becomes a confused deputy.**

The `wiki` server code is the server of `acme`. It legitimately reads every page in the workspace to build an index or a summary, including pages the caller cannot see, and returns only what the caller may have. Some of its effects are different in kind: calling a paid model spends someone's budget, changing a grant changes who has access, reading the caller's email reads personal data. If those effects use the workspace's broad authority, any caller can make the app do on their behalf what they could not do themselves. And when no person is behind the call at all, as in a nightly job, the tempting shortcut is to act as the workspace's owner, who never agreed to it.

**Therefore: tag every operation with whose authority it uses. Local operations use the workspace's own authority, which is owner of its own data plus whatever was granted to the workspace elsewhere, bounded by the app's manifest. Personal operations use the caller's live credential, narrowed to this app. With no caller, personal operations fall back to the workspace's own authority, and never borrow its owner.**

| Effect | Reach | Bo calls `summarize` | The nightly `digest` job |
| --- | --- | --- | --- |
| Read or write documents in `acme` | local | `ws:acme`, limited to the manifest | `ws:acme`, limited to the manifest |
| Read another workspace | local | grants made to `ws:acme` | grants made to `ws:acme` |
| Call the model | personal | `usr:bo` narrowed to `wiki`; Bo pays | `ws:acme`'s own allotment; `ws:acme` pays |
| Set a grant | personal | `usr:bo` narrowed to `wiki` | only where `ws:acme` holds admin |
| Read the caller's email | personal | `usr:bo`, with consent | refused: there is no caller |

```go
// principalFor returns the credential an effect is decided with.
func (t *Turn) principalFor(op Op) Credential {
	app := OnlyCaps(t.app.Declared)
	if Ops[op].Reach == Personal && t.caller != nil {
		return t.caller.Narrow(AppIs(t.app.ID)).Narrow(app)
	}
	// Local effects, and personal effects with no caller: the workspace itself,
	// which holds owner on its own data and only what was granted to it elsewhere.
	return t.workspace.Narrow(app)
}
```

```ts
every: {
  digest: {
    cron: "0 3 * * *",
    async run(ctx) {
      const notes = await ctx.db.query("notes", { where: { day: today() } });   // local
      const r = await ctx.model.call("Summarize:\n" + notes.map(n => n.text).join("\n")); // personal
      await ctx.db.set(`digests/${today()}`, { text: r.text });                // local
    },
  },
},
```

```
digest on acme, no caller
model.call   personal → ws:acme; ws:acme allotted 2,000,000 µUSD a month   allow, ws:acme pays

if digest also tried to share a page with beta:
grant.set    personal → ws:acme; ws:acme holds nothing on beta              deny
```

**Consequences.** No caller can use an app to exceed their own authority, and background work spends and acts only with what an admin gave the workspace on purpose. The cost is setup: an admin must grant or fund each workspace whose jobs need more than its own data, and the runtime must carry two principals per turn.

**How it goes wrong.** A nightly job calls the platform API to tidy up sharing. The runtime has no caller, so it uses the workspace owner's identity, and the job grants admin on another workspace to a list it read from a document anyone could edit.

**Known uses.** Norm Hardy named the problem in "The Confused Deputy" (1988): a compiler with authority to write its billing file was tricked by a caller into overwriting it. Cloud platforms give scheduled functions their own service identity rather than the identity of whoever deployed them.

### 14. Author's authority ★

*Completes 13.*

**Code that runs as a side effect of another operation, such as a database trigger, a hook or a reactor, tends to inherit the authority of whatever set it off, which can be far more than its author had.**

The `wiki` app defines a trigger on one of its tables. Normally the trigger fires when app code writes that table, and runs with the app's limited authority. But the host also writes app tables, during imports or maintenance, with full authority. If the trigger's body runs with the authority of the statement that fired it, an app-authored trigger fired by the host can do anything the host can, including writing the host's own internal tables.

**Therefore: run every piece of code with the authority of whoever wrote it, whatever triggered it.**

```go
// authorize is the SQL engine's callback for every access while a statement
// is prepared. inner names the trigger or view whose body caused the access.
func (s *Store) authorize(action int, arg1, arg2, db, inner string) int {
	caller := s.current.caller
	if inner != "" {
		caller = s.authorOf(inner) // app-defined trigger: app authority, always
	}
	return s.policy.allow(caller, action, arg1, arg2)
}
```

The same rule covers reactors and hooks one level up: a handler that runs because the host wrote something runs as the workspace (pattern 13), not as the host. One detail matters for SQL engines that authorize while a statement is prepared, as SQLite does: a prepared statement carries the authority it was checked with, so prepared statements must not be cached and reused across callers with different authority.

**Consequences.** No app code can borrow authority by arranging to be called by something stronger. The cost is that the host must know the author of every code object, and some database drivers do not pass the information needed to tell trigger bodies apart from the statement that fired them.

**How it goes wrong.** A workspace import restores app tables together with a trigger on one of the host's internal tables. The next time the host writes that table, the imported trigger runs with host authority.

**Known uses.** SQLite's authorizer callback receives the name of the innermost trigger or view responsible for each access. PostgreSQL makes the choice explicit per function: `SECURITY DEFINER` runs as the function's owner, `SECURITY INVOKER` as its caller. For code written by apps, this pattern always picks the author.

## Part IV. Finite resources

Permissions can be checked any number of times without being used up. Budgets cannot. The two patterns here keep the difference visible in the design.

### 15. Limits are authority, balances are state ★★

*Completes 1 and 13. Completed by 16.*

**Treating a budget like a permission ("may this person call the model?") checks it before the spend and records the spend afterwards, so parallel requests all pass the check and together spend past the limit.**

Bo has 250,000 µUSD left this month and opens five tabs that each ask `wiki` for a summary. Each request asks "does Bo have budget left?", each sees 250,000, and all five start. Each costs about 60,000, so together they spend about 300,000 against the 250,000 that was left. A permission check can be repeated and cached safely because asking does not consume anything. Money is consumed, so its check and its change must be one step.

**Therefore: derive the limit from policy, like any other authority, but keep the balance as state that changes through three operations only: reserve before the spend, settle with the actual amount, release when nothing was spent. Make every reservation atomic and idempotent.**

| Operation | Changes | Rule |
| --- | --- | --- |
| `reserve(account, n, key)` | reserved += n | One transaction: insert the hold under its key, then one conditional update that succeeds only if limit − spent − reserved ≥ n. A repeated key returns the existing hold |
| `settle(hold, m)` | spent += m, reserved −= n | In the period the hold was taken. The host caps each step so that m ≤ n |
| `release(hold)` | reserved −= n | Only when the provider was never contacted |
| `settleHeld(hold)` | settle(hold, n) | When the outcome is unknown, assume the provider billed the whole hold. A sweeper does this for holds that time out |

```sql
-- reserve, in one transaction
INSERT INTO holds (key, account, period, amount, state)
VALUES (:key, :account, :period, :n, 'held')
ON CONFLICT (key) DO NOTHING;          -- a retry finds the hold it already made

UPDATE balances
   SET reserved = reserved + :n
 WHERE account = :account AND period = :period
   AND (:limit IS NULL OR :limit - spent - reserved >= :n);
-- zero rows updated: roll back and refuse, before any provider call
```

```
balance    limit 500,000   spent 250,000   reserved 0          (µUSD)
tab 1      reserve 100,000   reserved 100,000                 ok
tab 2      reserve 100,000   reserved 200,000                 ok
tab 3      reserve 100,000   250,000 left − 200,000 held      refused, no provider call
tab 4, 5   the same                                           refused
tab 1      settle 61,000     spent 311,000   reserved 100,000
tab 2      settle 58,000     spent 369,000   reserved 0
```

The invariant is spent + reserved ≤ limit for every account and period. The conditional update keeps it under any interleaving of requests, provided no step settles more than it held; pattern 16 guarantees that by capping each step's output at what its hold covers.

**Consequences.** Overspending is impossible, up to the accuracy of the hold. Retries cannot double-charge, and crashes cannot leak money, because unknown outcomes expire at the full held amount. The cost is that holds must be conservative estimates, held capacity is unavailable until settled, and every spend adds a write; keep those writes off the authority counter of pattern 11.

**How it goes wrong.** A common shortcut lets a call that started with budget left finish past it. That is harmless for one call and wrong for twenty in parallel, or for one call that runs ten tool rounds.

**Known uses.** Card payments authorize an amount first and capture the final amount later; the authorization holds funds in between. Stripe's API takes an idempotency key on requests so a retried charge is not applied twice.

### 16. Reserve per step, price at the boundary ★

*Completes 15.*

**Long multi-step operations have no good up-front estimate, and raw counts such as tokens or calls cost different amounts on different resources.**

An agent run might take one model round or ten, each followed by tool calls that can take minutes. Reserving the worst case for the whole run locks most of a small budget for its duration; reserving only the first round lets the rest overspend. Separately, a budget expressed in tokens means one thing on a cheap model and something many times larger on an expensive one.

**Therefore: reserve before each step instead of once per operation, settle each step as it ends, and convert every count to one unit of cost at the moment it is reserved and settled.**

```go
type Meter interface {
	// Before reserves for one step. An error ends the run before the provider is contacted.
	Before(ctx context.Context, step int, est Estimate) (Hold, error)
}

type Hold interface {
	Settle(Usage) // pattern 15's settle, priced at the step's model
	SettleHeld()  // pattern 15's settleHeld: charge the whole hold
}

for step := 0; step < maxSteps; step++ {
	est := Estimate{Model: model, InputTokens: approxTokens(conv), MaxOutput: stepCap}
	hold, err := meter.Before(ctx, step, est)
	if err != nil {
		return partial(conv, err) // stops between steps, never mid-sentence
	}
	out, usage, err := provider.Run(ctx, model, conv, stepCap) // stepCap keeps usage within the hold
	if usage.Zero() && err != nil {
		hold.SettleHeld() // no usage report: the provider may still have billed it
	} else {
		hold.Settle(usage)
	}
	if err != nil {
		return partial(conv, err)
	}
	// ... append out to conv, run tools, decide whether to continue
}
```

```go
// Cost converts counts to one unit at the boundary: integer µUSD from per-million
// rates, rounded up so that a hold never covers less than its step can spend.
func (r Rates) Cost(u Usage) int64 {
	n := u.Input*r.InputPerM + u.Output*r.OutputPerM + u.CacheRead*r.CacheReadPerM
	return (n + 999_999) / 1_000_000
}
```

**Consequences.** A run that runs out of budget stops between steps with a clear reason, and a budget means the same amount of money whichever model is used. The cost is a rate table to keep current, and an estimate of input size before each call; dividing the bytes sent by three overestimates tokens for most text, which is the safe direction.

**How it goes wrong.** A platform reserves for the first round of a ten-round agent run and settles at the end. The remaining nine rounds spend whatever they spend.

**Known uses.** Commercial model APIs publish separate prices per model for input and output tokens, which is why a budget held in tokens means different amounts of money on different models.

## Part V. Verification

The last three patterns keep the rest true over time: decisions people can read, cases every implementation must pass, and a way to tell when the vocabulary should grow.

### 17. Explanation mirrors decision ★

*Completes 1. Completed by 18.*

**When the explanation of a denial is written separately from the decision, it drifts from what the code does, and neither people nor agents can tell what to change.**

A bare `permission denied` tells Ana's coding agent nothing about whether it lacks a grant, holds a read-only token, or is asking for something the app never declared. Hand-written messages are better until a rule changes and the message does not. Agents suffer most: given an opaque refusal, they retry through other entry points.

**Therefore: produce explanations from the decision's own structure: what entered the max, what entered the min, what the operation needed, and which of those decided the outcome.**

```json
{
  "allow": false,
  "op": "doc.write",
  "resource": "acme/docs/notes/q3",
  "level": "view",
  "sources": ["usr:ana owns acme"],
  "ceilings": ["token tok_3, Ana's agent: level ≤ view"],
  "need": "edit",
  "decidedBy": "ceilings[0]"
}
```

The same structure prints as three lines for people and stays JSON for agents. It must also respect what the caller may know: when the subject holds nothing on a workspace, the answer is `not_found`, not a list of who does have access.

**Consequences.** Support questions become readable, agents can repair their own requests, and tests can assert on why as well as whether. The cost is carrying reasons through the hot path; build them lazily, or only for denials and explicit explain calls.

**How it goes wrong.** A message says "only editors may do this" after the rule changed to require a separate right. Users ask for editor access, get it, and are still refused.

**Known uses.** `kubectl auth can-i` answers authorization questions from the command line, and the AWS IAM policy simulator shows which statement allowed or denied a request. Cedar returns the identifiers of the policies that determined each decision.

### 18. Shared cases ★

*Completes 17.*

**A rule set described in prose and implemented in code drifts, and a second implementation (a browser prototype, a client-side mirror, a policy simulator) drifts faster.**

Platforms often have more than one implementation of their rules: the server, a prototype used to design the system, a client that hides buttons the user cannot use. Each has its own tests, written by people with slightly different readings of the rules, so they disagree in exactly the places nobody wrote a test for.

**Therefore: write the worked examples as data, a set of situations with their expected decisions, run every implementation against them in CI, and add a case for each bug before fixing it.**

```json
{
  "name": "an owner set back to pending keeps only edit",
  "setup": {
    "people": [{ "id": "usr:ana", "role": "pending" }],
    "workspaces": [{ "id": "acme", "owner": "usr:ana" }]
  },
  "request": { "subject": "usr:ana", "op": "grant.set", "resource": "acme" },
  "expect": { "allow": false, "level": "edit" }
}
```

```go
func TestCases(t *testing.T) {
	for _, c := range loadCases(t, "testdata/authz/*.json") {
		t.Run(c.Name, func(t *testing.T) {
			h := newHost(t, c.Setup)
			got := h.Decide(c.Request)
			if got.Allow != c.Expect.Allow || got.Level != c.Expect.Level {
				t.Fatalf("got %v at %s, want %v at %s\n%s",
					got.Allow, got.Level, c.Expect.Allow, c.Expect.Level, got.Explain())
			}
		})
	}
}
```

Next to the cases, property tests check the laws of Part I on generated inputs: no level exceeds any ceiling, narrowing never raises a level, and adding a grant never lowers one.

**Consequences.** The specification becomes executable, and a second implementation stays honest without anyone reading it line by line. The cost is a setup format that every implementation must load.

**How it goes wrong.** The browser prototype applies the guest cap after ownership, as pattern 2 requires. The server returns early for owners and never applies it. Both test suites pass, because neither has a case with a restricted owner.

**Known uses.** The Cedar team checked its production engine against a formally verified model by differential random testing. The web-platform-tests project runs one shared suite against every browser engine.

### 19. Count the combining rules ★

*Completes the whole language; applies when changing an existing system.*

**Systems gain authority inputs one feature at a time, each with its own way of combining with the rest; the number of combining rules, more than the number of inputs, is what makes access hard to reason about.**

A platform that has grown for two years has an owner column, grants, roles, a subscription tier, feature flags by tier, per-person model budgets, session snapshots and checks inside handlers. Each was added for a reason. Together they combine in half a dozen different ways, and no one can answer "what can an admin's read-only token do?" without reading code.

**Therefore: before redesigning, list every input that affects a decision and how it combines today. Reduce the combining rules to max and min, and then grow the vocabulary only when apps start rebuilding a missing concept for themselves.**

| Input | Combines today as | Target |
| --- | --- | --- |
| Owner column | a branch before the caps | source (pattern 2) |
| Grants | max | source |
| Feature flags by tier | exact match on tier | group test (pattern 5) |
| Model budget rows | person override, else exact tier | limit (pattern 15) |
| Session snapshot | cached copy | stamped decision (pattern 11) |
| Checks inside handlers | voluntary | declared requirement (pattern 10) |

Every input should end in one of four places: a source, a ceiling, an operation's need, or a limit. When something fits none of them, it is either a business rule that belongs in app code, or a sign the vocabulary should grow:

- An app that keeps its own list of moderators is asking for app rights (pattern 7).
- People copying data into a second workspace to share part of it are asking for grants scoped to a path.
- Teams maintained by hand in documents are asking for a second kind of group, kept as data by workspace owners beside the computed groups of pattern 5.

Stop before a general policy language. Rules that depend on the contents of a record belong in the action that reads it, behind a declared floor.

**Consequences.** Complexity gets a number that can go down, and growth happens in steps that keep the laws of Part I. The cost is a few days of reading code to build the first inventory.

**How it goes wrong.** Each feature adds one more check in the most convenient place. Two years later, a token marked read-only can still list every user's email, because the listing checked the role and not the token.

## Using the language

A pattern language is applied in order, larger patterns first, because each one sets the context the next one completes. The order below is for a platform being built; the table after it is for reviewing one that already exists.

### Building a new platform

1. **Fix the vocabulary.** Write the operation table (8) and the short list of levels (7) before any handler exists. Everything later refers to them.
2. **Write the decision.** One function (1) that computes max over sources and min over ceilings (2), with groups computed in one place (5) and no deny rules (4).
3. **Shape credentials.** Sessions, tokens, links and delegates are narrowing chains (3); grants derived from links carry their provenance (6).
4. **Enforce at the resource.** Storage functions take permits (9); responses on trusted origins are typed (12).
5. **Admit app code.** App entry points declare their requirements (10); each operation says whose authority it uses (13); triggers and hooks run as their authors (14).
6. **Add the ledger before the first paid feature.** Limits from policy, balances through holds (15), one hold per step priced in one unit (16).
7. **Stamp caches as soon as anything is cached (11).**
8. **From the first day,** produce explanations from decisions (17) and keep the worked examples as shared cases (18). Both cost little early and a lot later.

### Reviewing an existing platform

Each question has a pattern behind it and a typical sign that the answer is no.

| Question | Pattern | A typical sign of trouble |
| --- | --- | --- |
| Is there exactly one function that answers "may they?" | 1 | The same rule appears in more than one handler |
| Can any path settle a level before every ceiling applies? | 2 | An early return for owners or admins |
| Can a credential gain power when handed on, or outlive its issuer's access? | 3, 6 | Token scopes checked only when the token is made |
| Are there deny rules? | 4 | A document explaining evaluation order |
| Does any check compare tiers by equality? | 5 | Customers lose a feature when they upgrade |
| Can a resource be changed without passing a check? | 9 | An import, restore or migration path |
| Does an app entry point open if one line is forgotten? | 10 | Access checks written inside handlers |
| Is any decision stored without a condition for when it expires? | 11 | Sessions or open pages that hold a level |
| Can user bytes be served unsandboxed on a trusted origin? | 12 | Security headers set by each handler |
| Whose authority does background code use? | 13 | "Runs as the owner" |
| Can code borrow the authority of whatever triggered it? | 14 | Triggers that fire during the host's own writes |
| Is spending checked before, or only recorded after? | 15 | "A call that started may finish past the budget" |
| Does a denial say why, in the terms of the rule? | 17 | A bare "permission denied" |

### What to remember

- Authority is computed as the maximum of its sources and then the minimum of its ceilings, in one expression with no early returns.
- Credentials only narrow, and derived authority lives only as long as what it came from; both are checked on every use, not when something is created.
- Every effect is decided at the resource it touches, and every app entry point fails closed when nobody declared its requirement.
- Hosted code acts either as itself or for its caller, chosen per operation; background code never borrows a person.
- Permission can be checked any number of times, while budget must be reserved before it is spent.

The nineteen patterns are a small set of rules applied in many places. A platform that follows them can add a new entry point, a new kind of credential or a new paid feature by adding a row, a caveat or a rate, without writing a new rule about who may do what.

## Further reading

- Christopher Alexander, Sara Ishikawa and Murray Silverstein, *A Pattern Language* (1977), for the form: numbered patterns, problems in bold, solutions beginning "Therefore".
- Erich Gamma, Richard Helm, Ralph Johnson and John Vlissides, *Design Patterns* (1994), for consequences, sample code and known uses.
- Norm Hardy, ["The Confused Deputy"](https://courses.cs.washington.edu/courses/cse551/19wi/readings/confused-deputy.html) (1988), the origin of pattern 13.
- Arnar Birgisson and others, ["Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud"](https://www.ndss-symposium.org/ndss2014/macaroons-cookies-contextual-caveats-decentralized-authorization-cloud) (NDSS 2014), for patterns 3 and 6.
- [Biscuit](https://engineering.clever-cloud.com/blog/engineering/2021/04/12/introduction-to-biscuit/), attenuable tokens with public-key signatures and a Datalog policy language, for pattern 3.
- Ruoming Pang and others, ["Zanzibar: Google's Consistent, Global Authorization System"](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/) (USENIX ATC 2019), for patterns 5 and 11.
- Craig Disselkoen and others, ["How We Built Cedar: A Verification-Guided Approach"](https://arxiv.org/abs/2407.01688) (2024), and the companion post ["How we built Cedar with automated reasoning and differential testing"](https://www.amazon.science/blog/how-we-built-cedar-with-automated-reasoning-and-differential-testing), for patterns 1, 17 and 18.
