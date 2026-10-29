package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"time"

	"github.com/pkg/errors"
)

// DocTypes are the types of data artifact that keep live documents. The
// docs store is a tool's working copy, not a second way to publish pages,
// so it is limited to types a tool owns.
var DocTypes = map[string]bool{"pinup": true}

// Limits of the docs store.
const (
	MaxDocBytes         = 256 << 10 // one document
	MaxDocs             = 20000     // live documents of one artifact
	MaxDocArtifactBytes = 64 << 20  // all live documents of one artifact
	MaxLeaseTTL         = time.Minute
	TombstoneTTL        = 7 * 24 * time.Hour
)

var (
	// ErrDocTooLarge is a document over MaxDocBytes.
	ErrDocTooLarge = errors.New("document too large")
	// ErrDocQuota is a write that would pass MaxDocs or MaxDocArtifactBytes.
	ErrDocQuota = errors.New("live document quota exceeded")
)

// Doc is one live document. Data is nil for a tombstone (a deleted
// document, kept so that clients that were away learn of the delete).
type Doc struct {
	Path string    `json:"path"`
	Data JSON      `json:"data"`
	Rev  int64     `json:"rev"`
	By   *string   `json:"by,omitempty"`
	At   time.Time `json:"at"`
}

// A document path is collection/id: "meta/file", "nodes/k9TzQ".
var docPath = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_.:-]{1,128}$`)

// ValidDocPath reports whether p is a collection/id document path.
func ValidDocPath(p string) bool { return docPath.MatchString(p) }

// docArtifact checks that id is a data artifact whose type keeps live
// documents.
func docArtifact(ctx context.Context, d db, id string) error {
	a, err := getArtifact(ctx, d, id)
	if err != nil {
		return err
	}
	if a.Kind != KindData || !DocTypes[a.Type] {
		return invalidf("%s keeps no live documents: only data artifacts of type pinup do", id)
	}
	return nil
}

// nextRev takes the artifact's next document revision. The upsert locks the
// head row, so writers of one artifact are serialized from here to commit.
func nextRev(ctx context.Context, d db, artifact string) (int64, error) {
	var rev int64
	err := d.row(ctx, `INSERT INTO doc_heads(artifact_id,rev) VALUES(?,1)
ON CONFLICT(artifact_id) DO UPDATE SET rev=doc_heads.rev+1 RETURNING rev`, artifact).Scan(&rev)
	return rev, err
}

// PutDoc creates or replaces a document with a JSON object.
func (s *Store) PutDoc(ctx context.Context, artifact, path string, data JSON, actor string) (Doc, error) {
	if !ValidDocPath(path) {
		return Doc{}, invalidf("a document path is collection/id, such as nodes/k9TzQ")
	}
	if len(data) > MaxDocBytes {
		return Doc{}, ErrDocTooLarge
	}
	if t := bytes.TrimSpace(data); len(t) == 0 || t[0] != '{' || !json.Valid(t) {
		return Doc{}, invalidf("a document is a JSON object")
	}
	out := Doc{Path: path, Data: data, At: s.Now()}
	if actor != "" {
		out.By = &actor
	}
	err := s.InTx(ctx, func(tx db) error {
		if err := docArtifact(ctx, tx, artifact); err != nil {
			return err
		}
		rev, err := nextRev(ctx, tx, artifact)
		if err != nil {
			return err
		}
		var n, size int64
		if err = tx.row(ctx, `SELECT COUNT(*), COALESCE(SUM(size),0) FROM docs WHERE artifact_id=? AND data IS NOT NULL AND path<>?`,
			artifact, path).Scan(&n, &size); err != nil {
			return err
		}
		if n+1 > MaxDocs || size+int64(len(data)) > MaxDocArtifactBytes {
			return ErrDocQuota
		}
		out.Rev = rev
		_, err = tx.exec(ctx, `INSERT INTO docs(artifact_id,path,data,size,rev,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
ON CONFLICT(artifact_id,path) DO UPDATE SET data=excluded.data, size=excluded.size, rev=excluded.rev,
updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
			artifact, path, string(data), len(data), rev, nullable(actor), out.At)
		return err
	})
	return out, err
}

// DeleteDoc replaces a live document with a tombstone.
func (s *Store) DeleteDoc(ctx context.Context, artifact, path, actor string) (Doc, error) {
	out := Doc{Path: path, At: s.Now()}
	if actor != "" {
		out.By = &actor
	}
	err := s.InTx(ctx, func(tx db) error {
		if err := docArtifact(ctx, tx, artifact); err != nil {
			return err
		}
		var one int
		if err := tx.row(ctx, tx.forUpdate(`SELECT 1 FROM docs WHERE artifact_id=? AND path=? AND data IS NOT NULL`), artifact, path).Scan(&one); err != nil {
			return notFound(err)
		}
		rev, err := nextRev(ctx, tx, artifact)
		if err != nil {
			return err
		}
		out.Rev = rev
		_, err = tx.exec(ctx, `UPDATE docs SET data=NULL, size=0, rev=?, updated_by=?, updated_at=?, lease_holder=NULL, lease_until=NULL
WHERE artifact_id=? AND path=?`, rev, nullable(actor), out.At, artifact, path)
		return err
	})
	return out, err
}

func scanDoc(r scanner) (Doc, error) {
	var d Doc
	var data sql.NullString
	err := r.Scan(&d.Path, &data, &d.Rev, &d.By, &d.At)
	if data.Valid {
		d.Data = JSON(data.String)
	}
	return d, err
}

const docColumns = `path,data,rev,updated_by,updated_at`

// GetDoc returns one live document.
func (s *Store) GetDoc(ctx context.Context, artifact, path string) (Doc, error) {
	if err := docArtifact(ctx, s.db(), artifact); err != nil {
		return Doc{}, err
	}
	d, err := scanDoc(s.db().row(ctx, `SELECT `+docColumns+` FROM docs WHERE artifact_id=? AND path=? AND data IS NOT NULL`, artifact, path))
	return d, notFound(err)
}

// Docs lists an artifact's documents under prefix ("" for all) changed
// after rev, in rev order, with the artifact's newest rev. After 0 lists
// the live documents; after a rev also lists tombstones, so a client can
// catch up on deletes.
func (s *Store) Docs(ctx context.Context, artifact, prefix string, after int64) ([]Doc, int64, error) {
	d := s.db()
	if err := docArtifact(ctx, d, artifact); err != nil {
		return nil, 0, err
	}
	var head int64
	if err := d.row(ctx, `SELECT rev FROM doc_heads WHERE artifact_id=?`, artifact).Scan(&head); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, 0, err
	}
	rows, err := d.query(ctx, `SELECT `+docColumns+` FROM docs WHERE artifact_id=? AND (?='' OR substr(path,1,?)=?) AND rev>?
AND (?>0 OR data IS NOT NULL) ORDER BY rev`, artifact, prefix, len(prefix), prefix, after, after)
	out, err := scanAll(rows, err, func(r *sql.Rows) (Doc, error) { return scanDoc(r) })
	return out, head, err
}

// AcquireDoc takes or renews a lease on a live document for holder, and
// reports whether holder now has it. A lease lets one of several clients
// claim a document (Pinup: the tab that applies an inbox step).
func (s *Store) AcquireDoc(ctx context.Context, artifact, path, holder string, ttl time.Duration) (bool, error) {
	if holder == "" || len(holder) > 128 {
		return false, invalidf("a lease needs a holder of at most 128 characters")
	}
	if ttl <= 0 || ttl > MaxLeaseTTL {
		ttl = MaxLeaseTTL
	}
	d := s.db()
	if err := docArtifact(ctx, d, artifact); err != nil {
		return false, err
	}
	now := s.Now()
	res, err := d.exec(ctx, `UPDATE docs SET lease_holder=?, lease_until=? WHERE artifact_id=? AND path=? AND data IS NOT NULL
AND (lease_until IS NULL OR lease_until<? OR lease_holder=?)`, holder, now.Add(ttl), artifact, path, now, holder)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// PruneDocTombstones drops tombstones older than TombstoneTTL. A client
// whose cursor is older than that reloads the whole collection.
func (s *Store) PruneDocTombstones(ctx context.Context) (int64, error) {
	res, err := s.db().exec(ctx, `DELETE FROM docs WHERE data IS NULL AND updated_at<?`, s.Now().Add(-TombstoneTTL))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
