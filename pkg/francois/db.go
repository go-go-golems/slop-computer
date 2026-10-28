package francois

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" driver
	"github.com/pkg/errors"
)

// DBSource reads a restored copy of francois's database and its blob
// directory (the directory that holds blobs/, /var/lib/francois/releases in
// production). Its session is read-only.
type DBSource struct {
	db    *sql.DB
	blobs string
}

// OpenDB connects to a francois database. blobs may be empty: the snapshot
// still works, file contents are then unavailable.
func OpenDB(ctx context.Context, dsn, blobs string) (*DBSource, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	// One connection, so the read-only setting holds for every query.
	db.SetMaxOpenConns(1)
	if _, err = db.ExecContext(ctx, `SET default_transaction_read_only = on`); err != nil {
		_ = db.Close()
		return nil, errors.Wrap(err, "connect to the francois database")
	}
	return &DBSource{db: db, blobs: blobs}, nil
}

func (s *DBSource) Close() error { return s.db.Close() }

// storageKey is francois's blob key (pkg/catalog/releases keyPattern).
var storageKey = regexp.MustCompile(`^blobs/[0-9a-f]{2}/[0-9a-f]{64}$`)

func (s *DBSource) Open(_ context.Context, f File) (io.ReadCloser, error) {
	if s.blobs == "" || !storageKey.MatchString(f.Ref) {
		return nil, ErrUnavailable
	}
	r, err := os.Open(filepath.Join(s.blobs, filepath.FromSlash(f.Ref))) // #nosec G304 -- key checked against storageKey
	if os.IsNotExist(err) {
		return nil, ErrUnavailable
	}
	return r, err
}

func (s *DBSource) Snapshot(ctx context.Context) (*Snapshot, error) {
	snap := &Snapshot{Source: "database", TakenAt: time.Now().UTC(), Counts: map[string]int64{}}
	var err error
	if snap.Artifacts, err = s.artifacts(ctx); err != nil {
		return nil, errors.Wrap(err, "catalog_artifacts")
	}
	if snap.Posts, err = s.posts(ctx); err != nil {
		return nil, errors.Wrap(err, "posts")
	}
	if snap.Creators, err = s.creators(ctx); err != nil {
		return nil, errors.Wrap(err, "creators")
	}
	if snap.Media, err = s.media(ctx); err != nil {
		return nil, errors.Wrap(err, "catalog_media")
	}
	if snap.Users, err = s.users(ctx); err != nil {
		return nil, errors.Wrap(err, "users")
	}
	for _, t := range countedTables {
		var n int64
		// Table names come from countedTables, not from input.
		if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM `+t).Scan(&n); err == nil { // #nosec G202
			snap.Counts[t] = n
		}
	}
	return snap, nil
}

// countedTables hold state the import leaves out; the census reports them.
var countedTables = []string{"instances", "instance_members", "instance_documents", "instance_assets", "instance_comments",
	"access_grants", "billing_subscriptions", "users", "api_tokens", "model_calls"}

// strs decodes a JSON array produced by array_to_json.
func strs(raw string) []string {
	out := []string{}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func (s *DBSource) artifacts(ctx context.Context) ([]Artifact, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, title, description, coalesce(array_to_json(tags)::text,'[]'), visibility, page::text,
  page_draft IS NOT NULL, featured, sort_order, early_access_until, demo_enabled, launch_mode, created_at, updated_at
FROM catalog_artifacts ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Artifact
	for rows.Next() {
		var a Artifact
		var tags, page string
		if err = rows.Scan(&a.ID, &a.Title, &a.Description, &tags, &a.Visibility, &page, &a.HasDraft, &a.Featured, &a.SortOrder,
			&a.EarlyAccessUntil, &a.DemoEnabled, &a.LaunchMode, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		a.Tags = strs(tags)
		_ = json.Unmarshal([]byte(page), &a.Page)
		out = append(out, a)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	creators, err := s.artifactCreators(ctx)
	if err != nil {
		return nil, err
	}
	releases, err := s.releases(ctx)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Creators = creators[out[i].ID]
		out[i].Releases = releases[out[i].ID]
	}
	return out, nil
}

func (s *DBSource) artifactCreators(ctx context.Context) (map[string][]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT artifact_id, creator_id FROM artifact_creators ORDER BY artifact_id, position, creator_id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string][]string{}
	for rows.Next() {
		var a, c string
		if err = rows.Scan(&a, &c); err != nil {
			return nil, err
		}
		out[a] = append(out[a], c)
	}
	return out, rows.Err()
}

func (s *DBSource) releases(ctx context.Context) (map[string][]Release, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT r.artifact_id, r.id, r.version, r.changelog, r.manifest::text, r.state, r.free_sample, r.created_by,
  r.created_at, r.published_at, r.withdrawn_at, coalesce(f.id,''), coalesce(f.name,''), coalesce(f.media_type,''), coalesce(f.size,0),
  coalesce(f.sha256,''), coalesce(f.storage_key,'')
FROM releases r LEFT JOIN release_files f ON f.release_id = r.id AND f.role = 'html'
ORDER BY r.artifact_id, r.created_at, r.id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string][]Release{}
	type at struct {
		artifact string
		i        int
	}
	index := map[string]at{}
	for rows.Next() {
		var art, manifest string
		var r Release
		f := &r.HTML
		if err = rows.Scan(&art, &r.ID, &r.Version, &r.Changelog, &manifest, &r.State, &r.FreeSample, &r.CreatedBy, &r.CreatedAt,
			&r.PublishedAt, &r.WithdrawnAt, &f.ID, &f.Name, &f.MediaType, &f.Size, &f.SHA256, &f.Ref); err != nil {
			return nil, err
		}
		r.Manifest = json.RawMessage(manifest)
		f.Public = true
		r.Attachments = []File{}
		out[art] = append(out[art], r)
		index[r.ID] = at{art, len(out[art]) - 1}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	att, err := s.db.QueryContext(ctx, `SELECT release_id, id, name, label, media_type, size, sha256, storage_key
FROM release_attachments ORDER BY release_id, position, created_at, id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = att.Close() }()
	for att.Next() {
		var rel string
		f := File{Public: true}
		if err = att.Scan(&rel, &f.ID, &f.Name, &f.Label, &f.MediaType, &f.Size, &f.SHA256, &f.Ref); err != nil {
			return nil, err
		}
		if p, ok := index[rel]; ok {
			out[p.artifact][p.i].Attachments = append(out[p.artifact][p.i].Attachments, f)
		}
	}
	return out, att.Err()
}

func (s *DBSource) posts(ctx context.Context) ([]Post, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, slug, title, summary, body, coalesce(cover_media_id,''), coalesce(author_id,''),
  coalesce(array_to_json(tags)::text,'[]'), state, published_at, created_at, updated_at FROM posts ORDER BY coalesce(published_at, created_at), id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Post
	for rows.Next() {
		var p Post
		var tags string
		if err = rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Summary, &p.Body, &p.Cover, &p.Author, &tags, &p.State, &p.PublishedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Tags = strs(tags)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *DBSource) creators(ctx context.Context) ([]Creator, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, slug, name, bio, coalesce(avatar_media_id,''), links::text, coalesce(user_id,''), sort_order
FROM creators ORDER BY sort_order, slug`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Creator
	for rows.Next() {
		var c Creator
		var links string
		if err = rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Bio, &c.Avatar, &links, &c.UserID, &c.SortOrder); err != nil {
			return nil, err
		}
		c.Links = []Link{}
		_ = json.Unmarshal([]byte(links), &c.Links)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *DBSource) media(ctx context.Context) ([]Media, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, sha256, storage_key, media_type, size, width, height, alt FROM catalog_media ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Media
	for rows.Next() {
		var m Media
		f := File{Public: true}
		if err = rows.Scan(&m.ID, &f.SHA256, &f.Ref, &m.MediaType, &f.Size, &m.Width, &m.Height, &m.Alt); err != nil {
			return nil, err
		}
		f.ID, f.MediaType, f.Name = m.ID, m.MediaType, m.ID+ext(m.MediaType)
		m.File = f
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *DBSource) users(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, issuer, subject, email, email_verified, display_name, role, disabled FROM users
WHERE role = 'admin' OR id IN (SELECT created_by FROM releases) ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []User
	for rows.Next() {
		var u User
		if err = rows.Scan(&u.ID, &u.Issuer, &u.Subject, &u.Email, &u.EmailVerified, &u.Name, &u.Role, &u.Disabled); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
