package francois_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/francois"
	"github.com/go-go-golems/slop-computer/pkg/seed"
	"github.com/go-go-golems/slop-computer/pkg/server"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
)

// fixture is a francois database (testdata/schema.sql) with a blob directory.
type fixture struct {
	t     *testing.T
	db    *sql.DB
	dsn   string
	blobs string
}

func newFixture(t *testing.T) *fixture {
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL is not set (make test-postgres)")
	}
	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatal(err)
	}
	name := "francois_fixture_" + store.RandomHex(6)
	if _, err = admin.Exec(`CREATE DATABASE ` + name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(`DROP DATABASE IF EXISTS ` + name + ` WITH (FORCE)`)
		_ = admin.Close()
	})
	u, _ := url.Parse(base)
	u.Path = "/" + name
	db, err := sql.Open("pgx", u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	schema, err := os.ReadFile("testdata/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	return &fixture{t: t, db: db, dsn: u.String(), blobs: t.TempDir()}
}

func (f *fixture) exec(q string, args ...any) {
	f.t.Helper()
	if _, err := f.db.Exec(q, args...); err != nil {
		f.t.Fatalf("%s: %v", q, err)
	}
}

// blob stores content the way francois does and returns sha256 and key.
func (f *fixture) blob(content string) (string, string) {
	h := sha256.Sum256([]byte(content))
	sum := hex.EncodeToString(h[:])
	key := "blobs/" + sum[:2] + "/" + sum
	p := filepath.Join(f.blobs, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		f.t.Fatal(err)
	}
	return sum, key
}

func (f *fixture) release(id, artifact, version, state, manifest, html, by string, free bool, at string) {
	f.exec(`INSERT INTO releases(id,artifact_id,version,changelog,manifest,state,free_sample,created_by,created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, artifact, version, "Changes in "+version+"\nmore", manifest, state, free, by, at)
	sum, key := f.blob(html)
	f.exec(`INSERT INTO release_files VALUES($1,$2,'html',$3,'text/html',$4,$5,$6)`, "fil_"+id, id, artifact+".html", len(html), sum, key)
}

const issuer = "https://zitadel.example"

func seedFixture(f *fixture) {
	f.exec(`INSERT INTO users(id,issuer,subject,email,display_name,role) VALUES
 ('usr_m',$1,'1001','m@example.com','Manuel','admin'),
 ('usr_r',$1,'1002','r@example.com','Ramon','admin'),
 ('usr_s',$1,'1003','s@example.com','Sub','subscriber')`, issuer)
	pngSum, pngKey := f.blob("\x89PNG cover")
	f.exec(`INSERT INTO catalog_media(id,sha256,storage_key,media_type,size,width,height,alt,uploaded_by) VALUES
 ('med_aa',$1,$2,'image/png',10,640,480,'a lens','usr_m')`, pngSum, pngKey)
	unSum, unKey := f.blob("unreferenced")
	f.exec(`INSERT INTO catalog_media(id,sha256,storage_key,media_type,size,uploaded_by) VALUES ('med_bb',$1,$2,'image/webp',12,'usr_m')`, unSum, unKey)
	f.exec(`INSERT INTO creators(id,slug,name,bio,avatar_media_id,links,user_id) VALUES ('cr_1','manuel','Manuel','Makes things','med_aa','[{"label":"web","url":"https://x"}]','usr_m')`)
	f.exec(`INSERT INTO catalog_artifacts(id,title,description,tags,page,page_draft,featured,early_access_until,launch_mode) VALUES
 ('weft_lab','Weft','Glyph shaders','{shaders,type}','{"body":"See ![x](/media/med_aa?w=640) and /media/med_ff","cover":"med_aa","gallery":["med_aa"]}','{"body":"draft"}',true,'2999-01-01','inline'),
 ('polis','Polis','A city','{}','{"body":"plain","gallery":[]}',NULL,false,NULL,'tab'),
 ('soon','Soon','No release yet','{}','{}',NULL,false,NULL,'tab')`)
	f.exec(`INSERT INTO artifact_creators VALUES ('weft_lab','cr_1',0)`)
	f.release("rel_w1", "weft_lab", "1.0.0", "published", `{"sample":{},"db":{}}`, `<div id="francois-view"></div><script src="https://cdn.example/x.js"></script>`, "usr_r", true, "2026-10-01T00:00:00Z")
	f.release("rel_w2", "weft_lab", "1.1.0", "withdrawn", `{"sample":{}}`, "<p>withdrawn", "usr_r", false, "2026-10-02T00:00:00Z")
	f.release("rel_p1", "polis", "0.1.0", "published", `{"sample":{},"downloads":true}`, "<p>polis", "usr_s", false, "2026-10-03T00:00:00Z")
	f.release("rel_p2", "polis", "0.2.0", "draft", `{}`, "<p>polis draft", "usr_m", false, "2026-10-04T00:00:00Z")
	attSum, attKey := f.blob("manual")
	f.exec(`INSERT INTO release_attachments(id,release_id,name,label,media_type,size,sha256,storage_key,created_by) VALUES
 ('att_1','rel_p1','../Manual v1.pdf','Manual','application/pdf',6,$1,$2,'usr_m')`, attSum, attKey)
	f.exec(`INSERT INTO posts(id,slug,title,summary,body,cover_media_id,author_id,tags,state,published_at,created_by) VALUES
 ('pst_1','hello','Hello: world','Two
lines','Body with /media/med_aa','med_aa','cr_1','{news,"a,b"}','published','2026-10-05T00:00:00Z','usr_m')`)
	f.exec(`INSERT INTO instances VALUES ('ins_1','workspace'),('ins_2','preview')`)
}

func readJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestImportFromDatabase(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	seedFixture(f)
	src, err := francois.OpenDB(ctx, f.dsn, f.blobs)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = src.Close() }()
	// The session is read-only.
	if _, err := francoisExec(src, ctx); err == nil {
		t.Fatal("the francois session accepted a write")
	}
	snap, err := src.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Artifacts) != 3 || len(snap.Users) != 3 || snap.Counts["instances"] != 2 {
		t.Fatalf("snapshot: %d artifacts, %d users, counts %v", len(snap.Artifacts), len(snap.Users), snap.Counts)
	}
	out := filepath.Join(t.TempDir(), "out")
	census, err := francois.Extract(ctx, src, snap, out, francois.Options{})
	if err != nil {
		t.Fatal(err)
	}

	// Releases became versions; data artifacts hold the storefront.
	sf, err := seed.Load(out)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]seed.Artifact{}
	for _, a := range sf.Artifacts {
		ids[a.ID] = a
	}
	for _, id := range []string{"weft-lab", "polis", francois.CatalogID, francois.JournalID, francois.CreatorsID, francois.MediaID} {
		if _, ok := ids[id]; !ok {
			t.Fatalf("seed has no %s: %v", id, ids)
		}
	}
	if _, ok := ids["soon"]; ok {
		t.Fatal("an artifact without releases became a page")
	}
	weft := ids["weft-lab"]
	if len(weft.Versions) != 2 || weft.Versions[1].Main == nil || *weft.Versions[1].Main || weft.Versions[0].Author == nil || weft.Versions[0].Author.Subject != "1002" {
		t.Fatalf("weft versions %+v", weft.Versions)
	}
	if !strings.HasPrefix(weft.Versions[0].Message, "1.0.0: Changes in 1.0.0") {
		t.Fatalf("message %q", weft.Versions[0].Message)
	}
	html, _ := os.ReadFile(filepath.Join(seed.VersionDir(out, "weft-lab", 1), "index.html"))
	if !strings.Contains(string(html), "francois-view") {
		t.Fatalf("release HTML not copied: %s", html)
	}
	if _, err := os.Stat(filepath.Join(seed.VersionDir(out, "polis", 1), "attachments", "_.._Manual_v1.pdf")); err != nil {
		t.Fatalf("attachment: %v", err)
	}
	// Only referenced media is copied; links point at the copy.
	if _, err := os.Stat(filepath.Join(seed.VersionDir(out, francois.MediaID, 1), "files", "med_aa.png")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(seed.VersionDir(out, francois.MediaID, 1), "files", "med_bb.webp")); err == nil {
		t.Fatal("unreferenced media copied")
	}
	var cat map[string]any
	readJSON(t, filepath.Join(seed.VersionDir(out, francois.CatalogID, 1), "weft-lab.json"), &cat)
	if body := cat["body"].(string); !strings.Contains(body, "/_d/francois-media/main/files/med_aa.png)") || !strings.Contains(body, "/media/med_ff") {
		t.Fatalf("catalog body %q", body)
	}
	if cat["page"] != "weft-lab" || cat["latest"] != "1.0.0" || cat["cover"].(map[string]any)["alt"] != "a lens" {
		t.Fatalf("catalog record %v", cat)
	}
	post, _ := os.ReadFile(filepath.Join(seed.VersionDir(out, francois.JournalID, 1), "hello.md"))
	for _, want := range []string{"title: Hello: world\n", "summary: Two lines\n", "tags: [news, a b]\n", "author: manuel\n", "cover: /_d/francois-media/main/files/med_aa.png\n"} {
		if !strings.Contains(string(post), want) {
			t.Fatalf("post lacks %q:\n%s", want, post)
		}
	}

	// The census buckets releases by what they need.
	buckets := map[string]int{}
	for _, b := range census.Buckets {
		buckets[b.Name] = b.Releases
	}
	if buckets["needs-runtime:db"] != 1 || buckets["static+downloads"] != 1 || buckets["static"] != 2 {
		t.Fatalf("buckets %v", buckets)
	}
	if census.RuntimeMarker != 1 || census.ExternalHosts["cdn.example"] != 1 || len(census.Media.Dangling) != 1 || census.Storefront.EarlyAccess != 1 {
		t.Fatalf("census %+v", census)
	}
	md, _ := os.ReadFile(filepath.Join(out, "census.md"))
	if strings.Contains(string(md), "@example.com") {
		t.Fatal("census names users")
	}

	// Push into slop, twice.
	api, st := slopServer(t)
	if _, act, err := st.ImportAdmin(ctx, store.Identity{Issuer: issuer, Subject: "1002", Name: "Ramon"}); err != nil || act != "created" {
		t.Fatalf("import admin: %s %v", act, err)
	}
	res, err := seed.Push(ctx, out, sf, seed.Options{Admin: api})
	if err != nil {
		t.Fatal(err)
	}
	if res.Versions != 8 { // 4 data + 2 weft + 2 polis
		t.Fatalf("first push %+v", res)
	}
	a, err := api.Artifact(ctx, "weft-lab")
	if err != nil || a.Main != 1 || a.Latest != 2 {
		t.Fatalf("weft-lab main %d latest %d %v", a.Main, a.Latest, err)
	}
	v1, _ := api.Version(ctx, "weft-lab", 1)
	ramon, _ := st.UserByIdentity(ctx, issuer, "1002")
	if v1.By != ramon.ID || v1.Via != "import" {
		t.Fatalf("v1 by %s via %s, want %s import", v1.By, v1.Via, ramon.ID)
	}
	p, _ := api.Artifact(ctx, "polis")
	if p.Main != 1 || p.Latest != 2 {
		t.Fatalf("polis main %d latest %d (the draft must not be main)", p.Main, p.Latest)
	}
	again, err := seed.Push(ctx, out, sf, seed.Options{Admin: api})
	if err != nil || again.Versions != 0 || again.Skipped != 4 || again.Unchanged != 4 {
		t.Fatalf("second push %+v %v", again, err)
	}
}

func francoisExec(src *francois.DBSource, ctx context.Context) (any, error) {
	return src.Exec(ctx, `CREATE TABLE x (y int)`)
}

// slopServer runs a local-mode slop and returns an admin-scoped client.
func slopServer(t *testing.T) (*client.Client, *store.Store) {
	t.Helper()
	st := storetest.Open(t)
	ts := httptest.NewUnstartedServer(nil)
	ts.Start()
	t.Cleanup(ts.Close)
	u, _ := url.Parse(ts.URL)
	cfg := server.Config{PublicURL: u, Local: &server.LocalConfig{Role: store.RoleAdmin}, SiteHosts: []string{"site.test"}, SandboxDomain: "sandbox.test"}
	if err := cfg.Validate(u.Host); err != nil {
		t.Fatal(err)
	}
	bl, err := blobs.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = server.New(cfg, st, bl).Handler()
	tok, err := client.New(ts.URL, "").LocalToken(context.Background(), "manuel", "import", []string{"read", "write", "admin"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	return client.New(ts.URL, tok.Token), st
}
