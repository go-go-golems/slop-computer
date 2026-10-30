package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Event is one entry of the event log. Every kernel mutation appends its
// events in the same transaction; the server publishes them after commit.
// Seq orders them; an ephemeral event (agent presence) has Seq 0 and is
// never stored.
type Event struct {
	Seq       int64     `json:"seq"`
	Type      string    `json:"type"`
	Project   string    `json:"project,omitempty"`
	Artifact  string    `json:"artifact,omitempty"`
	Actor     string    `json:"actor,omitempty"`
	Payload   JSON      `json:"payload"`
	CreatedAt time.Time `json:"at"`
}

// Event types.
const (
	EvArtifactCreated = "artifact.created"
	EvArtifactUpdated = "artifact.updated"
	EvVersionCreated  = "version.created"
	EvRefMoved        = "ref.moved"
	EvRouteSet        = "route.set"
	EvRouteRemoved    = "route.removed"
	EvThreadCreated   = "thread.created"
	EvCommentCreated  = "comment.created"
	EvThreadResolved  = "thread.resolved"
	EvProjectUpdated  = "project.updated"
	EvUserRole        = "user.role"
	EvTokenCreated    = "token.created"
	EvTokenRevoked    = "token.revoked"
	EvAgentWaiting    = "agent.waiting"
	EvAgentLeft       = "agent.left"
)

func appendEvent(ctx context.Context, d db, now time.Time, typ, project, artifact, actor string, payload any) (Event, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Event{}, err
	}
	ev := Event{Type: typ, Project: project, Artifact: artifact, Actor: actor, Payload: JSON(raw), CreatedAt: now}
	err = d.row(ctx, `INSERT INTO events(type,project_id,artifact_id,actor_id,payload,created_at) VALUES(?,?,?,?,?,?) RETURNING seq`,
		typ, project, artifact, actor, ev.Payload, now).Scan(&ev.Seq)
	return ev, err
}

// AppendEvent records one event outside a kernel mutation (user and token
// changes made through the auth store).
func (s *Store) AppendEvent(ctx context.Context, typ, project, artifact, actor string, payload any) (Event, error) {
	return appendEvent(ctx, s.db(), s.Now(), typ, project, artifact, actor, payload)
}

const eventColumns = `seq,type,project_id,artifact_id,actor_id,payload,created_at`

func scanEvent(r scanner) (Event, error) {
	var e Event
	err := r.Scan(&e.Seq, &e.Type, &e.Project, &e.Artifact, &e.Actor, &e.Payload, &e.CreatedAt)
	return e, err
}

// EventsAfter returns up to limit events with seq > after, oldest first.
func (s *Store) EventsAfter(ctx context.Context, after int64, limit int) ([]Event, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	rows, err := s.db().query(ctx, `SELECT `+eventColumns+` FROM events WHERE seq > ? ORDER BY seq LIMIT ?`, after, limit)
	return scanAll(rows, err, func(r *sql.Rows) (Event, error) { return scanEvent(r) })
}

// LastSeq is the newest event's seq, or 0.
func (s *Store) LastSeq(ctx context.Context) (int64, error) {
	var seq sql.NullInt64
	err := s.db().row(ctx, `SELECT MAX(seq) FROM events`).Scan(&seq)
	return seq.Int64, err
}
