package store

import (
	"context"
	"database/sql"
	"time"
)

type Project struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Brief     string    `json:"brief"`
	CreatedAt time.Time `json:"createdAt"`
}

func scanProject(r scanner) (Project, error) {
	var p Project
	err := r.Scan(&p.ID, &p.Name, &p.Brief, &p.CreatedAt)
	return p, notFound(err)
}

func (s *Store) Projects(ctx context.Context) ([]Project, error) {
	rows, err := s.db().query(ctx, `SELECT id,name,brief,created_at FROM projects ORDER BY name, id`)
	return scanAll(rows, err, func(r *sql.Rows) (Project, error) { return scanProject(r) })
}

func (s *Store) Project(ctx context.Context, id string) (Project, error) {
	return scanProject(s.db().row(ctx, `SELECT id,name,brief,created_at FROM projects WHERE id=?`, id))
}

// PutProject creates or updates a project.
func (s *Store) PutProject(ctx context.Context, p Project, actor string) (Project, []Event, error) {
	var out Project
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		var err error
		out, err = scanProject(tx.row(ctx, `INSERT INTO projects(id,name,brief,created_at) VALUES(?,?,?,?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, brief=excluded.brief RETURNING id,name,brief,created_at`, p.ID, p.Name, p.Brief, now))
		if err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "project.put", p.ID, map[string]any{"name": p.Name}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvProjectUpdated, p.ID, "", actor, out)
		evs = append(evs, ev)
		return err
	})
	return out, evs, err
}
