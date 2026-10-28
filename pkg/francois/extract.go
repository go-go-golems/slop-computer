package francois

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/seed"
	"github.com/pkg/errors"
)

// The data artifacts an import writes.
const (
	CatalogID  = "francois-catalog"
	JournalID  = "francois-journal"
	CreatorsID = "francois-creators"
	MediaID    = "francois-media"
	ProjectID  = "francois"
)

// Options steer Extract.
type Options struct {
	// AllMedia copies the whole media library, not only what pages, posts
	// and creators reference.
	AllMedia bool
	// Cache is a directory of downloaded files by sha256 (<aa>/<sha256>),
	// so repeated extracts read each file once; empty disables it.
	Cache string
	// MediaShardBytes caps one media data artifact (default 150 MB): slop
	// refuses versions over 200 MB, so a large library is split into
	// francois-media, francois-media-2, …
	MediaShardBytes int64
	// Workers download media in parallel (default 4).
	Workers int
	// Log reports progress; nil is silent.
	Log func(format string, args ...any)
}

// slopID maps a francois artifact ID ([a-z0-9][a-z0-9_-]{0,63}) to a slop
// one ([a-z0-9][a-z0-9-]{0,62}).
func slopID(id string) string {
	s := strings.ReplaceAll(id, "_", "-")
	if len(s) > 63 {
		s = strings.TrimRight(s[:63], "-")
	}
	return s
}

var slopIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// mediaRef matches francois media links in Markdown and page fields,
// relative or absolute (bodies link https://slop.boutique/media/<id>; the
// origin goes too, so imported pages load media from their own host).
var mediaRef = regexp.MustCompile(`(?:https?://[A-Za-z0-9.:-]+)?/media/(med_[0-9a-f]+)(\?[^)\s"'<>]*)?`)

// mediaSrc is where an imported media file is served on slop: its media
// data artifact's main version, so links survive re-imports.
func (x *extractor) mediaSrc(m Media) string {
	return "/_d/" + x.shard[m.ID] + "/main/files/" + m.File.Name
}

// shardMedia assigns the media to copy to media data artifacts of at most
// MediaShardBytes each, in ID order, and returns their IDs.
func (x *extractor) shardMedia() []string {
	limit := x.opts.MediaShardBytes
	if limit <= 0 {
		limit = 150 << 20
	}
	ids := make([]string, 0, len(x.copy))
	for id := range x.copy {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var shards []string
	var size int64
	for _, id := range ids {
		f := x.media[id].File
		if len(shards) == 0 || (size > 0 && size+f.Size > limit) {
			shard := MediaID
			if len(shards) > 0 {
				shard = fmt.Sprintf("%s-%d", MediaID, len(shards)+1)
			}
			shards = append(shards, shard)
			size = 0
		}
		size += f.Size
		x.shard[id] = shards[len(shards)-1]
	}
	return shards
}

func ext(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mediaType, ";")[0])) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "image/avif":
		return ".avif"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	}
	if e, _ := mime.ExtensionsByType(mediaType); len(e) > 0 {
		return e[0]
	}
	return ".bin"
}

type extractor struct {
	ctx    context.Context
	src    Source
	snap   *Snapshot
	out    string
	opts   Options
	census *Census
	media  map[string]Media
	copy   map[string]bool   // media IDs to copy
	shard  map[string]string // media ID → media data artifact
	ids    map[string]string
	logf   func(string, ...any)
}

// Extract writes a seed directory (seed.json, artifacts/…) for snap into
// out, reading file contents from src, and returns the census.
func Extract(ctx context.Context, src Source, snap *Snapshot, out string, opts Options) (*Census, error) {
	if err := os.MkdirAll(out, 0o750); err != nil {
		return nil, err
	}
	if entries, _ := os.ReadDir(out); len(entries) > 0 {
		return nil, errors.Errorf("%s is not empty; extract into a new directory", out)
	}
	x := &extractor{ctx: ctx, src: src, snap: snap, out: out, opts: opts, census: newCensus(snap),
		media: map[string]Media{}, copy: map[string]bool{}, shard: map[string]string{}, ids: map[string]string{}, logf: opts.Log}
	if x.logf == nil {
		x.logf = func(string, ...any) {}
	}
	for _, m := range snap.Media {
		x.media[m.ID] = m
	}
	if err := x.mapIDs(); err != nil {
		return nil, err
	}
	x.selectMedia()
	shards := x.shardMedia()
	for _, sh := range shards {
		for fid, id := range x.ids {
			if id == sh {
				return nil, errors.Errorf("francois artifact %q maps to %q, which the import needs for media", fid, id)
			}
		}
	}
	project := ProjectID
	f := &seed.File{Projects: []client.Project{{ID: ProjectID, Name: "francois import",
		Brief: "Imported from francois (" + snap.Source + ", " + snap.TakenAt.Format("2006-01-02 15:04 MST") + "). " +
			"Pages are releases; " + CatalogID + ", " + JournalID + ", " + CreatorsID + " and " + MediaID + " hold the storefront as data."}}}
	type dataArtifact struct {
		id, title string
		write     func(dir string) (int, error)
	}
	var data []dataArtifact
	for i, sh := range shards {
		title := "francois media"
		if i > 0 {
			title += fmt.Sprintf(" %d", i+1)
		}
		data = append(data, dataArtifact{sh, title, func(dir string) (int, error) { return x.writeMedia(sh, dir) }})
	}
	data = append(data, []dataArtifact{
		{CreatorsID, "francois creators", x.writeCreators},
		{JournalID, "francois journal", x.writeJournal},
		{CatalogID, "francois catalog", x.writeCatalog},
	}...)
	for _, d := range data {
		dir := seed.VersionDir(out, d.id, 1)
		n, err := d.write(dir)
		if err != nil {
			return nil, errors.Wrap(err, d.id)
		}
		if n == 0 {
			continue
		}
		f.Artifacts = append(f.Artifacts, seed.Artifact{ID: d.id, Title: d.title, Kind: "data", Project: &project, Versions: []seed.Version{{
			N: 1, Message: fmt.Sprintf("Import from francois: %d records", n), By: "import", Via: "import",
			Manifest: json.RawMessage(`{"import":{"from":"francois"}}`)}}})
	}
	for _, a := range snap.Artifacts {
		if len(a.Releases) == 0 {
			continue
		}
		art, err := x.writeReleases(a)
		if err != nil {
			return nil, errors.Wrap(err, a.ID)
		}
		f.Artifacts = append(f.Artifacts, art)
	}
	if err := seed.Write(out, f); err != nil {
		return nil, err
	}
	x.census.finish()
	return x.census, x.census.Write(out)
}

func (x *extractor) mapIDs() error {
	seen := map[string]string{CatalogID: "(data)", JournalID: "(data)", CreatorsID: "(data)", MediaID: "(data)"}
	for _, a := range x.snap.Artifacts {
		id := slopID(a.ID)
		if !slopIDPattern.MatchString(id) {
			return errors.Errorf("francois artifact %q has no valid slop ID (%q)", a.ID, id)
		}
		if other, ok := seen[id]; ok {
			return errors.Errorf("francois artifacts %q and %q both map to slop artifact %q", a.ID, other, id)
		}
		seen[id] = a.ID
		x.ids[a.ID] = id
	}
	return nil
}

// selectMedia picks the media to copy: what anything references, or all.
func (x *extractor) selectMedia() {
	mark := func(id string) {
		if _, ok := x.media[id]; ok {
			x.copy[id] = true
		} else if id != "" {
			x.census.danglingMedia(id)
		}
	}
	scan := func(text string) {
		for _, m := range mediaRef.FindAllStringSubmatch(text, -1) {
			mark(m[1])
		}
	}
	for _, a := range x.snap.Artifacts {
		mark(a.Page.Cover)
		for _, g := range a.Page.Gallery {
			mark(g)
		}
		scan(a.Page.Body)
	}
	for _, p := range x.snap.Posts {
		mark(p.Cover)
		scan(p.Body)
	}
	for _, c := range x.snap.Creators {
		mark(c.Avatar)
		scan(c.Bio)
	}
	if x.opts.AllMedia {
		for id := range x.media {
			x.copy[id] = true
		}
	}
}

// rewrite points francois media links at the imported copies.
func (x *extractor) rewrite(text string) string {
	return mediaRef.ReplaceAllStringFunc(text, func(s string) string {
		m := mediaRef.FindStringSubmatch(s)
		if md, ok := x.media[m[1]]; ok && x.copy[m[1]] {
			return x.mediaSrc(md)
		}
		return s
	})
}

// mediaInfo describes a referenced media item in a record.
func (x *extractor) mediaInfo(id string) map[string]any {
	m, ok := x.media[id]
	if !ok || !x.copy[id] {
		return nil
	}
	return map[string]any{"id": m.ID, "src": x.mediaSrc(m), "type": m.MediaType, "width": m.Width, "height": m.Height, "alt": m.Alt}
}

func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(path, append(raw, '\n'))
}

// copyFile copies f from the source (or the cache) to path, checking its
// sha256, with up to three tries. It returns false when the source cannot
// reach the file.
func (x *extractor) copyFile(f File, path string) (bool, error) {
	if !f.Public {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return false, err
	}
	if cached := x.cached(f); cached != "" {
		return true, linkOrCopy(cached, path)
	}
	var err error
	for try := 1; try <= 3; try++ {
		var ok bool
		if ok, err = x.download(f, path); err == nil {
			if ok {
				x.remember(f, path)
			}
			return ok, nil
		}
		_ = os.Remove(path)
		if x.ctx.Err() != nil {
			break
		}
		x.logf("%s: try %d: %v\n", f.Name, try, err)
	}
	return false, err
}

func (x *extractor) download(f File, path string) (bool, error) {
	r, err := x.src.Open(x.ctx, f)
	if errors.Is(err, ErrUnavailable) {
		return false, nil
	}
	if err != nil {
		return false, errors.Wrap(err, f.Name)
	}
	defer func() { _ = r.Close() }()
	w, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600) // #nosec G304 -- path inside the output directory
	if err != nil {
		return false, err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(w, h), r)
	if cerr := w.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return false, errors.Wrap(err, f.Name)
	}
	if got := hex.EncodeToString(h.Sum(nil)); f.SHA256 != "" && got != f.SHA256 {
		return false, errors.Errorf("%s: sha256 %s, francois says %s", f.Name, got, f.SHA256)
	}
	return true, nil
}

var sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (x *extractor) cachePath(f File) string {
	if x.opts.Cache == "" || !sha256Hex.MatchString(f.SHA256) {
		return ""
	}
	return filepath.Join(x.opts.Cache, f.SHA256[:2], f.SHA256)
}

func (x *extractor) cached(f File) string {
	p := x.cachePath(f)
	if p == "" {
		return ""
	}
	if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
		return p
	}
	return ""
}

func (x *extractor) remember(f File, path string) {
	if p := x.cachePath(f); p != "" && os.MkdirAll(filepath.Dir(p), 0o750) == nil {
		_ = linkOrCopy(path, p)
	}
}

// linkOrCopy hard-links src to dst, copying when they are on different
// file systems.
func linkOrCopy(src, dst string) error {
	if err := os.Link(src, dst); err == nil || os.IsExist(err) {
		return nil
	}
	in, err := os.Open(src) // #nosec G304 -- cache or output file
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600) // #nosec G304 -- cache or output file
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return err
}

func (x *extractor) writeMedia(shard, dir string) (int, error) {
	ids := make([]string, 0, len(x.copy))
	for id := range x.copy {
		if x.shard[id] == shard {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	workers := x.opts.Workers
	if workers <= 0 {
		workers = 4
	}
	type result struct {
		ok  bool
		err error
	}
	results := make([]result, len(ids))
	jobs := make(chan int)
	var wg sync.WaitGroup
	var done atomic.Int64
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				m := x.media[ids[i]]
				ok, err := x.copyFile(m.File, filepath.Join(dir, "files", m.File.Name))
				results[i] = result{ok, err}
				if n := done.Add(1); n%25 == 0 {
					x.logf("media: %d/%d\n", n, len(ids))
				}
			}
		}()
	}
	for i := range ids {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	index := map[string]any{}
	n := 0
	for i, id := range ids {
		if results[i].err != nil {
			return 0, results[i].err
		}
		m := x.media[id]
		x.census.media(m, results[i].ok)
		if !results[i].ok {
			delete(x.copy, id)
			continue
		}
		index[id] = map[string]any{"file": "files/" + m.File.Name, "type": m.MediaType, "width": m.Width, "height": m.Height, "alt": m.Alt}
		n++
	}
	if n == 0 {
		return 0, nil
	}
	x.logf("%s: %d files\n", shard, n)
	return n, writeJSON(filepath.Join(dir, "index.json"), index)
}

func (x *extractor) creatorSlug(id string) string {
	for _, c := range x.snap.Creators {
		if c.ID == id {
			return c.Slug
		}
	}
	return id
}

func (x *extractor) writeCreators(dir string) (int, error) {
	for _, c := range x.snap.Creators {
		rec := map[string]any{"name": c.Name, "bio": x.rewrite(c.Bio), "links": c.Links, "sortOrder": c.SortOrder, "francoisId": c.ID}
		if av := x.mediaInfo(c.Avatar); av != nil {
			rec["avatar"] = av
		}
		if err := writeJSON(filepath.Join(dir, c.Slug+".json"), rec); err != nil {
			return 0, err
		}
	}
	return len(x.snap.Creators), nil
}

// fmValue makes a front matter value that records.FrontMatter reads back:
// one line, no brackets at the ends.
func fmValue(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	return strings.Trim(s, "[]")
}

func (x *extractor) writeJournal(dir string) (int, error) {
	for _, p := range x.snap.Posts {
		var b strings.Builder
		b.WriteString("---\n")
		fmt.Fprintf(&b, "title: %s\n", fmValue(p.Title))
		date := p.CreatedAt
		if p.PublishedAt != nil {
			date = *p.PublishedAt
		}
		fmt.Fprintf(&b, "date: %s\n", date.Format("2006-01-02"))
		tags := make([]string, len(p.Tags))
		for i, t := range p.Tags {
			tags[i] = strings.NewReplacer(",", " ", "[", "", "]", "").Replace(t)
		}
		fmt.Fprintf(&b, "tags: [%s]\n", strings.Join(tags, ", "))
		if p.Author != "" {
			fmt.Fprintf(&b, "author: %s\n", fmValue(x.creatorSlug(p.Author)))
		}
		fmt.Fprintf(&b, "summary: %s\n", fmValue(p.Summary))
		if cv := x.mediaInfo(p.Cover); cv != nil {
			fmt.Fprintf(&b, "cover: %s\n", cv["src"])
		}
		fmt.Fprintf(&b, "state: %s\n", p.State)
		fmt.Fprintf(&b, "francoisId: %s\n", p.ID)
		b.WriteString("---\n")
		b.WriteString(x.rewrite(p.Body))
		if err := writeFile(filepath.Join(dir, p.Slug+".md"), []byte(b.String())); err != nil {
			return 0, err
		}
	}
	return len(x.snap.Posts), nil
}

func (x *extractor) writeCatalog(dir string) (int, error) {
	for _, a := range x.snap.Artifacts {
		creators := []string{}
		for _, c := range a.Creators {
			creators = append(creators, x.creatorSlug(c))
		}
		gallery := []any{}
		for _, g := range a.Page.Gallery {
			if m := x.mediaInfo(g); m != nil {
				gallery = append(gallery, m)
			}
		}
		releases := []any{}
		latest := ""
		for i, r := range a.Releases {
			releases = append(releases, map[string]any{"version": r.Version, "n": i + 1, "state": r.State, "freeSample": r.FreeSample,
				"capabilities": capabilities(r.Manifest), "publishedAt": r.PublishedAt, "changelog": r.Changelog})
			if r.State == "published" {
				latest = r.Version
			}
		}
		rec := map[string]any{
			"title": a.Title, "description": a.Description, "tags": a.Tags, "visibility": a.Visibility,
			"featured": a.Featured, "sortOrder": a.SortOrder, "earlyAccessUntil": a.EarlyAccessUntil, "demoEnabled": a.DemoEnabled,
			"launchMode": a.LaunchMode, "creators": creators, "body": x.rewrite(a.Page.Body), "gallery": gallery,
			"releases": releases, "latest": latest, "francoisId": a.ID, "createdAt": a.CreatedAt, "updatedAt": a.UpdatedAt,
		}
		if len(a.Releases) > 0 {
			rec["page"] = x.ids[a.ID]
		}
		if cv := x.mediaInfo(a.Page.Cover); cv != nil {
			rec["cover"] = cv
		}
		if err := writeJSON(filepath.Join(dir, x.ids[a.ID]+".json"), rec); err != nil {
			return 0, err
		}
		x.census.storefront(a)
	}
	return len(x.snap.Artifacts), nil
}

// capabilities lists a release manifest's top-level keys.
func capabilities(manifest json.RawMessage) []string {
	var m map[string]json.RawMessage
	_ = json.Unmarshal(manifest, &m)
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (x *extractor) writeReleases(a Artifact) (seed.Artifact, error) {
	id := x.ids[a.ID]
	project := ProjectID
	art := seed.Artifact{ID: id, Title: a.Title, Kind: "page", Project: &project}
	for i, r := range a.Releases {
		n := i + 1
		dir := seed.VersionDir(x.out, id, n)
		htmlPath := filepath.Join(dir, "index.html")
		original, err := x.copyFile(r.HTML, htmlPath)
		if err != nil {
			return art, err
		}
		if !original {
			if err = writeFile(htmlPath, placeholder(a, r)); err != nil {
				return art, err
			}
		}
		var marker *bool
		if original {
			b, err := os.ReadFile(htmlPath) // #nosec G304 -- written above
			if err != nil {
				return art, err
			}
			m := bootstrapMarker.Match(b)
			marker = &m
			x.census.scripts(a.ID, b)
		}
		manifest := bytes.TrimSpace(r.Manifest)
		if len(manifest) == 0 {
			manifest = []byte("{}")
		}
		if err = writeFile(filepath.Join(dir, "francois.manifest.json"), append(append([]byte{}, manifest...), '\n')); err != nil {
			return art, err
		}
		for _, att := range r.Attachments {
			ok, err := x.copyFile(att, filepath.Join(dir, "attachments", safeName(att.Name)))
			if err != nil {
				return art, err
			}
			x.census.attachment(att, ok)
		}
		x.census.release(a, r, original, marker)
		imp := map[string]any{"from": "francois", "key": "francois:release:" + r.ID, "artifact": a.ID, "release": r.ID,
			"version": r.Version, "state": r.State, "freeSample": r.FreeSample, "capabilities": capabilities(r.Manifest),
			"html": map[bool]string{true: "original", false: "placeholder"}[original]}
		raw, _ := json.Marshal(map[string]any{"import": imp})
		msg := r.Version
		if line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(r.Changelog), "\n", 2)[0]); line != "" {
			msg += ": " + line
		}
		if r.State != "published" {
			msg += " (" + r.State + " on francois)"
		}
		if !original {
			msg += " [placeholder: HTML not available from " + x.snap.Source + "]"
		}
		v := seed.Version{N: n, Message: msg, By: "import", Via: "import", Manifest: raw, Key: "francois:release:" + r.ID}
		if r.State != "published" {
			no := false
			v.Main = &no
		}
		if u, ok := x.snap.User(r.CreatedBy); ok {
			v.Author = &seed.Identity{Issuer: u.Issuer, Subject: u.Subject, Name: u.Name}
		}
		art.Versions = append(art.Versions, v)
	}
	x.logf("%s: %d releases\n", id, len(a.Releases))
	return art, nil
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]`)

func safeName(s string) string {
	s = unsafeName.ReplaceAllString(s, "_")
	if s == "" || s[0] == '.' {
		s = "_" + s
	}
	return s
}

// placeholder stands in for release HTML the source could not read.
func placeholder(a Artifact, r Release) []byte {
	e := html.EscapeString
	caps := strings.Join(capabilities(r.Manifest), ", ")
	if caps == "" {
		caps = "none"
	}
	return []byte(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>` + e(a.Title) + ` ` + e(r.Version) + `</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
code{background:#f1efe9;padding:0 .25em}.muted{color:#6b6b6b}</style></head>
<body><h1>` + e(a.Title) + ` <span class="muted">` + e(r.Version) + `</span></h1>
<p>` + e(a.Description) + `</p>
<p class="muted">Imported from francois release <code>` + e(r.ID) + `</code> (` + e(r.State) + `). Its HTML
(` + fmt.Sprint(r.HTML.Size) + ` bytes, sha256 <code>` + e(shortSum(r.HTML.SHA256)) + `</code>) was not available to the importer:
francois hands out paid releases only to signed-in browsers. Capabilities: ` + e(caps) + `.</p>
</body></html>
`)
}

func shortSum(s string) string {
	if len(s) > 12 {
		return s[:12]
	}
	return s
}
