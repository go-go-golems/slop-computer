// actor.d.ts: slop's actor runtime, as an app's actor sees it. The
// globals (defineActor, use, require, console), the ctx every handler
// receives, the definition defineActor takes, and the modules use() returns
// that are built into slop. The Go modules an app may also use are in
// modules.d.ts, which adds them to SlopModules and SlopRequire.
//
// Written by hand (pkg/actor/types/actor.d.ts in slop); TestActorTypesDrift
// fails when the runtime has a property this file does not declare.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Awaitable<T> = T | Promise<T>;
/** A row of an SQL query: column name → value. */
type Row = Record<string, unknown>;
/** The levels an action may require. */
type Level = "view" | "interact" | "admin" | "owner";

// ---- who is calling, and the turn --------------------------------------

/** Who the event is for. Alarms, reactors and other stores' calls come from "store:<id>". */
interface Visitor {
  /** usr_…, store:<id>, or absent for a visitor without an id. */
  id?: string;
  /** Their name, when app.json asks for the profile scope; otherwise "". */
  name: string;
  /** The audience they belong to (member, subscriber, guest, …). */
  audience: string;
  /** Their level on this store: none, self, view, interact, admin or owner. */
  level: string;
  guest: boolean;
  subscribed: boolean;
  /** What their language-model budget allows, when they have one. */
  llm?: { allowed: boolean; budget?: number; used: number; remaining: number | null; source?: string };
}

/** What every handler receives first. A turn is one transaction: ctx.now and ctx.rev change after an await. */
interface Ctx {
  visitor: Visitor;
  /** The same as visitor. */
  principal: Visitor;
  store: { id: string; type: string };
  app: { id: string; version: number };
  event: { kind: "action" | "http" | "alarm" | "reactor" | "setup" | "cont"; name: string; late: boolean };
  /** use('storage'). */
  readonly storage: StorageModule;
  /** When this turn started (ms). */
  readonly now: number;
  /** The store's rev when this turn started. */
  readonly rev: number;
  /** Throws permission_denied unless the visitor has the level. */
  need(level: Level): void;
  /** Throws audience_required unless the visitor is in the audience. */
  needAudience(audience: string): void;
  /** Throws an error with this code; the caller receives {code, message}. */
  fail(code: string, message: string): never;
  log(...args: unknown[]): void;
}

// ---- the definition -----------------------------------------------------

/** An action as a page calls it: (await claude.use('slop')).actions.<name>(args). */
interface ActionDef<A = any, R = unknown> {
  /** The level the visitor needs; an action that declares none needs admin. */
  requires?: Level;
  run(ctx: Ctx, args: A): Awaitable<R>;
}
type Action<A = any, R = unknown> = ActionDef<A, R> | ((ctx: Ctx, args: A) => Awaitable<R>);

interface HttpRequest {
  method: string;
  path: string;
  /** The URL path the mount matched, without a trailing slash. */
  base: string;
  /** The route's :params. */
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}
/** A route's answer: one of json, html, text, body or asset (or none: an empty body). Any value that is not an object is sent as JSON. */
interface HttpResult {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  html?: string;
  text?: string;
  body?: string;
  /** An uploaded file of the store bound at alias from, sent by the server. */
  asset?: { from: string; id: string };
}
type HttpAnswer = HttpResult | unknown[] | string | number | boolean | null;
interface RouteDef {
  /** view (the default), interact, admin, owner, or public. */
  level?: Level | "public";
  audience?: string;
  run(ctx: Ctx, req: HttpRequest): Awaitable<HttpAnswer>;
}
type Route = RouteDef | ((ctx: Ctx, req: HttpRequest) => Awaitable<HttpAnswer>);

/** One change of a commit. */
interface Change { kind: string; key: string; op: string; version?: number }
/** A commit of the store's log: what a reactor of this store's events receives. */
interface Commit {
  store: string;
  epoch: number;
  rev: number;
  at: number;
  principal: string;
  via: string;
  app?: string;
  summary?: string;
  changes: Change[];
}
/** A reactor: "table:notes", "doc:inbox/*", …; "system:<kind>" receives entries of the system log. */
type Reactor = (ctx: Ctx, event: Commit & Record<string, unknown>) => Awaitable<unknown>;

interface EveryDef {
  /** A cron spec ("0 3 * * *"). */
  cron?: string;
  /** Or an interval ("15m"). */
  every?: string;
  run(ctx: Ctx, data: unknown): Awaitable<unknown>;
}
type AlarmHandler = ((ctx: Ctx, data: any) => Awaitable<unknown>) | { run(ctx: Ctx, data: any): Awaitable<unknown> };

interface ActorDef {
  actions?: Record<string, Action>;
  /** Routes on the store's mounts: "GET /api/items/:id". */
  http?: Record<string, Route>;
  /** Reactions to log events, one turn each. */
  on?: Record<string, Reactor>;
  /** Recurring alarms. */
  every?: Record<string, EveryDef>;
  /** Handlers of one-off alarms set with use('alarm').at(). */
  alarms?: Record<string, AlarmHandler>;
  /** Runs once per store and version, after the migrations, in the activation transaction. */
  setup?(ctx: Ctx): unknown;
  /** A check after setup; throwing keeps the version from activating. */
  smoke?(ctx: Ctx): unknown;
}

/** Defines the actor; call it once, while the actor's entry file loads. */
declare function defineActor<D extends ActorDef>(def: D): D;

/**
 * The definition an app's contract asks for: actions typed from an
 * interface the page imports too (import type { Actions } from './api.ts').
 *   defineActor({ actions: { … } } satisfies ActorOf<Actions>)
 */
type ActorOf<A> = Omit<ActorDef, "actions"> & {
  actions: { [K in keyof A]: A[K] extends (args: infer P) => infer R ? Action<P, Awaited<R>> : never };
};

// ---- use() and require() -------------------------------------------------

/** The modules use() returns. modules.d.ts adds the Go modules this app may use. A module that may be absent is null then. */
interface SlopModules {
  sql: SqlModule;
  db: DbModule;
  files: FilesModule;
  alarm: AlarmModule;
  storage: StorageModule;
  time: TimeModule;
  log: LogModule;
  stores: StoresModule;
  /** null unless app.json lists origins in slop.fetch and the policy allows it. */
  fetch: FetchModule | null;
  /** null unless app.json lists names in slop.secrets and the policy allows it. */
  secrets: SecretsModule | null;
  room: RoomModule | null;
  /** null unless app.json declares sample, a model is configured, and the policy allows it. */
  sample: SampleModule | null;
  /** null unless app.json lists operations in slop.platform and the policy allows it. */
  platform: PlatformModule | null;
}
/** The Go modules require() also returns (modules.d.ts fills it in). */
interface SlopRequire {}

declare function use<N extends keyof SlopModules>(name: N): SlopModules[N];
declare function require<N extends keyof SlopRequire>(name: N): SlopRequire[N];
/** The app's own files ("./lib/rows"), and packages app.json maps in slop.imports.actor. */
declare function require(name: string): any;
declare const module: { exports: any };
declare const exports: any;

declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

// ---- the built-in modules -------------------------------------------------

/** The app's tables, in the turn's transaction. Integers past 2^53 arrive as strings. */
interface SqlModule {
  all(query: string, ...params: unknown[]): Row[];
  one(query: string, ...params: unknown[]): Row | null;
  run(query: string, ...params: unknown[]): { changes: number; lastRowid: number };
  /** Runs fn in a savepoint: a throw rolls back its writes. */
  transaction<T>(fn: () => T): T;
}

interface DocSnapshot<T = any> {
  exists: boolean;
  path: string;
  id: string;
  version: number;
  data(): T | undefined;
}
interface DocRef<T = any> {
  path: string;
  get(): DocSnapshot<T>;
  /** Replaces the body; returns the new version. */
  set(body: T): number;
  /** Merges fields into the body; returns the new version. */
  update(fields: Partial<T>): number;
  delete(): boolean;
}
type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "array-contains";
interface DocQuery<T = any> {
  where(field: string, op: WhereOp, value: unknown): DocQuery<T>;
  orderBy(field: string, dir?: "asc" | "desc"): DocQuery<T>;
  limit(n: number): DocQuery<T>;
  get(): { docs: DocSnapshot<T>[]; size: number; empty: boolean };
}
/** Documents: this store's, and others' through their aliases (read as the visitor). */
interface DbModule {
  doc<T = any>(path: string): DocRef<T>;
  collection<T = any>(path: string): DocQuery<T>;
}

interface FileInfo { zone?: string; path: string; sha256: string; size: number; type: string; rev?: number }
interface FilesModule {
  /** A file's text: of the tree (default) or assets, now or at a ref or snapshot. */
  text(path: string, opts?: { zone?: "tree" | "assets"; at?: string }): string;
  read(path: string, opts?: { zone?: "tree" | "assets"; at?: string }): ArrayBuffer;
  /** Writes a file (to assets unless zone says tree). */
  write(path: string, data: string | ArrayBuffer | Uint8Array, opts?: { zone?: "tree" | "assets"; type?: string }): FileInfo;
  list(prefix?: string, opts?: { zone?: "tree" | "assets" }): FileInfo[];
  /** Takes a snapshot of the tree; returns its number. */
  snapshot(opts?: { message?: string }): number;
}

interface AlarmModule {
  /** Fires alarms.<name> (or every.<name>) at time (ms) with data. */
  at(time: number, name: string, data?: unknown): void;
  every(name: string, spec: string): void;
  cancel(name: string): void;
  list(): { name: string; at: number; every: string | null; running: number }[];
}

interface TimeModule {
  now(): number;
  /** Ends the turn; the code after the await runs in a new one. */
  sleep(ms: number): Promise<void>;
}

interface LogModule {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/** Another store, bound to this one under an alias, read with this store's own grant. */
interface StoreHandle {
  id: string;
  docs: {
    get<T = any>(path: string): DocSnapshot<T>;
    query<T = any>(coll: string, opts?: { filters?: { field: string; op: WhereOp; value: unknown }[]; order?: string; desc?: boolean; limit?: number }): DocSnapshot<T>[];
  };
  /** Its published files (main). */
  files: { text(path: string): string; list(): FileInfo[] };
  /** Its uploads, described (null unless the binding includes them). */
  assets: { get(id: string): { id: string; type: string; size: number; sha256: string } | null; list(): { id: string; type: string; size: number; sha256: string }[] } | null;
  /** Its latest rev. */
  rev(): number;
  log(after: number): Commit[];
  /** Calls one of its actor's actions as this store. */
  call(action: string, args?: unknown): Promise<unknown>;
}
interface StoresModule {
  open(alias: string): StoreHandle;
}

interface FetchResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): string;
  json(): any;
  base64(): string;
}
/** Outbound HTTP to the origins in app.json slop.fetch. */
type FetchModule = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<FetchResponse>;

interface SecretsModule {
  /** A secret listed in app.json slop.secrets, or null when none is set. */
  get(name: string): string | null;
}

interface RoomModule {
  /** Sends data to the store's pages on topic, after the turn commits. */
  emit(topic: string, data?: unknown): void;
  peers(): Record<string, unknown>[];
}

interface SampleTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  execute(input: any): unknown;
}
interface SampleOptions {
  modelTier?: string;
  model?: string;
  effort?: string;
  maxTokens?: number;
  tools?: SampleTool[];
  [key: string]: unknown;
}
/** A language model, paid by the visitor (the store's owner for alarms and reactors). */
interface SampleModule {
  (input: unknown, opts?: SampleOptions): Promise<{ text: string; model: string; usage: { input: number; output: number } }>;
  /** The answer parsed as JSON. */
  json(input: unknown, opts?: SampleOptions): Promise<any>;
  allowed(): boolean;
  limits(): { allowed: boolean; budget?: number; used: number; remaining: number | null; source?: string };
}

/** Platform operations app.json lists in slop.platform, as the visitor; each takes its verb's arguments. */
interface PlatformModule {
  stores: { create(args: Record<string, unknown>): unknown };
  mounts: { set(args: Record<string, unknown>): unknown };
  grants: { set(args: Record<string, unknown>): unknown };
}

interface StorageListOptions { start?: string; startAfter?: string; end?: string; prefix?: string; reverse?: boolean; limit?: number }
interface StorageTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(opts?: StorageListOptions): Promise<Map<string, T>>;
  rollback(): void;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}
interface SqlCursor extends Iterable<Row> {
  columnNames: string[];
  rowsRead: number;
  rowsWritten: number;
  next(): IteratorResult<Row>;
  toArray(): Row[];
  one(): Row;
  raw(): Iterable<unknown[]> & { next(): IteratorResult<unknown[]>; toArray(): unknown[][] };
}
/** Durable-Object-shaped storage over documents (storage/), SQL and the alarm named "alarm". Every promise is already settled. */
interface StorageModule {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(opts?: StorageListOptions): Promise<Map<string, T>>;
  deleteAll(): Promise<void>;
  transaction<T>(closure: (txn: StorageTransaction) => Awaitable<T>): Promise<T>;
  transactionSync<T>(fn: () => T): T;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  sync(): Promise<void>;
  kv: {
    get<T = unknown>(key: string): T | undefined;
    get<T = unknown>(keys: string[]): Map<string, T>;
    put(key: string, value: unknown): void;
    put(entries: Record<string, unknown>): void;
    delete(key: string): boolean;
    delete(keys: string[]): number;
    list<T = unknown>(opts?: StorageListOptions): [string, T][];
  };
  sql: { exec(query: string, ...bindings: unknown[]): SqlCursor };
}
