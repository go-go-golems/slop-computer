/* slop page runtime declarations (window.claude), built from web/runtime: do not edit. source sha256:53e3f0ba2e0cef34ba8fb00c3c03e5d504ed1e607bdf93a957b5091386cd5c94 */
// window.claude: claude.use(name) resolves a capability's namespace, or null.
// claude.use<Actions>("slop") types the actor's actions by the app's contract.
declare module "slop:page/limits" {
    export const limits: {
        MaxDocBytes: number;
        MaxDocDepth: number;
        MaxDocsPerTarget: number;
        MaxPathBytes: number;
        MaxPathSegments: number;
        MaxSegmentBytes: number;
        MaxRules: number;
        MaxFilters: number;
        MaxInValues: number;
        MaxQueryLimit: number;
        MaxSubscriptions: number;
        MinLeaseMs: number;
        MaxLeaseMs: number;
        DefaultLeaseMs: number;
        MaxRoomData: number;
        MaxPresence: number;
        MaxTopics: number;
        MaxRooms: number;
        MaxCommentBytes: number;
        MaxAssetBytes: number;
        MaxCodeAssetBytes: number;
        MaxPromptBytes: number;
        MaxToolResultBytes: number;
        MaxSendToClaude: number;
    };
}
declare module "slop:page/util" {
    export type Json = null | boolean | number | string | Json[] | {
        [k: string]: Json;
    };
    export type Body = Record<string, unknown>;
    /** A contract rejection: {code, message} on an Error, so stacks survive. */
    export function fail(code: string, message: string, extra?: Record<string, unknown>): Error & {
        code: string;
    };
    export const bytes: (s: string) => number;
    /** Checks a db path; doc says whether it must name a document (even
     *  segments) or a collection (odd). Throws TypeError like the contract. */
    export function checkPath(p: unknown, doc: boolean): string;
    export const collOf: (p: string) => string;
    export const idOf: (p: string) => string;
    /** Canonical JSON (sorted keys), as Go's encoding/json writes maps. */
    export function canon(v: unknown): string;
    export const equal: (a: unknown, b: unknown) => boolean;
    export function depth(v: unknown): number;
    export const isPlain: (v: unknown) => v is Body;
    /** Deep-freeze a JSON value (snapshots are frozen). Typed arrays (a file's
     * bytes) are left as they are: Object.freeze throws on a view with
     * elements. */
    export function freeze<T>(v: T): T;
    /** A JSON round trip: plain data only, as the wire carries it. */
    export function plain(v: unknown): Json;
    export function randomId(n?: number): string;
}
declare module "slop:page/transport" {
    export type Boot = {
        mode: string;
        parentOrigin?: string;
        runtime?: {
            target: string;
            app: string;
            version: number;
            caps: Record<string, unknown>;
            docs?: Record<string, unknown>;
        };
        version?: {
            artifact: string;
            n: number;
        };
    };
    export type Hello = {
        view: string;
        target: string;
        app: string;
        version: number;
        kind: string;
        level: string;
        caps: Record<string, Record<string, unknown>>;
        rev: number;
        me: {
            id?: string;
            isOwner: boolean;
            canEdit: boolean;
            can: Record<string, boolean>;
            profile?: Record<string, unknown>;
            audience?: string;
            level?: string;
            guest?: boolean;
            subscribed?: boolean;
            llm?: {
                allowed: boolean;
                remaining: number | null;
            };
        };
        permissions: Record<string, string>;
    };
    export const boot: Boot;
    export function post(m: Record<string, unknown>, transfer?: Transferable[]): void;
    type Handler = (data: any) => void;
    export function on(type: string, h: Handler): () => void;
    /** Asks the shell something and waits for its answer (same id). */
    export function ask(type: string, payload: Record<string, unknown>, transfer?: Transferable[]): Promise<any>;
    export const state: {
        readonly connected: boolean;
        readonly view: string;
        readonly hello: Hello | null;
        readonly terminal: string;
    };
    /** Notes the newest target rev a doc event carried (for resume). */
    export function seenRev(rev: number): void;
    export function connect(): Promise<Hello | null>;
    /** Calls a capability method as this view. Rejects {code, message}. */
    export function rpc<T = any>(method: string, args?: unknown): Promise<T>;
    /** A raw same-origin request with the view's secret (assets, slop). */
    export function request(path: string, init?: RequestInit): Promise<Response>;
}
declare module "slop:page/caps" {
    import { type Hello } from "slop:page/transport";
    export function user(h: Hello): Readonly<Record<string, unknown>>;
    export function initPermissions(h: Hello | null): void;
    /** Asks the shell's dialog for capabilities still at "prompt". */
    export function request(names?: readonly string[]): Promise<Record<string, string>>;
    /** Before a capability call that needs consent: asks once, then holds. */
    export function consent(name: string, code?: string): Promise<void>;
    export const permissions: Readonly<{
        state(name?: string): Promise<string | Record<string, string>>;
        request(names?: readonly string[]): Promise<Record<string, string>>;
        manage(): Promise<void>;
    }>;
    export function comments(h: Hello): Readonly<Record<string, unknown>>;
    export const assets: Readonly<{
        upload(blob: Blob, opts?: {
            type?: string;
        }): Promise<any>;
        list(): Promise<{
            assets: any;
            usage: {
                files: any;
                bytes: any;
                maxFiles: number;
                maxBytes: number;
            };
        }>;
        delete(ref: string): Promise<any>;
    }>;
    export const downloads: Readonly<{
        save(req: {
            filename: string;
            data: string | Blob | ArrayBuffer | ArrayBufferView;
        }): Promise<{
            status: string;
        }>;
    }>;
    export const artifact: Readonly<{
        publish(input: string | Record<string, unknown>): Promise<{
            version: string;
        }>;
        edit(): Promise<never>;
        sync(fn: () => unknown): Promise<void>;
        metadata(refs: readonly string[]): Promise<Record<string, unknown>>;
    }>;
    /** The management API an admin approved for this app version: the old
     *  tool API, same-origin through /_rt/api/. */
    export function slop(h: Hello): {
        actions: Record<string, (args?: unknown) => Promise<unknown>>;
        call: (action: string, args?: unknown) => Promise<any>;
        stores: {
            open: (alias: string) => {
                doc: (path: string) => Promise<any>;
                query: (coll: string, query?: unknown) => Promise<any>;
                file: (path: string) => Promise<any>;
                files: () => Promise<any>;
            };
            list: (o: {
                type: string;
                title?: string;
            }) => Promise<any>;
        };
        visitor: () => Promise<{} | null>;
        signIn: () => void;
        subscribeUrl: () => string;
    };
    export function files(): Readonly<{
        list: (o?: {
            path?: string;
            recursive?: boolean;
            cursor?: string;
        }) => Promise<{
            entries: {
                path: string;
                isDirectory: boolean;
                size: number;
            }[];
            cursor: string;
        } | {
            entries: {
                path: string;
                isDirectory: boolean;
                size: number;
            }[];
            cursor?: undefined;
        }>;
        read: (path: string, o?: {
            offset?: number;
            length?: number;
        }) => Promise<{
            bytes: Uint8Array<ArrayBufferLike>;
            size: number;
            revision: string;
        }>;
        download: (path: string) => Promise<{
            status: string;
        }>;
        asSampleTools: () => Promise<({
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    path: {
                        type: string;
                    };
                    recursive: {
                        type: string;
                    };
                };
            };
            execute: (i: {
                path?: string;
                recursive?: boolean;
            }) => Promise<{
                path: string;
                isDirectory: boolean;
                size: number;
            }[]>;
        } | {
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties: {
                    path: {
                        type: string;
                    };
                    offset: {
                        type: string;
                    };
                };
                required: string[];
            };
            execute: (i: {
                path: string;
                offset?: number;
            }) => Promise<{
                next?: number | undefined;
                text: string;
                size: number;
            }>;
        })[]>;
    }>;
}
declare module "slop:page/diff" {
    export type Patch = {
        t: "set";
        v?: unknown;
    } | {
        t: "del";
    } | {
        t: "obj";
        k: Record<string, Patch>;
    } | {
        t: "arr";
        s?: number;
        d?: number;
        i?: unknown[];
    };
    export function diff(a: unknown, b: unknown): Patch | null;
    export function applyPatch(a: unknown, p: Patch): unknown;
    export const patchSize: (p: Patch) => number;
}
declare module "slop:page/query" {
    export type Filter = {
        field: string;
        op: string;
        value: unknown;
    };
    export type Query = {
        coll: string;
        filters?: Filter[];
        order?: string;
        desc?: boolean;
        limit?: number;
    };
    export type Doc = {
        path: string;
        body: Record<string, unknown>;
        version: number;
    };
    export function match(q: Query, body: Record<string, unknown>): boolean;
    export function sort<T extends {
        path: string;
        body: Record<string, unknown>;
    }>(q: Query, docs: T[]): T[];
    export function apply<T extends {
        path: string;
        body: Record<string, unknown>;
    }>(q: Query, docs: T[]): T[];
    /** Throws on a query the contract refuses (the caller maps to invalid_argument). */
    export function validate(q: Query): string | null;
}
declare module "slop:page/db" {
    export const db: Readonly<{
        doc: (path: string) => any;
        collection: (path: string) => any;
    }>;
}
declare module "slop:page/room" {
    export function lobby(): Promise<unknown>;
}
declare module "slop:page/sample" {
    import { type Hello } from "slop:page/transport";
    type Tool = {
        name: string;
        description: string;
        inputSchema?: Record<string, unknown>;
        execute: (input: Record<string, unknown>, ctx: {
            signal: AbortSignal;
        }) => unknown;
    };
    type Options = {
        onText?: (u: {
            text: string;
            delta: string;
        }) => void;
        signal?: AbortSignal;
        images?: Blob | Blob[] | FileList;
        modelTier?: "default" | "complex" | "quick" | "inherit";
        model?: string;
        effort?: "low" | "medium" | "high";
        cache?: boolean | {
            gcTime?: number;
            refresh?: boolean;
        };
        tools?: Tool[];
    };
    type Result = {
        text: string;
        truncated: boolean;
        modelTierApplied: string;
        modelApplied?: string;
    };
    /** Parses a reply as JSON: the whole text, then a fenced block, then the
     *  outermost {…} or […]. */
    export function parseJSON(text: string): unknown;
    export function sample(h: Hello): ((input: unknown, o?: Options) => Promise<Result>) & {
        json: (input: unknown, o?: Options) => Promise<unknown>;
        limits: () => Promise<any>;
    };
}
declare module "slop:page/types" {
    import type { artifact, assets, comments, downloads, files, permissions, slop, user } from "slop:page/caps";
    import type { db } from "slop:page/db";
    import type { lobby } from "slop:page/room";
    import type { sample } from "slop:page/sample";
    /** What claude.use(name) resolves to, when this view may use it. */
    export interface Capabilities {
        db: typeof db;
        user: ReturnType<typeof user>;
        room: ReturnType<typeof lobby>;
        comments: ReturnType<typeof comments>;
        assets: typeof assets;
        downloads: typeof downloads;
        files: ReturnType<typeof files>;
        artifact: typeof artifact;
        /** The same as artifact. */
        self: typeof artifact;
        sample: ReturnType<typeof sample>;
        slop: ReturnType<typeof slop>;
        permissions: typeof permissions;
    }
    /** A value as it arrives after crossing the wire as JSON: a Date is a string, functions and undefined are gone. */
    export type JsonOf<T> = T extends string | number | boolean | null ? T : T extends undefined | symbol | ((...args: any[]) => unknown) ? never : T extends {
        toJSON(): infer J;
    } ? JsonOf<J> : T extends readonly (infer E)[] ? JsonOf<E>[] : T extends object ? {
        [K in keyof T as T[K] extends undefined | symbol | ((...args: any[]) => unknown) ? never : K]: JsonOf<T[K]>;
    } : unknown;
    /**
     * The page's side of an app's contract: each action of A (an interface the
     * actor implements with ActorOf<A>) as a call that resolves to its result,
     * as JSON.
     */
    export type ActionsOf<A> = {
        [K in keyof A]: A[K] extends (args: infer P) => infer R ? undefined extends P ? (args?: P) => Promise<JsonOf<Awaited<R>>> : (args: P) => Promise<JsonOf<Awaited<R>>> : never;
    };
    /** The slop namespace with typed actions. */
    export type SlopOf<A> = Omit<Capabilities["slop"], "actions"> & {
        actions: ActionsOf<A>;
    };
    /** Untyped actions: any name, any arguments. */
    export type AnyActions = Record<string, (args?: any) => unknown>;
    /** window.claude. */
    export interface Claude {
        /** The slop namespace, its actions typed by the app's contract: claude.use<Actions>("slop"). */
        use<A = AnyActions>(name: "slop"): Promise<SlopOf<A> | null>;
        /** A capability's namespace, or null when this view may not use it (undeclared, or not allowed). */
        use<N extends keyof Capabilities>(name: N): Promise<Capabilities[N] | null>;
    }
}

declare const claude: import("slop:page/types").Claude;
interface Window { readonly claude: import("slop:page/types").Claude }
/** A value as it arrives after crossing the wire as JSON. */
type JsonOf<T> = import("slop:page/types").JsonOf<T>;
