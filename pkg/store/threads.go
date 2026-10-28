package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Thread is a comment thread on one artifact version, anchored to an
// element ({selector, fx, fy, text, styles}) or a record ({record, field}).
type Thread struct {
	ID         string     `json:"id"`
	Artifact   string     `json:"artifact"`
	Version    int        `json:"version"`
	Anchor     JSON       `json:"anchor"`
	By         string     `json:"by"`
	CreatedAt  time.Time  `json:"at"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy *string    `json:"resolvedBy,omitempty"`
	Resolved   bool       `json:"resolved"`
	Comments   []Comment  `json:"comments"`
}

type Comment struct {
	ID        int64     `json:"id"`
	Thread    string    `json:"thread"`
	By        string    `json:"by"`
	TokenID   *string   `json:"tokenId,omitempty"`
	Agent     bool      `json:"agent"`
	Version   *int      `json:"version,omitempty"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"at"`
}

const threadColumns = `t.id,t.artifact_id,t.version,t.anchor,t.created_by,t.created_at,t.resolved_at,t.resolved_by`

func scanThread(r scanner) (Thread, error) {
	var t Thread
	err := r.Scan(&t.ID, &t.Artifact, &t.Version, &t.Anchor, &t.By, &t.CreatedAt, &t.ResolvedAt, &t.ResolvedBy)
	t.Resolved = t.ResolvedAt != nil
	return t, notFound(err)
}

// ThreadFilter selects threads; empty fields match everything.
type ThreadFilter struct {
	Artifact, Project string
	OpenOnly          bool
}

// Threads lists threads with their comments, oldest first.
func (s *Store) Threads(ctx context.Context, f ThreadFilter) ([]Thread, error) {
	open := 0
	if f.OpenOnly {
		open = 1
	}
	rows, err := s.db().query(ctx, `SELECT `+threadColumns+` FROM threads t JOIN artifacts a ON a.id=t.artifact_id
WHERE (?='' OR t.artifact_id=?) AND (?='' OR a.project_id=?) AND (?=0 OR t.resolved_at IS NULL) ORDER BY t.created_at, t.id`,
		f.Artifact, f.Artifact, f.Project, f.Project, open)
	ts, err := scanAll(rows, err, func(r *sql.Rows) (Thread, error) { return scanThread(r) })
	if err != nil {
		return nil, err
	}
	if len(ts) == 0 {
		return ts, nil
	}
	byID := map[string]int{}
	for i := range ts {
		byID[ts[i].ID] = i
		ts[i].Comments = []Comment{}
	}
	crow, err := s.db().query(ctx, `SELECT c.id,c.thread_id,c.author_id,c.token_id,c.agent,c.version,c.body,c.created_at FROM comments c
JOIN threads t ON t.id=c.thread_id JOIN artifacts a ON a.id=t.artifact_id
WHERE (?='' OR t.artifact_id=?) AND (?='' OR a.project_id=?) ORDER BY c.id`, f.Artifact, f.Artifact, f.Project, f.Project)
	cs, err := scanAll(crow, err, func(r *sql.Rows) (Comment, error) { return scanComment(r) })
	if err != nil {
		return nil, err
	}
	for _, c := range cs {
		if i, ok := byID[c.Thread]; ok {
			ts[i].Comments = append(ts[i].Comments, c)
		}
	}
	return ts, nil
}

func scanComment(r scanner) (Comment, error) {
	var c Comment
	err := r.Scan(&c.ID, &c.Thread, &c.By, &c.TokenID, &c.Agent, &c.Version, &c.Text, &c.CreatedAt)
	return c, err
}

func getThread(ctx context.Context, d db, id string) (Thread, error) {
	t, err := scanThread(d.row(ctx, `SELECT `+threadColumns+` FROM threads t WHERE t.id=?`, id))
	if err != nil {
		return t, err
	}
	rows, err := d.query(ctx, `SELECT id,thread_id,author_id,token_id,agent,version,body,created_at FROM comments WHERE thread_id=? ORDER BY id`, id)
	t.Comments, err = scanAll(rows, err, func(r *sql.Rows) (Comment, error) { return scanComment(r) })
	return t, err
}

func (s *Store) Thread(ctx context.Context, id string) (Thread, error) {
	return getThread(ctx, s.db(), id)
}

func checkText(text string) error {
	if text == "" || len(text) > 20000 {
		return invalidf("a comment is 1–20000 characters")
	}
	return nil
}

// CreateThread opens a thread with its first comment.
func (s *Store) CreateThread(ctx context.Context, artifact string, version int, anchor JSON, text, actor, tokenID string, agent bool) (Thread, []Event, error) {
	if err := checkText(text); err != nil {
		return Thread{}, nil, err
	}
	var out Thread
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		a, err := getArtifact(ctx, tx, artifact)
		if err != nil {
			return err
		}
		var one int
		if err = tx.row(ctx, `SELECT 1 FROM versions WHERE artifact_id=? AND n=?`, artifact, version).Scan(&one); err != nil {
			return invalidf("%s has no version %d", artifact, version)
		}
		if len(anchor) == 0 {
			anchor = JSON("{}")
		}
		id := NewID("th_")
		if _, err = tx.exec(ctx, `INSERT INTO threads(id,artifact_id,version,anchor,created_by,created_at) VALUES(?,?,?,?,?,?)`, id, artifact, version, anchor, actor, now); err != nil {
			return err
		}
		if _, err = tx.exec(ctx, `INSERT INTO comments(thread_id,author_id,token_id,agent,version,body,created_at) VALUES(?,?,?,?,?,?,?)`,
			id, actor, nullable(tokenID), agent, version, text, now); err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "comment.create", fmt.Sprintf("%s v%d", artifact, version), map[string]any{"thread": id}); err != nil {
			return err
		}
		if out, err = getThread(ctx, tx, id); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvThreadCreated, deref(a.Project), artifact, actor, map[string]any{"thread": out})
		evs = append(evs, ev)
		return err
	})
	return out, evs, err
}

// Reply adds a comment to a thread. version names the version the reply is
// about (an agent's fix), if any.
func (s *Store) Reply(ctx context.Context, thread, text string, version *int, actor, tokenID string, agent bool) (Thread, Comment, []Event, error) {
	var t Thread
	var c Comment
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		var err error
		t, c, evs, err = reply(ctx, tx, s.Now(), thread, text, version, actor, tokenID, agent)
		return err
	})
	return t, c, evs, err
}

func reply(ctx context.Context, tx db, now time.Time, thread, text string, version *int, actor, tokenID string, agent bool) (Thread, Comment, []Event, error) {
	if err := checkText(text); err != nil {
		return Thread{}, Comment{}, nil, err
	}
	t, err := getThread(ctx, tx, thread)
	if err != nil {
		return t, Comment{}, nil, err
	}
	a, err := getArtifact(ctx, tx, t.Artifact)
	if err != nil {
		return t, Comment{}, nil, err
	}
	var c Comment
	if err = tx.row(ctx, `INSERT INTO comments(thread_id,author_id,token_id,agent,version,body,created_at) VALUES(?,?,?,?,?,?,?)
RETURNING id,thread_id,author_id,token_id,agent,version,body,created_at`, thread, actor, nullable(tokenID), agent, version, text, now).
		Scan(&c.ID, &c.Thread, &c.By, &c.TokenID, &c.Agent, &c.Version, &c.Text, &c.CreatedAt); err != nil {
		return t, c, nil, err
	}
	t.Comments = append(t.Comments, c)
	ev, err := appendEvent(ctx, tx, now, EvCommentCreated, deref(a.Project), t.Artifact, actor, map[string]any{"thread": t.ID, "artifact": t.Artifact, "comment": c})
	return t, c, []Event{ev}, err
}

// ResolveThread marks a thread resolved or open again.
func (s *Store) ResolveThread(ctx context.Context, id string, resolved bool, actor string) (Thread, []Event, error) {
	var out Thread
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		t, err := getThread(ctx, tx, id)
		if err != nil {
			return err
		}
		a, err := getArtifact(ctx, tx, t.Artifact)
		if err != nil {
			return err
		}
		if resolved {
			_, err = tx.exec(ctx, `UPDATE threads SET resolved_at=?, resolved_by=? WHERE id=?`, now, actor, id)
		} else {
			_, err = tx.exec(ctx, `UPDATE threads SET resolved_at=NULL, resolved_by=NULL WHERE id=?`, id)
		}
		if err != nil {
			return err
		}
		if out, err = getThread(ctx, tx, id); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvThreadResolved, deref(a.Project), t.Artifact, actor, map[string]any{"thread": out})
		evs = append(evs, ev)
		return err
	})
	return out, evs, err
}
