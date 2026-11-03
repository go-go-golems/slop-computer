package store

import (
	"strings"

	"github.com/mattn/go-sqlite3"
)

// Caller kinds: who prepared the statement the authorizer is looking at.
const (
	CallerKernel     = "kernel"      // the kernel's own statements: everything
	CallerActor      = "actor"       // actor.js: read all, write app tables
	CallerMigration  = "migration"   // sql/*.sql: DDL on app names, FTS5
	CallerAdminRead  = "admin-read"  // sql.query: read everything
	CallerAdminWrite = "admin-write" // sql.exec --write: write app tables
)

// sqliteRecursive is SQLITE_RECURSIVE (WITH RECURSIVE); mattn leaves it out.
const sqliteRecursive = 33

func appName(name string) bool {
	n := strings.ToLower(name)
	return n != "" && !strings.HasPrefix(n, "_") && !strings.HasPrefix(n, "sqlite_") && !strings.HasPrefix(n, "slop_")
}

// sqliteMade reports objects SQLite creates itself for app DDL:
// sqlite_sequence for AUTOINCREMENT, and the automatic index of a
// non-integer PRIMARY KEY or UNIQUE column (arg2 is its table).
func sqliteMade(action int, a1, a2 string) bool {
	n := strings.ToLower(a1)
	switch action {
	case sqlite3.SQLITE_CREATE_TABLE:
		return n == "sqlite_sequence"
	case sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX:
		return strings.HasPrefix(n, "sqlite_autoindex_") && appName(a2)
	}
	return false
}

func schemaTable(name string) bool {
	n := strings.ToLower(name)
	return n == "sqlite_master" || n == "sqlite_schema" || n == "sqlite_temp_master"
}

var readPragmas = map[string]bool{"table_info": true, "table_xinfo": true, "index_list": true, "index_info": true,
	"index_xinfo": true, "foreign_key_list": true, "data_version": true}

// authorize is the SQLite authorizer: it runs while each statement is
// prepared on the writer connection, and records the app tables a turn may
// write so the commit can report them. (mattn passes four arguments:
// action, arg1, arg2, database name; the view/trigger name is dropped.)
func (s *Store) authorize(action int, a1, a2, dbName string) int {
	t := s.cur
	caller := CallerKernel
	if t != nil {
		caller = t.caller
	}
	if caller == CallerKernel {
		// The kernel never writes app tables. An app trigger runs inside
		// the statement that writes its table, with that statement's
		// authority; so does a foreign key cascade into an app table. With
		// this rule, and app tables unable to reference kernel tables
		// (checkAppForeignKeys), no app-authored SQL runs as the kernel.
		// (mattn drops the trigger-name argument that would say so.)
		switch action {
		case sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE:
			if appName(a1) {
				return sqlite3.SQLITE_DENY
			}
		}
		return sqlite3.SQLITE_OK
	}
	if dbName == "temp" {
		return sqlite3.SQLITE_DENY
	}
	switch action {
	case sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqliteRecursive, sqlite3.SQLITE_FUNCTION:
		return sqlite3.SQLITE_OK
	case sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE:
		switch {
		case appName(a1) && (caller == CallerActor || caller == CallerMigration || caller == CallerAdminWrite):
			if t != nil {
				t.tables[strings.ToLower(a1)] = true
			}
			return sqlite3.SQLITE_OK
		case schemaTable(a1) && caller == CallerMigration:
			return sqlite3.SQLITE_OK // DDL writes the schema table
		}
		return sqlite3.SQLITE_DENY
	case sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_CREATE_VIEW, sqlite3.SQLITE_CREATE_TRIGGER,
		sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_DROP_TRIGGER:
		// An index or trigger (arg2 is its table) only on an app table: a
		// trigger on a kernel table would fire inside the kernel's own
		// statements, whose trigger bodies nothing here checks.
		onApp := true
		switch action {
		case sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_DROP_TRIGGER:
			onApp = appName(a2)
		}
		if caller == CallerMigration && ((appName(a1) && onApp) || sqliteMade(action, a1, a2)) {
			if t != nil {
				t.schema = true
			}
			return sqlite3.SQLITE_OK
		}
		return sqlite3.SQLITE_DENY
	case sqlite3.SQLITE_ALTER_TABLE:
		// arg2 is the table name for ALTER TABLE.
		if caller == CallerMigration && appName(a2) {
			if t != nil {
				t.schema = true
			}
			return sqlite3.SQLITE_OK
		}
		return sqlite3.SQLITE_DENY
	case sqlite3.SQLITE_CREATE_VTABLE, sqlite3.SQLITE_DROP_VTABLE:
		if caller == CallerMigration && appName(a1) && strings.EqualFold(a2, "fts5") {
			t.schema = true
			return sqlite3.SQLITE_OK
		}
		return sqlite3.SQLITE_DENY
	case sqlite3.SQLITE_PRAGMA:
		if readPragmas[strings.ToLower(a1)] && a2 == "" {
			return sqlite3.SQLITE_OK
		}
		return sqlite3.SQLITE_DENY
	case sqlite3.SQLITE_SAVEPOINT:
		if caller == CallerActor {
			return sqlite3.SQLITE_OK // sql.transaction(fn) inside the turn
		}
		return sqlite3.SQLITE_DENY
	case sqlite3.SQLITE_ANALYZE, sqlite3.SQLITE_REINDEX:
		if caller == CallerMigration {
			return sqlite3.SQLITE_OK
		}
		return sqlite3.SQLITE_DENY
	}
	// TRANSACTION, ATTACH, DETACH, every TEMP object, anything unknown.
	return sqlite3.SQLITE_DENY
}

func (s *Store) curPrincipal() string {
	if t := s.cur; t != nil {
		return t.Who.ID
	}
	return ""
}

func (s *Store) curLevel() string {
	if t := s.cur; t != nil {
		return t.Who.Level
	}
	return "none"
}

func (s *Store) curNow() int64 {
	if t := s.cur; t != nil {
		return t.Now
	}
	return 0
}

// checkAppForeignKeys refuses a schema in which an app table references a
// kernel table. A cascade from the kernel's own statement (deleting a
// document) would write the app table with the kernel's authority, and the
// app's triggers on it would run as the kernel.
func (t *Turn) checkAppForeignKeys() error {
	rows, err := t.s.w.QueryContext(t.ctx, `SELECT m.name, f."table" FROM sqlite_schema m, pragma_foreign_key_list(m.name) f WHERE m.type = 'table'`)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var table, parent string
		if err := rows.Scan(&table, &parent); err != nil {
			return err
		}
		if appName(table) && !appName(parent) {
			return &DocError{Msg: "invalid_argument: app table " + table + " may not reference " + parent}
		}
	}
	return rows.Err()
}
