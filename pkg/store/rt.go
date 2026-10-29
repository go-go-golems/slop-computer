package store

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/pkg/errors"
)

// The artifact runtime's storage (migration 007): a contract-shaped
// document store per target artifact, leases, assets, one origin per
// target, approvals of apps' slop permissions, and consents. pkg/rt holds
// the semantics (paths, rules, queries, diffs); this file holds the SQL.

// RTDoc is one stored document. Body is nil for a tombstone.
type RTDoc struct {
	Path      string
	Coll      string
	Body      []byte
	Version   int64
	Rev       int64
	UpdatedBy string
	UpdatedAt time.Time
}

// RTChange is a committed write: Rev 0 means nothing changed (a delete of a
// missing document).
type RTChange struct {
	Target  string
	Path    string
	Body    []byte // nil: deleted
	Prev    []byte // the body before, nil if none
	Version int64
	Rev     int64
	By      string
}

var (
	// ErrRTQuota is a write that would pass the live document cap.
	ErrRTQuota = errors.New("database full")
	// ErrRTMissing is an update of a missing document.
	ErrRTMissing = errors.New("document does not exist")
	// ErrRTBase is a patch whose base is not the stored version.
	ErrRTBase = errors.New("base version moved")
)

const rtDocColumns = `path,coll,body,version,rev,COALESCE(updated_by,''),updated_at`

func scanRTDoc(r scanner) (RTDoc, error) {
	var d RTDoc
	var body sql.NullString
	err := r.Scan(&d.Path, &d.Coll, &body, &d.Version, &d.Rev, &d.UpdatedBy, &d.UpdatedAt)
	if body.Valid {
		d.Body = []byte(body.String)
	}
	return d, err
}

// RTDoc returns one live document; ErrNotFound when missing or deleted.
func (s *Store) RTDoc(ctx context.Context, target, path string) (RTDoc, error) {
	d, err := scanRTDoc(s.db().row(ctx, `SELECT `+rtDocColumns+` FROM rt_docs WHERE target_id=? AND path=? AND body IS NOT NULL`, target, path))
	return d, notFound(err)
}

// RTColl lists the live documents of one collection, by path.
func (s *Store) RTColl(ctx context.Context, target, coll string) ([]RTDoc, error) {
	rows, err := s.db().query(ctx, `SELECT `+rtDocColumns+` FROM rt_docs WHERE target_id=? AND coll=? AND body IS NOT NULL ORDER BY path`, target, coll)
	return scanAll(rows, err, func(r *sql.Rows) (RTDoc, error) { return scanRTDoc(r) })
}

// RTChanges lists documents (tombstones included) changed after rev, in rev
// order, with the target's head rev read first: everything up to the head
// is in the list or superseded by a later row.
func (s *Store) RTChanges(ctx context.Context, target string, after int64) ([]RTDoc, int64, error) {
	head, err := s.RTHead(ctx, target)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.db().query(ctx, `SELECT `+rtDocColumns+` FROM rt_docs WHERE target_id=? AND rev>? ORDER BY rev`, target, after)
	out, err := scanAll(rows, err, func(r *sql.Rows) (RTDoc, error) { return scanRTDoc(r) })
	return out, head, err
}

// RTHead is the target's newest rev (0 before any write).
func (s *Store) RTHead(ctx context.Context, target string) (int64, error) {
	var head int64
	err := s.db().row(ctx, `SELECT rev FROM rt_heads WHERE target_id=?`, target).Scan(&head)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return head, err
}

// RTWrite changes one document. fn sees the current document (nil when
// missing or deleted) and returns the new body (nil deletes). Every write
// takes the target's head row first, then the document's row, so revs are
// contiguous and commit in order (the lock order PR #3 fixed for docs).
func (s *Store) RTWrite(ctx context.Context, target, path, coll, actor string, fn func(cur *RTDoc) ([]byte, error)) (RTChange, error) {
	ch := RTChange{Target: target, Path: path, By: actor}
	err := s.InTx(ctx, func(tx db) error {
		var rev int64
		if err := tx.row(ctx, `INSERT INTO rt_heads(target_id,rev) VALUES(?,1)
ON CONFLICT(target_id) DO UPDATE SET rev=rt_heads.rev+1 RETURNING rev`, target).Scan(&rev); err != nil {
			return err
		}
		var cur *RTDoc
		var version int64
		d, err := scanRTDoc(tx.row(ctx, tx.forUpdate(`SELECT `+rtDocColumns+` FROM rt_docs WHERE target_id=? AND path=?`), target, path))
		switch {
		case err == nil:
			version = d.Version
			if d.Body != nil {
				cur = &d
			}
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		body, err := fn(cur)
		if err != nil {
			return err
		}
		if body == nil && cur == nil {
			return errNoChange // deleting nothing: no rev
		}
		if body != nil && cur == nil {
			var n int
			if err := tx.row(ctx, `SELECT COUNT(*) FROM rt_docs WHERE target_id=? AND body IS NOT NULL`, target).Scan(&n); err != nil {
				return err
			}
			if n >= rtMaxDocs {
				return ErrRTQuota
			}
		}
		if cur != nil {
			ch.Prev = cur.Body
		}
		ch.Body, ch.Version, ch.Rev = body, version+1, rev
		var b any
		if body != nil {
			b = string(body)
		}
		_, err = tx.exec(ctx, `INSERT INTO rt_docs(target_id,path,coll,body,size,version,rev,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(target_id,path) DO UPDATE SET body=excluded.body, size=excluded.size, version=excluded.version, rev=excluded.rev,
updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
			target, path, coll, b, len(body), ch.Version, rev, nullable(actor), s.Now())
		return err
	})
	if errors.Is(err, errNoChange) {
		return RTChange{Target: target, Path: path, By: actor}, nil
	}
	return ch, err
}

var errNoChange = errors.New("no change")

// rtMaxDocs mirrors rt.MaxDocsPerTarget (pkg/rt imports store, not the
// other way round).
const rtMaxDocs = 25000

// RTAcquire takes or renews a lease for holder: granted when the lease is
// free, expired or already holder's. until is the expiry in force either way.
func (s *Store) RTAcquire(ctx context.Context, target, path, holder string, ttl time.Duration) (bool, time.Time, error) {
	var until time.Time
	now := s.Now()
	res, err := s.db().exec(ctx, `INSERT INTO rt_leases(target_id,path,holder,until_at) VALUES(?,?,?,?)
ON CONFLICT(target_id,path) DO UPDATE SET holder=excluded.holder, until_at=excluded.until_at
WHERE rt_leases.until_at<? OR rt_leases.holder=?`, target, path, holder, now.Add(ttl), now, holder)
	if err != nil {
		return false, until, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, until, err
	}
	err = s.db().row(ctx, `SELECT until_at FROM rt_leases WHERE target_id=? AND path=?`, target, path).Scan(&until)
	return n == 1, until, err
}

// RTPrune drops tombstones older than age.
func (s *Store) RTPrune(ctx context.Context, age time.Duration) (int64, error) {
	res, err := s.db().exec(ctx, `DELETE FROM rt_docs WHERE body IS NULL AND updated_at<?`, s.Now().Add(-age))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// RTAsset is one uploaded asset of a target.
type RTAsset struct {
	ID          string    `json:"id"`
	Target      string    `json:"-"`
	SHA256      string    `json:"-"`
	ContentType string    `json:"contentType"`
	Size        int64     `json:"sizeBytes"`
	CreatedBy   string    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

const rtAssetColumns = `id,target_id,sha256,content_type,size,COALESCE(created_by,''),created_at`

func scanRTAsset(r scanner) (RTAsset, error) {
	var a RTAsset
	err := r.Scan(&a.ID, &a.Target, &a.SHA256, &a.ContentType, &a.Size, &a.CreatedBy, &a.CreatedAt)
	return a, err
}

// RTAddAsset records an uploaded blob as an asset of target.
func (s *Store) RTAddAsset(ctx context.Context, a RTAsset) (RTAsset, error) {
	a.ID, a.CreatedAt = NewID("a_"), s.Now()
	_, err := s.db().exec(ctx, `INSERT INTO rt_assets(id,target_id,sha256,content_type,size,created_by,created_at) VALUES(?,?,?,?,?,?,?)`,
		a.ID, a.Target, a.SHA256, a.ContentType, a.Size, nullable(a.CreatedBy), a.CreatedAt)
	return a, err
}

// RTAsset returns one asset of target.
func (s *Store) RTAsset(ctx context.Context, target, id string) (RTAsset, error) {
	a, err := scanRTAsset(s.db().row(ctx, `SELECT `+rtAssetColumns+` FROM rt_assets WHERE target_id=? AND id=?`, target, id))
	return a, notFound(err)
}

// RTAssets lists target's assets, newest first.
func (s *Store) RTAssets(ctx context.Context, target string) ([]RTAsset, error) {
	rows, err := s.db().query(ctx, `SELECT `+rtAssetColumns+` FROM rt_assets WHERE target_id=? ORDER BY created_at DESC, id`, target)
	return scanAll(rows, err, func(r *sql.Rows) (RTAsset, error) { return scanRTAsset(r) })
}

// RTDeleteAsset removes an asset; false when there was none.
func (s *Store) RTDeleteAsset(ctx context.Context, target, id string) (bool, error) {
	res, err := s.db().exec(ctx, `DELETE FROM rt_assets WHERE target_id=? AND id=?`, target, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// RTOrigin returns the sandbox host label of target's origin: "s" and 20 hex
// digits of an HMAC, unguessable without the server key, the same for every
// version so a page's storage and /_blob/ URLs survive new versions.
func (s *Store) RTOrigin(ctx context.Context, target string) (string, error) {
	key, err := s.ServerKey(ctx, "sandbox")
	if err != nil {
		return "", err
	}
	m := hmac.New(sha256.New, key)
	_, _ = fmt.Fprintf(m, "target\x00%s", target)
	label := "s" + hex.EncodeToString(m.Sum(nil))[:20]
	_, err = s.db().exec(ctx, `INSERT INTO rt_origins(label,target_id,created_at) VALUES(?,?,?) ON CONFLICT(label) DO NOTHING`, label, target, s.Now())
	return label, err
}

// RTOriginTarget maps a label back to its target.
func (s *Store) RTOriginTarget(ctx context.Context, label string) (string, error) {
	var target string
	err := s.db().row(ctx, `SELECT target_id FROM rt_origins WHERE label=?`, label).Scan(&target)
	return target, notFound(err)
}

// RTApproval is an admin's approval of an app version's slop permissions.
type RTApproval struct {
	App         string     `json:"app"`
	Version     int        `json:"version"`
	Permissions StringList `json:"permissions"`
	ApprovedBy  string     `json:"approvedBy"`
	ApprovedAt  time.Time  `json:"approvedAt"`
}

// RTApprove records an approval (replacing an earlier one for the version).
func (s *Store) RTApprove(ctx context.Context, app string, version int, perms []string, actor string) (RTApproval, error) {
	a := RTApproval{App: app, Version: version, Permissions: perms, ApprovedBy: actor, ApprovedAt: s.Now()}
	_, err := s.db().exec(ctx, `INSERT INTO rt_approvals(app_id,version,permissions,approved_by,approved_at) VALUES(?,?,?,?,?)
ON CONFLICT(app_id,version) DO UPDATE SET permissions=excluded.permissions, approved_by=excluded.approved_by, approved_at=excluded.approved_at`,
		app, version, a.Permissions, actor, a.ApprovedAt)
	return a, err
}

// RTApprovalOf returns the approval of one app version.
func (s *Store) RTApprovalOf(ctx context.Context, app string, version int) (RTApproval, error) {
	var a RTApproval
	err := s.db().row(ctx, `SELECT app_id,version,permissions,approved_by,approved_at FROM rt_approvals WHERE app_id=? AND version=?`, app, version).
		Scan(&a.App, &a.Version, &a.Permissions, &a.ApprovedBy, &a.ApprovedAt)
	return a, notFound(err)
}

// RTApprovals lists every approval, newest version first per app.
func (s *Store) RTApprovals(ctx context.Context) ([]RTApproval, error) {
	rows, err := s.db().query(ctx, `SELECT app_id,version,permissions,approved_by,approved_at FROM rt_approvals ORDER BY app_id, version DESC`)
	return scanAll(rows, err, func(r *sql.Rows) (RTApproval, error) {
		var a RTApproval
		err := r.Scan(&a.App, &a.Version, &a.Permissions, &a.ApprovedBy, &a.ApprovedAt)
		return a, err
	})
}

// RTConsent returns a person's recorded answer for a capability of an app
// ("" when never asked).
func (s *Store) RTConsent(ctx context.Context, user, app, capability string) (string, error) {
	var st string
	err := s.db().row(ctx, `SELECT state FROM rt_consents WHERE user_id=? AND app_id=? AND capability=?`, user, app, capability).Scan(&st)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return st, err
}

// RTSetConsent records a person's answer.
func (s *Store) RTSetConsent(ctx context.Context, user, app, capability, state string) error {
	_, err := s.db().exec(ctx, `INSERT INTO rt_consents(user_id,app_id,capability,state,at) VALUES(?,?,?,?,?)
ON CONFLICT(user_id,app_id,capability) DO UPDATE SET state=excluded.state, at=excluded.at`, user, app, capability, state, s.Now())
	return err
}
