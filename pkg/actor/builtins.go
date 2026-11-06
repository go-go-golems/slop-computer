package actor

// The catalog's built-in modules (SLOP3-012 part 2): the ones the runtime
// itself provides. The actor door registers system and workshop.

import (
	"errors"

	"github.com/dop251/goja"
)

// maxStoreRows is what a store query returns at most (store.Turn.Query).
const maxStoreRows = 10000

// Validate checks a database configuration.
func (c *DatabaseConfig) Validate() error {
	if c.MaxRows < 0 || c.MaxRows > maxStoreRows {
		return errors.New("maxRows is between 0 (the store's limit) and 10000")
	}
	return nil
}

func (m *Manager) registerBuiltins() {
	m.Register(Module{Name: "database", Class: ClassOwn, Config: DatabaseConfig{}, TypeScript: databaseTS,
		Doc:  "go-go-goja's database API (query, exec, begin) over the app's own store; begin() is a savepoint. Config: readOnly, maxRows.",
		Load: func(s Setup) goja.Value { return s.Actor.databaseModule(*s.Config.(*DatabaseConfig)) }})
	m.Register(Module{Name: "express", Class: ClassOwn, TypeScript: expressTS,
		Doc:  "go-go-goja's express route builder, compiled into the actor's route table while actor.js loads; no static, listen or mount.",
		Load: func(s Setup) goja.Value { return s.Actor.expressModule() }})
}

const databaseTS = `declare module "database" {
  interface ExecResult { success: true; rowsAffected: number; lastInsertId: number }
  interface Handle {
    query(sql: string, ...params: unknown[]): Record<string, unknown>[];
    exec(sql: string, ...params: unknown[]): ExecResult;
    commit(): { success: true };
    rollback(): { success: true };
  }
  /** Rows of a statement on the app's own store (arrays are spread into parameters). */
  export function query(sql: string, ...params: unknown[]): Record<string, unknown>[];
  export function exec(sql: string, ...params: unknown[]): ExecResult;
  /** A savepoint in the current turn; it rolls back if the turn ends first. */
  export function begin(): Handle;
  /** Throws: the module reaches the app's own store and no other. */
  export function configure(...args: unknown[]): never;
  export function close(): void;
}`

const expressTS = `declare module "express" {
  type Level = "public" | "view" | "interact" | "admin";
  interface Res {
    status(code: number): Res;
    set(name: string, value: string): Res;
    json(v: unknown): void;
    send(v: string): void;
    html(v: string): void;
    redirect(url: string): void;
    redirect(code: number, url: string): void;
    end(): void;
  }
  type Handler = (ctx: any, res: Res) => unknown;
  interface Secured { audience(group: string): Secured; handle(fn: Handler): void }
  interface Route { public(): Secured; allow(level: Level): Secured }
  interface App {
    use(fn: (ctx: any, res: Res, next: () => unknown) => unknown): App;
    get(pattern: string): Route; head(pattern: string): Route; post(pattern: string): Route;
    put(pattern: string): Route; patch(pattern: string): Route; delete(pattern: string): Route;
    options(pattern: string): Route; all(pattern: string): Route; route(method: string, pattern: string): Route;
  }
  /** The actor's one app; routes register while actor.js loads. */
  export function app(): App;
}`
