package francois

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Markers from francois pkg/catalog/releases/releases.go: a release that
// boots francois's runtime, and scripts loaded from other hosts.
var (
	bootstrapMarker = regexp.MustCompile(`id=["']francois-view["']|/static/runtime\.js`)
	externalScript  = regexp.MustCompile(`(?i)<script[^>]+src=["'](https?:)?//([^/"']+)`)
)

// Runtime capabilities slop's page runtime does not have (gap G5).
var runtimeCaps = map[string]bool{"db": true, "user": true, "room": true, "comments": true, "assets": true, "artifact": true, "files": true}

// Census counts what the imported content uses that slop does not serve yet.
type Census struct {
	Source   string    `json:"source"`
	TakenAt  time.Time `json:"takenAt"`
	Imported time.Time `json:"imported"`

	Artifacts         int            `json:"artifacts"`
	WithReleases      int            `json:"artifactsWithReleases"`
	Releases          int            `json:"releases"`
	ReleaseStates     map[string]int `json:"releaseStates"`
	FreeSamples       int            `json:"freeSamples"`
	HTMLOriginal      int            `json:"htmlOriginal"`
	HTMLMissing       int            `json:"htmlPlaceholder"`
	HTMLBytes         int64          `json:"htmlBytes"`
	RuntimeMarker     int            `json:"runtimeMarker"`
	MarkerUnknown     int            `json:"runtimeMarkerUnknown"`
	Capabilities      map[string]int `json:"capabilities"`
	Buckets           []*Bucket      `json:"buckets"`
	ExternalHosts     map[string]int `json:"externalScriptHosts"`
	Attachments       int            `json:"attachments"`
	AttachmentsCopied int            `json:"attachmentsCopied"`
	AttachmentBytes   int64          `json:"attachmentBytes"`

	Storefront struct {
		Listed, Hidden, Featured, Drafts, Demo int
		EarlyAccess                            int `json:"earlyAccessFuture"`
		LaunchModes                            map[string]int
		WithCreators                           int
	} `json:"storefront"`

	Media struct {
		Library, Copied, Unavailable int
		LibraryBytes, CopiedBytes    int64
		Dangling                     []string
	} `json:"media"`
	Posts    map[string]int   `json:"posts"`
	Creators int              `json:"creators"`
	Admins   int              `json:"admins"`
	Counts   map[string]int64 `json:"notImported"`
	Gaps     []Gap            `json:"gaps"`

	buckets map[string]*Bucket
	blocked map[string]map[string]bool // gap → artifacts
	gapRel  map[string]int
}

// Bucket groups releases by what they need from slop.
type Bucket struct {
	Name      string   `json:"name"`
	Releases  int      `json:"releases"`
	Artifacts []string `json:"artifacts"`
}

// Gap is a missing slop feature with the imported content it blocks.
type Gap struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Releases  int    `json:"releases"`
	Artifacts int    `json:"artifacts"`
}

var gapTitles = map[string]string{
	"G3":  "Access tiers: paid and early-access releases are public on slop",
	"G4":  "Withdrawn and draft releases: kept as non-main versions",
	"G5":  "Page runtime capabilities (any of db, user, room, comments, assets, artifact, files)",
	"G9":  "Release HTML not readable by this source (placeholder pages)",
	"G10": "Scripts from other hosts (CSP and offline use)",
}

func newCensus(s *Snapshot) *Census {
	c := &Census{Source: s.Source, TakenAt: s.TakenAt, Imported: time.Now().UTC(), Artifacts: len(s.Artifacts),
		ReleaseStates: map[string]int{}, Capabilities: map[string]int{}, ExternalHosts: map[string]int{}, Posts: map[string]int{},
		Creators: len(s.Creators), Counts: s.Counts, buckets: map[string]*Bucket{}, blocked: map[string]map[string]bool{}, gapRel: map[string]int{}}
	c.Storefront.LaunchModes = map[string]int{}
	c.Media.Library = len(s.Media)
	for _, m := range s.Media {
		c.Media.LibraryBytes += m.File.Size
	}
	for _, p := range s.Posts {
		c.Posts[p.State]++
	}
	for _, u := range s.Users {
		if u.Role == "admin" && !u.Disabled {
			c.Admins++
		}
	}
	if c.Counts == nil {
		c.Counts = map[string]int64{}
	}
	return c
}

func (c *Census) gap(id, artifact string) {
	c.gapRel[id]++
	if c.blocked[id] == nil {
		c.blocked[id] = map[string]bool{}
	}
	c.blocked[id][artifact] = true
}

func (c *Census) danglingMedia(id string) { c.Media.Dangling = append(c.Media.Dangling, id) }

func (c *Census) media(m Media, copied bool) {
	if copied {
		c.Media.Copied++
		c.Media.CopiedBytes += m.File.Size
	} else {
		c.Media.Unavailable++
	}
}

func (c *Census) attachment(f File, copied bool) {
	c.Attachments++
	c.AttachmentBytes += f.Size
	if copied {
		c.AttachmentsCopied++
	}
}

func (c *Census) scripts(artifact string, html []byte) {
	hosts := map[string]bool{}
	for _, m := range externalScript.FindAllSubmatch(html, -1) {
		hosts[strings.ToLower(string(m[2]))] = true
	}
	for h := range hosts {
		c.ExternalHosts[h]++
	}
	if len(hosts) > 0 {
		c.gap("G10", artifact)
	}
}

func (c *Census) storefront(a Artifact) {
	if a.Visibility == "hidden" {
		c.Storefront.Hidden++
	} else {
		c.Storefront.Listed++
	}
	if a.Featured {
		c.Storefront.Featured++
	}
	if a.HasDraft {
		c.Storefront.Drafts++
	}
	if a.DemoEnabled {
		c.Storefront.Demo++
	}
	if a.EarlyAccessUntil != nil && a.EarlyAccessUntil.After(c.TakenAt) {
		c.Storefront.EarlyAccess++
	}
	if len(a.Creators) > 0 {
		c.Storefront.WithCreators++
	}
	c.Storefront.LaunchModes[a.LaunchMode]++
	if len(a.Releases) > 0 {
		c.WithReleases++
	}
}

// Classify names what a release needs from slop: "static" (works as is),
// "static+downloads", "runtime-marker" (boots francois's runtime without
// asking for capabilities) or "needs-runtime:<caps>".
func Classify(manifest json.RawMessage, marker *bool) string {
	var need []string
	downloads := false
	for _, k := range capabilities(manifest) {
		switch {
		case k == "downloads":
			downloads = true
		case runtimeCaps[k]:
			need = append(need, k)
		}
	}
	switch {
	case len(need) > 0:
		return "needs-runtime:" + strings.Join(need, ",")
	case marker != nil && *marker:
		return "runtime-marker"
	case downloads:
		return "static+downloads"
	}
	return "static"
}

func (c *Census) release(a Artifact, r Release, original bool, marker *bool) {
	c.Releases++
	c.ReleaseStates[r.State]++
	if r.FreeSample {
		c.FreeSamples++
	} else if r.State == "published" {
		c.gap("G3", a.ID)
	}
	if r.State != "published" {
		c.gap("G4", a.ID)
	}
	if original {
		c.HTMLOriginal++
		c.HTMLBytes += r.HTML.Size
	} else {
		c.HTMLMissing++
		c.gap("G9", a.ID)
	}
	switch {
	case marker == nil:
		c.MarkerUnknown++
	case *marker:
		c.RuntimeMarker++
	}
	for _, k := range capabilities(r.Manifest) {
		c.Capabilities[k]++
		if runtimeCaps[k] {
			c.gap("G5:"+k, a.ID)
		}
	}
	name := Classify(r.Manifest, marker)
	if strings.HasPrefix(name, "needs-runtime:") {
		c.gap("G5", a.ID)
	}
	b := c.buckets[name]
	if b == nil {
		b = &Bucket{Name: name}
		c.buckets[name] = b
	}
	b.Releases++
	if len(b.Artifacts) == 0 || b.Artifacts[len(b.Artifacts)-1] != a.ID {
		b.Artifacts = append(b.Artifacts, a.ID)
	}
}

func (c *Census) finish() {
	for _, b := range c.buckets {
		c.Buckets = append(c.Buckets, b)
	}
	sort.Slice(c.Buckets, func(i, j int) bool {
		if c.Buckets[i].Releases != c.Buckets[j].Releases {
			return c.Buckets[i].Releases > c.Buckets[j].Releases
		}
		return c.Buckets[i].Name < c.Buckets[j].Name
	})
	for id, arts := range c.blocked {
		title := gapTitles[id]
		if strings.HasPrefix(id, "G5:") {
			title = "Page runtime capability " + strings.TrimPrefix(id, "G5:")
		}
		c.Gaps = append(c.Gaps, Gap{ID: id, Title: title, Releases: c.gapRel[id], Artifacts: len(arts)})
	}
	sort.Slice(c.Gaps, func(i, j int) bool {
		if c.Gaps[i].Releases != c.Gaps[j].Releases {
			return c.Gaps[i].Releases > c.Gaps[j].Releases
		}
		return c.Gaps[i].ID < c.Gaps[j].ID
	})
	sort.Strings(c.Media.Dangling)
}

// Write stores census.json and census.md in dir.
func (c *Census) Write(dir string) error {
	if err := writeJSON(filepath.Join(dir, "census.json"), c); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "census.md"), []byte(c.Markdown()), 0o600)
}

func mb(n int64) string { return fmt.Sprintf("%.1f MB", float64(n)/1e6) }

// Markdown renders the census for people. It names artifacts, never users.
func (c *Census) Markdown() string {
	var b strings.Builder
	p := func(format string, args ...any) { fmt.Fprintf(&b, format, args...) }
	p("# francois → slop census\n\n")
	p("Source: %s, read %s. Imported %s.\n\n", c.Source, c.TakenAt.Format(time.RFC3339), c.Imported.Format(time.RFC3339))
	p("%d catalog artifacts (%d with releases), %d releases (", c.Artifacts, c.WithReleases, c.Releases)
	states := []string{}
	for s, n := range c.ReleaseStates {
		states = append(states, fmt.Sprintf("%d %s", n, s))
	}
	sort.Strings(states)
	p("%s), %d free samples.\n", strings.Join(states, ", "), c.FreeSamples)
	p("Release HTML: %d copied (%s), %d placeholders.\n\n", c.HTMLOriginal, mb(c.HTMLBytes), c.HTMLMissing)

	p("## What the releases need\n\n| bucket | releases | artifacts |\n| --- | ---: | --- |\n")
	for _, bk := range c.Buckets {
		arts := bk.Artifacts
		more := ""
		if len(arts) > 6 {
			arts, more = arts[:6], fmt.Sprintf(" … (+%d)", len(bk.Artifacts)-6)
		}
		p("| %s | %d | %s%s |\n", bk.Name, bk.Releases, strings.Join(arts, ", "), more)
	}
	if c.MarkerUnknown > 0 {
		p("\n%d releases have no HTML here, so whether they boot francois's runtime without declaring capabilities is unknown; they are bucketed by manifest only.\n", c.MarkerUnknown)
	}
	p("\n## Gaps, by how much imported content each blocks\n\n| gap | releases | artifacts | what |\n| --- | ---: | ---: | --- |\n")
	for _, g := range c.Gaps {
		p("| %s | %d | %d | %s |\n", g.ID, g.Releases, g.Artifacts, g.Title)
	}
	p("\n## Manifest capabilities\n\n| capability | releases |\n| --- | ---: |\n")
	caps := make([]string, 0, len(c.Capabilities))
	for k := range c.Capabilities {
		caps = append(caps, k)
	}
	sort.Strings(caps)
	for _, k := range caps {
		p("| %s | %d |\n", k, c.Capabilities[k])
	}
	if len(c.ExternalHosts) > 0 {
		p("\n## Scripts from other hosts\n\n| host | releases |\n| --- | ---: |\n")
		hosts := make([]string, 0, len(c.ExternalHosts))
		for h := range c.ExternalHosts {
			hosts = append(hosts, h)
		}
		sort.Strings(hosts)
		for _, h := range hosts {
			p("| %s | %d |\n", h, c.ExternalHosts[h])
		}
	}
	s := c.Storefront
	p("\n## Storefront fields (now data in %s)\n\n", CatalogID)
	p("- listed %d, hidden %d, featured %d, demo enabled %d, with credited creators %d\n", s.Listed, s.Hidden, s.Featured, s.Demo, s.WithCreators)
	p("- early access still running: %d; unpublished page drafts: %d\n", s.EarlyAccess, s.Drafts)
	modes := []string{}
	for m, n := range s.LaunchModes {
		modes = append(modes, fmt.Sprintf("%s %d", m, n))
	}
	sort.Strings(modes)
	p("- launch modes: %s\n", strings.Join(modes, ", "))
	p("\n## Media, posts, creators\n\n")
	p("- media library: %d files (%s); copied %d (%s) that pages, posts or creators reference", c.Media.Library, mb(c.Media.LibraryBytes), c.Media.Copied, mb(c.Media.CopiedBytes))
	if c.Media.Unavailable > 0 {
		p("; %d unavailable", c.Media.Unavailable)
	}
	p("\n- dangling media references: %d\n", len(c.Media.Dangling))
	p("- attachments: %d (%s), %d copied\n", c.Attachments, mb(c.AttachmentBytes), c.AttachmentsCopied)
	posts := []string{}
	for st, n := range c.Posts {
		posts = append(posts, fmt.Sprintf("%d %s", n, st))
	}
	sort.Strings(posts)
	p("- posts: %s; creators: %d; francois admins: %d\n", strings.Join(append(posts, ""), " "), c.Creators, c.Admins)
	if len(c.Counts) > 0 {
		p("\n## Not imported (row counts)\n\n")
		keys := make([]string, 0, len(c.Counts))
		for k := range c.Counts {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			p("- %s: %d\n", k, c.Counts[k])
		}
	}
	return b.String()
}
