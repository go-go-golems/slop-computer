package francois

import (
	"context"
	"database/sql"
)

// Exec lets tests try a write on the source's session.
func (s *DBSource) Exec(ctx context.Context, q string) (sql.Result, error) {
	return s.db.ExecContext(ctx, q)
}
