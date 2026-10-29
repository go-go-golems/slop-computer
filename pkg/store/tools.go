package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"slices"
	"time"

	"github.com/pkg/errors"
)

// GrantPrefix marks tool grants: short-lived bearer secrets a tool running
// in the Workshop calls the API with.
const GrantPrefix = "slg_"

// GrantTTL is how long a grant lives; the Workshop renews it while the tool
// is open.
const GrantTTL = time.Hour

// ToolPermissions are the only permissions a tool can ask for, in plain
// words for the Workshop's approval dialog. Users, tokens, the audit log and
// tools themselves are not grantable.
var ToolPermissions = map[string]string{
	"artifacts:read": "see artifacts and projects",
	"versions:read":  "read every version's files and records",
	"versions:push":  "push new versions of any artifact and move main",
	"routes:read":    "see every route and its history",
	"routes:write":   "point, add, remove and undo routes on every host",
	"threads:read":   "read comment threads",
	"threads:write":  "comment, reply and resolve threads",
	"events:read":    "follow live changes",
	"docs:read":      "read live design files (Pinup) and who has them open",
	"docs:write":     "edit live design files (Pinup) and show presence in them",
}

// ToolManifest is the "tool" section of a page version's slop.json.
type ToolManifest struct {
	Title       string   `json:"title"`
	Icon        string   `json:"icon,omitempty"`
	Permissions []string `json:"permissions"`
}

// ToolManifestOf returns a version's tool section, or nil when it has none.
func ToolManifestOf(v Version) (*ToolManifest, error) {
	var m struct {
		Tool *ToolManifest `json:"tool"`
	}
	if len(v.Manifest) == 0 {
		return nil, nil
	}
	if err := json.Unmarshal(v.Manifest, &m); err != nil || m.Tool == nil {
		return nil, nil //nolint:nilerr // a manifest without a readable tool section is not a tool
	}
	return m.Tool, m.Tool.Validate()
}

// Validate checks a tool section: a title and known permissions.
func (m ToolManifest) Validate() error {
	if m.Title == "" {
		return invalidf("a tool needs a title")
	}
	for _, p := range m.Permissions {
		if _, ok := ToolPermissions[p]; !ok {
			return invalidf("unknown tool permission %q", p)
		}
	}
	return nil
}

// Tool is a tool an admin enabled at one version.
type Tool struct {
	Artifact    string     `json:"artifact"`
	Version     int        `json:"version"`
	Permissions StringList `json:"permissions"`
	Title       string     `json:"title"`
	Icon        string     `json:"icon"`
	EnabledBy   string     `json:"enabledBy"`
	EnabledAt   time.Time  `json:"enabledAt"`
}

const toolColumns = `artifact_id,version,permissions,title,icon,enabled_by,enabled_at`

func scanTool(r scanner) (Tool, error) {
	var t Tool
	err := r.Scan(&t.Artifact, &t.Version, &t.Permissions, &t.Title, &t.Icon, &t.EnabledBy, &t.EnabledAt)
	return t, notFound(err)
}

// Tools lists the enabled tools.
func (s *Store) Tools(ctx context.Context) ([]Tool, error) {
	rows, err := s.db().query(ctx, `SELECT `+toolColumns+` FROM tools ORDER BY title`)
	return scanAll(rows, err, func(r *sql.Rows) (Tool, error) { return scanTool(r) })
}

// Tool returns one enabled tool.
func (s *Store) Tool(ctx context.Context, id string) (Tool, error) {
	return scanTool(s.db().row(ctx, `SELECT `+toolColumns+` FROM tools WHERE artifact_id=?`, id))
}

// EnableTool enables (or moves) a tool to version n with exactly the
// permissions that version's manifest asks for. Grants for other versions
// are revoked.
func (s *Store) EnableTool(ctx context.Context, id string, n int, actor string) (Tool, []Event, error) {
	var out Tool
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		a, err := getArtifact(ctx, tx, id)
		if err != nil {
			return err
		}
		v, err := getVersion(ctx, s, tx, id, n)
		if err != nil {
			return err
		}
		m, err := ToolManifestOf(v)
		if err != nil {
			return err
		}
		if a.Kind != KindPage || m == nil {
			return invalidf("%s v%d is not a tool: its slop.json has no \"tool\" section", id, n)
		}
		perms := slices.Clone(m.Permissions)
		slices.Sort(perms)
		perms = slices.Compact(perms)
		if _, err = tx.exec(ctx, `DELETE FROM tools WHERE artifact_id=?`, id); err != nil {
			return err
		}
		if out, err = scanTool(tx.row(ctx, `INSERT INTO tools(`+toolColumns+`) VALUES(?,?,?,?,?,?,?) RETURNING `+toolColumns,
			id, n, StringList(perms), m.Title, m.Icon, actor, now)); err != nil {
			return err
		}
		if _, err = tx.exec(ctx, `DELETE FROM tool_grants WHERE artifact_id=? AND version<>?`, id, n); err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "tool.enable", id, map[string]any{"version": n, "permissions": perms}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvToolEnabled, deref(a.Project), id, actor, out)
		evs = append(evs, ev)
		return err
	})
	return out, evs, err
}

// DisableTool disables a tool and revokes its grants.
func (s *Store) DisableTool(ctx context.Context, id, actor string) ([]Event, error) {
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		a, err := getArtifact(ctx, tx, id)
		if err != nil {
			return err
		}
		res, err := tx.exec(ctx, `DELETE FROM tools WHERE artifact_id=?`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if _, err = tx.exec(ctx, `DELETE FROM tool_grants WHERE artifact_id=?`, id); err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "tool.disable", id, nil); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvToolDisabled, deref(a.Project), id, actor, map[string]any{"artifact": id})
		evs = append(evs, ev)
		return err
	})
	return evs, err
}

// Grant is a tool's short-lived permission to act for one user.
type Grant struct {
	Artifact    string     `json:"artifact"`
	Version     int        `json:"version"`
	UserID      string     `json:"user"`
	Permissions StringList `json:"permissions"`
	ExpiresAt   time.Time  `json:"expiresAt"`
}

// Has reports whether the grant carries permission p.
func (g Grant) Has(p string) bool { return p != "" && slices.Contains(g.Permissions, p) }

// CreateGrant issues a grant for a tool version to user. The caller decides
// which permissions (the enabled tool's, or a tried version's manifest).
func (s *Store) CreateGrant(ctx context.Context, artifact string, n int, user string, perms []string) (string, Grant, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", Grant{}, err
	}
	secret := GrantPrefix + base64.RawURLEncoding.EncodeToString(b)
	now := s.Now()
	g := Grant{Artifact: artifact, Version: n, UserID: user, Permissions: perms, ExpiresAt: now.Add(GrantTTL)}
	_, err := s.db().exec(ctx, `INSERT INTO tool_grants(token_hash,artifact_id,version,user_id,permissions,created_at,expires_at) VALUES(?,?,?,?,?,?,?)`,
		Hash(secret), artifact, n, user, StringList(perms), now, g.ExpiresAt)
	return secret, g, err
}

// ResolveGrant returns a live grant and its user; expired or revoked grants
// are ErrNotFound.
func (s *Store) ResolveGrant(ctx context.Context, secret string) (Grant, User, error) {
	var g Grant
	err := s.db().row(ctx, `SELECT artifact_id,version,user_id,permissions,expires_at FROM tool_grants WHERE token_hash=? AND expires_at>?`,
		Hash(secret), s.Now()).Scan(&g.Artifact, &g.Version, &g.UserID, &g.Permissions, &g.ExpiresAt)
	if err != nil {
		return g, User{}, notFound(err)
	}
	u, err := s.User(ctx, g.UserID)
	return g, u, errors.Wrap(err, "grant user")
}

// RevokeGrants deletes grants of a tool ("" = any) for a user ("" = anyone).
func (s *Store) RevokeGrants(ctx context.Context, artifact, user string) error {
	_, err := s.db().exec(ctx, `DELETE FROM tool_grants WHERE (?='' OR artifact_id=?) AND (?='' OR user_id=?)`, artifact, artifact, user, user)
	return err
}
