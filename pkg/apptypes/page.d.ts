/* slop page runtime declarations (window.claude), built from web/runtime: do not edit. source sha256:46138ab161bb11ffcc0d202d6e30735030460fd5b2c22d99fbe9b95371d70278 */
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
    /** A person as this view may see them (name and avatar need the profile scope, email the email scope). */
    export type UserProfile = Readonly<{
        id: string;
        name: string;
        avatarUrl: string;
        color: string;
        email: string | null;
        isMe: boolean;
        guest: boolean;
    }>;
    /** The viewer: who they are, and who they are to the platform (the facts an actor reads from ctx.visitor). */
    export type Viewer = Readonly<{
        id: string | null;
        name: string;
        avatarUrl: string;
        color: string;
        email: string | null;
        isOwner: boolean;
        canEdit: boolean;
        audience: string;
        level: string;
        guest: boolean;
        subscribed: boolean;
        llm: Readonly<{
            allowed: boolean;
            remaining: number | null;
        }>;
    }>;
    /**
     * claude.use('user'). id and profiles need the user capability declared;
     * name, avatarUrl and search its profile scope; email its email scope.
     */
    export interface User {
        isOwner(): Promise<boolean>;
        canEdit(): Promise<boolean>;
        /** A named permission of the viewer; null when the app has none by that name. */
        can(name: string): Promise<boolean | null>;
        me(): Promise<Viewer>;
        id?(): Promise<string | null>;
        /** Profiles by id; an unknown id gets an empty profile. Never rejects. */
        profiles?(ids: readonly string[] | string): Promise<Readonly<Record<string, UserProfile>>>;
        name?(): Promise<string>;
        avatarUrl?(): Promise<string | null>;
        search?(q: string): Promise<readonly UserProfile[]>;
        email?(): Promise<string | null>;
    }
    export function user(h: Hello): User;
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
    /** Where a comment points: what anchorFor returns. */
    export type CommentAnchor = Readonly<Record<string, unknown>>;
    /**
     * claude.use('comments'). With composer_only, only openComposer and
     * anchorFor; otherwise the view writes comments itself (after the
     * viewer's consent).
     */
    export interface Comments {
        openComposer(t: {
            element?: Element;
            range?: Range;
        }): Promise<{
            opened: boolean;
        }>;
        anchorFor(el: Element): Promise<CommentAnchor>;
        create?(o: {
            anchor: CommentAnchor;
            text: string;
        }): Promise<{
            threadId: string;
            commentId: string;
        }>;
        reply?(threadId: string, text: string): Promise<{
            commentId: string;
        }>;
        resolve?(threadId: string, resolved: boolean): Promise<void>;
        delete?(threadId: string): Promise<void>;
        sendToClaude?(t: {
            anchor?: CommentAnchor;
            threadId?: string;
            text: string;
        }): Promise<{
            threadId: string;
            commentId: string;
        }>;
        canSendToClaude?(): Promise<"available" | "no_session">;
    }
    export function comments(h: Hello): Comments;
    /** An uploaded file: url is where pages load it from. */
    export type Asset = Readonly<{
        id: string;
        url: string;
        sizeBytes: number;
        contentType: string;
    }>;
    export const assets: Readonly<{
        upload(blob: Blob, opts?: {
            type?: string;
        }): Promise<Asset>;
        list(): Promise<Readonly<{
            assets: readonly Asset[];
            usage: Readonly<{
                files: number;
                bytes: number;
                maxFiles: number;
                maxBytes: number;
            }>;
        }>>;
        delete(ref: string): Promise<Readonly<{
            deleted: boolean;
        }>>;
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
    /** A document of a bound store, as stores.open(alias) reads it. */
    export type StoreDoc<T = Record<string, unknown>> = Readonly<{
        path: string;
        exists: true;
        version: number;
        body: T;
    } | {
        path: string;
        exists: false;
    }>;
    /** A file of a bound store's main snapshot. */
    export type StoreFile = Readonly<{
        path: string;
        sha256: string;
        size: number;
        type: string;
    }>;
    /** A store of a type the visitor can open (stores.list). */
    export type StoreListing = Readonly<{
        id: string;
        app: string;
        level: string;
        mine: boolean;
        createdAt: number;
        title?: string;
    }>;
    /** stores.open(alias): reads of a store bound to this app, as the visitor. */
    export interface BoundStore {
        doc<T = Record<string, unknown>>(path: string): Promise<StoreDoc<T>>;
        query<T = Record<string, unknown>>(coll: string, query?: {
            filters?: {
                field: string;
                op: string;
                value: unknown;
            }[];
            order?: string;
            desc?: boolean;
            limit?: number;
        }): Promise<{
            docs: (StoreDoc<T> & {
                exists: true;
            })[];
        }>;
        file(path: string): Promise<Readonly<{
            path: string;
            type: string;
            text: string;
        }>>;
        files(): Promise<readonly StoreFile[]>;
    }
    export function slop(h: Hello): {
        actions: Record<string, (args?: unknown) => Promise<unknown>>;
        call: (action: string, args?: unknown) => Promise<unknown>;
        stores: {
            open: (alias: string) => BoundStore;
            list: (o: {
                type: string;
                title?: string;
            }) => Promise<readonly StoreListing[]>;
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
    import { type Body } from "slop:page/util";
    /** Snapshot metadata: hasPendingWrites while this view's write is on its way. */
    export type SnapshotMetadata = {
        readonly fromCache: boolean;
        readonly hasPendingWrites: boolean;
    };
    /** A document as read: data() is undefined when it does not exist. */
    export interface DocumentSnapshot<T = Body> {
        readonly id: string;
        readonly exists: boolean;
        data(): T | undefined;
        readonly metadata: SnapshotMetadata;
    }
    /** How a collection's result changed since the last snapshot. */
    export interface DocumentChange<T = Body> {
        readonly type: "added" | "modified" | "removed";
        readonly doc: DocumentSnapshot<T>;
        readonly oldIndex: number;
        readonly newIndex: number;
    }
    /** A query's result. */
    export interface QuerySnapshot<T = Body> {
        readonly docs: readonly DocumentSnapshot<T>[];
        readonly size: number;
        readonly empty: boolean;
        docChanges(): readonly DocumentChange<T>[];
        readonly metadata: SnapshotMetadata;
    }
    /** Stops a subscription. */
    export type Unsubscribe = () => void;
    /** The comparisons where() takes. */
    export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains";
    /** acquire's answer: the lease, or who holds it until when. */
    export type Lease = {
        acquired: true;
        version: number;
        expiresAt: string;
        holder: string;
    } | {
        acquired: false;
        expiresAt: string;
    };
    /** A document path ("notes/a"); reads and writes are calls to the server. */
    export interface DocumentReference<T = Body> {
        readonly id: string;
        readonly path: string;
        get(): Promise<DocumentSnapshot<T>>;
        /** Replaces the document. */
        set(data: T): Promise<void>;
        /** Merges fields into the document (nested objects merge too). */
        update(data: Partial<T>): Promise<void>;
        delete(): Promise<void>;
        /** A lease on the document for holder (ttlMs: default 30 s). */
        acquire(o: {
            holder: string;
            ttlMs?: number;
            data?: Body;
        }): Promise<Lease>;
        onSnapshot(next: (snap: DocumentSnapshot<T>) => void, error?: (e: unknown) => void): Unsubscribe;
        collection<U = Body>(sub: string): CollectionReference<U>;
    }
    /** A query over one collection, built with where, orderBy and limit. */
    export interface Query<T = Body> {
        where(field: keyof T & string | (string & {}), op: WhereOp, value: unknown): Query<T>;
        orderBy(field: keyof T & string | (string & {}), dir?: "asc" | "desc"): Query<T>;
        limit(n: number): Query<T>;
        get(): Promise<QuerySnapshot<T>>;
        onSnapshot(next: (snap: QuerySnapshot<T>) => void, error?: (e: unknown) => void): Unsubscribe;
    }
    /** A collection: a query over all of it, and its documents. */
    export interface CollectionReference<T = Body> extends Query<T> {
        readonly path: string;
        /** A document of the collection; without an id, a new random one. */
        doc(id?: string): DocumentReference<T>;
        /** Adds a document with a random id. */
        add(data: T): Promise<DocumentReference<T>>;
    }
    /** claude.use('db'): the app's document database. */
    export interface Db {
        doc<T = Body>(path: string): DocumentReference<T>;
        collection<T = Body>(path: string): CollectionReference<T>;
    }
    export const db: Db;
}
declare module "slop:page/room" {
    import { type Body } from "slop:page/util";
    type WirePeer = {
        peer: string;
        by: string | null;
        kind: string;
        guest: boolean;
        presence: Body;
        updatedAt: number;
    };
    type Peer = Readonly<WirePeer & {
        isMe: boolean;
        sameTab: boolean;
    }>;
    /** Someone in a room: a view (peer), whose person (by, null for a guest), and their presence. */
    export type RoomPeer = Peer;
    /** A moment someone emitted on a topic. */
    export type RoomMessage<T = unknown> = Readonly<{
        topic: string;
        data: T;
        peer: string;
        by: string | null;
        isMe: boolean;
        sameTab: boolean;
        kind: string;
        guest: boolean;
    }>;
    /** Who joined, left or changed their presence; peers is everyone now. */
    export type PeersChange = Readonly<{
        peers: readonly RoomPeer[];
        joined: readonly RoomPeer[];
        left: readonly RoomPeer[];
        updated: readonly RoomPeer[];
    }>;
    /** What every room offers: moments by topic, presence, the peers. Nothing persists. */
    export interface RoomChannel {
        /** Sends data (JSON) to whoever is in the room now; dropped while disconnected. */
        emit(topic: string, data?: unknown): Promise<void>;
        on<T = unknown>(topic: string, h: (m: RoomMessage<T>) => void, onError?: (e: unknown) => void): () => void;
        /** Merges into this view's presence; a null field removes it. */
        presence(patch: Record<string, unknown>): Promise<void>;
        peers(): readonly RoomPeer[];
        onPeers(h: (c: PeersChange) => void, onError?: (e: unknown) => void): () => void;
        connected(): boolean;
        onConnection(h: (connected: boolean) => void, onError?: (e: unknown) => void): () => void;
    }
    /** A named room (lobby.join(name)). */
    export interface NamedRoom extends RoomChannel {
        readonly name: string;
        leave(): Promise<void>;
    }
    /** claude.use('room'): the lobby, everyone on this target, and the way into named rooms. */
    export interface Lobby extends RoomChannel {
        join(name: string): Promise<NamedRoom>;
        sendToClaudeSession(data: Record<string, unknown>, opts?: {
            deliver?: "stage" | "send";
            attachPresence?: boolean;
        }): Promise<Readonly<Record<string, unknown>>>;
        canSendToClaudeSession(): Promise<string>;
    }
    export function lobby(): Promise<Lobby>;
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
    /** What sampling allows this view now; without the server's answer, only maxPromptBytes. */
    export type SampleLimits = Readonly<{
        maxPromptBytes: number;
        available?: boolean;
        allowed?: boolean;
        remaining?: number | null;
        modelTiers?: readonly string[];
        models?: readonly Readonly<Record<string, unknown>>[];
        tools?: Readonly<{
            maxCount: number;
        }>;
        images?: Readonly<{
            maxCount: number;
            maxInputBytes: number;
            mediaTypes: readonly string[];
        }>;
    }>;
    export function sample(h: Hello): ((input: unknown, o?: Options) => Promise<Result>) & {
        json: (input: unknown, o?: Options) => Promise<unknown>;
        limits: () => Promise<SampleLimits>;
    };
}
declare module "slop:page/types" {
    import type { artifact, assets, Comments, downloads, files, permissions, slop, User } from "slop:page/caps";
    import type { Db } from "slop:page/db";
    import type { Lobby } from "slop:page/room";
    import type { sample } from "slop:page/sample";
    /** What claude.use(name) resolves to, when this view may use it. */
    export interface Capabilities {
        db: Db;
        user: User;
        /** The lobby; lobby.join(name) enters a named room. */
        room: Lobby;
        comments: Comments;
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
