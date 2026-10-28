// Package francois reads a francois catalog into a Snapshot, from a restored
// copy of its database and blob directory (DBSource) or from its studio API
// (APISource), and turns a snapshot into a slop seed directory plus a
// capability census: which francois features the imported content uses that
// slop cannot serve yet (ticket SLOP-002). It never writes to francois.
package francois

import (
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/pkg/errors"
)

// Snapshot is everything the importer reads from francois.
type Snapshot struct {
	Source    string     `json:"source"`
	TakenAt   time.Time  `json:"takenAt"`
	Artifacts []Artifact `json:"artifacts"`
	Posts     []Post     `json:"posts"`
	Creators  []Creator  `json:"creators"`
	Media     []Media    `json:"media"`
	// Users are the admins and the authors of releases.
	Users []User `json:"users"`
	// Counts are row counts of state the import leaves out (instances,
	// billing); a source that cannot see a table leaves it out.
	Counts map[string]int64 `json:"counts"`
}

type Page struct {
	Body    string   `json:"body"`
	Cover   string   `json:"cover,omitempty"`
	Gallery []string `json:"gallery"`
}

// Artifact is a catalog artifact with its storefront fields and releases.
type Artifact struct {
	ID               string     `json:"id"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Tags             []string   `json:"tags"`
	Visibility       string     `json:"visibility"`
	Page             Page       `json:"page"`
	HasDraft         bool       `json:"hasDraft"`
	Featured         bool       `json:"featured"`
	SortOrder        int        `json:"sortOrder"`
	EarlyAccessUntil *time.Time `json:"earlyAccessUntil,omitempty"`
	DemoEnabled      bool       `json:"demoEnabled"`
	LaunchMode       string     `json:"launchMode"`
	// Creators are creator IDs in credit order.
	Creators  []string  `json:"creators"`
	Releases  []Release `json:"releases"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Release is one release: a single HTML file, its manifest, attachments.
type Release struct {
	ID          string          `json:"id"`
	Version     string          `json:"version"`
	Changelog   string          `json:"changelog"`
	State       string          `json:"state"` // draft, published, withdrawn
	FreeSample  bool            `json:"freeSample"`
	Manifest    json.RawMessage `json:"manifest"`
	CreatedBy   string          `json:"createdBy,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	PublishedAt *time.Time      `json:"publishedAt,omitempty"`
	WithdrawnAt *time.Time      `json:"withdrawnAt,omitempty"`
	HTML        File            `json:"html"`
	Attachments []File          `json:"attachments"`
}

// File names bytes a Source can open. Ref is source-specific: a storage key
// for DBSource, a URL path for APISource.
type File struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Label     string `json:"label,omitempty"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
	Ref       string `json:"-"`
	// Public means the source can fetch it without special access (APISource:
	// free samples and media); DBSource can open every file.
	Public bool `json:"-"`
}

type Post struct {
	ID          string     `json:"id"`
	Slug        string     `json:"slug"`
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	Body        string     `json:"body"`
	Cover       string     `json:"cover,omitempty"`  // media ID
	Author      string     `json:"author,omitempty"` // creator ID
	Tags        []string   `json:"tags"`
	State       string     `json:"state"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type Link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type Creator struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Bio       string `json:"bio"`
	Avatar    string `json:"avatar,omitempty"` // media ID
	Links     []Link `json:"links"`
	UserID    string `json:"userId,omitempty"`
	SortOrder int    `json:"sortOrder"`
}

type Media struct {
	ID        string `json:"id"`
	MediaType string `json:"mediaType"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Alt       string `json:"alt"`
	File      File   `json:"file"`
}

type User struct {
	ID            string `json:"id"`
	Issuer        string `json:"issuer"`
	Subject       string `json:"subject"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	Name          string `json:"name"`
	Role          string `json:"role"`
	Disabled      bool   `json:"disabled"`
}

// Source reads a francois catalog.
type Source interface {
	Snapshot(ctx context.Context) (*Snapshot, error)
	// Open returns a file's bytes, or ErrUnavailable when this source cannot
	// reach them (the studio API does not hand out paid release HTML).
	Open(ctx context.Context, f File) (io.ReadCloser, error)
	Close() error
}

// ErrUnavailable means a file exists in francois but this source cannot read it.
var ErrUnavailable = errors.New("not available from this source")

// User returns the user with this francois ID.
func (s *Snapshot) User(id string) (User, bool) {
	for _, u := range s.Users {
		if u.ID == id {
			return u, true
		}
	}
	return User{}, false
}
