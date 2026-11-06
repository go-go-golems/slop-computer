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
	m.Register(Module{Name: "fs", Class: ClassOwn, Config: FSConfig{}, TypeScript: fsTS,
		Doc:  "go-go-goja's fs API over an in-memory tree the actor owns (never the host's disk); it follows the turn and empties on restart. Config: maxBytes, maxFiles.",
		Load: func(s Setup) goja.Value { return s.Actor.fsModule(*s.Config.(*FSConfig)) }})
	m.Register(Module{Name: "path", Class: ClassData, TypeScript: pathTS,
		Doc:  "go-go-goja's path API (POSIX): join, resolve, normalize, dirname, basename, extname, isAbsolute, relative.",
		Load: func(s Setup) goja.Value { return s.Actor.pathModule() }})
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

const fsTS = `declare module "fs" {
  type Data = string | ArrayBuffer | Uint8Array;
  type Encoding = "utf8" | "utf-8" | "base64" | "hex";
  type Enc = Encoding | { encoding?: Encoding };
  interface Stats { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean }
  /** Errors carry .code: ENOENT, EEXIST, ENOTDIR, EISDIR, ENOTEMPTY, ENOSPC, EINVAL. */
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, enc: Enc): string;
  export function writeFileSync(path: string, data: Data, enc?: Enc): void;
  export function appendFileSync(path: string, data: Data, enc?: Enc): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): Stats;
  export function unlinkSync(path: string): void;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  export function renameSync(from: string, to: string): void;
  export function copyFileSync(from: string, to: string): void;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readFile(path: string, enc: Enc): Promise<string>;
  export function writeFile(path: string, data: Data, enc?: Enc): Promise<void>;
  export function appendFile(path: string, data: Data, enc?: Enc): Promise<void>;
  export function exists(path: string): Promise<boolean>;
  export function mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function stat(path: string): Promise<Stats>;
  export function unlink(path: string): Promise<void>;
  export function rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function rename(from: string, to: string): Promise<void>;
  export function copyFile(from: string, to: string): Promise<void>;
  export function isReadOnly(): false;
}`

const pathTS = `declare module "path" {
  export function join(...parts: string[]): string;
  /** Resolves against "/", the fs module's root. */
  export function resolve(...parts: string[]): string;
  export function normalize(p: string): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function isAbsolute(p: string): boolean;
  export function relative(from: string, to: string): string;
  export const sep: "/";
  export const separator: "/";
  export const delimiter: ":";
}`
