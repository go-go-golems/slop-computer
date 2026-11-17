// window.claude's type, for apps (SLOP3-024). Not part of the bundle:
// build.mjs emits the declarations of this file, and of what it imports,
// into pkg/doors/pages/assets/page.d.ts, which app.types returns and
// `slop types` writes into an app. The types are the implementation's own,
// so the declaration changes when the runtime does.
import type { artifact, assets, comments, downloads, files, permissions, slop, user } from "./caps.ts";
import type { db } from "./db.ts";
import type { lobby } from "./room.ts";
import type { sample } from "./sample.ts";

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
export type JsonOf<T> = T extends string | number | boolean | null
  ? T
  : T extends undefined | symbol | ((...args: any[]) => unknown)
    ? never
    : T extends { toJSON(): infer J }
      ? JsonOf<J>
      : T extends readonly (infer E)[]
        ? JsonOf<E>[]
        : T extends object
          ? { [K in keyof T as T[K] extends undefined | symbol | ((...args: any[]) => unknown) ? never : K]: JsonOf<T[K]> }
          : unknown;

/**
 * The page's side of an app's contract: each action of A (an interface the
 * actor implements with ActorOf<A>) as a call that resolves to its result,
 * as JSON.
 */
export type ActionsOf<A> = {
  [K in keyof A]: A[K] extends (args: infer P) => infer R
    ? undefined extends P
      ? (args?: P) => Promise<JsonOf<Awaited<R>>>
      : (args: P) => Promise<JsonOf<Awaited<R>>>
    : never;
};

/** The slop namespace with typed actions. */
export type SlopOf<A> = Omit<Capabilities["slop"], "actions"> & { actions: ActionsOf<A> };

/** Untyped actions: any name, any arguments. */
export type AnyActions = Record<string, (args?: any) => unknown>;

/** window.claude. */
export interface Claude {
  /** The slop namespace, its actions typed by the app's contract: claude.use<Actions>("slop"). */
  use<A = AnyActions>(name: "slop"): Promise<SlopOf<A> | null>;
  /** A capability's namespace, or null when this view may not use it (undeclared, or not allowed). */
  use<N extends keyof Capabilities>(name: N): Promise<Capabilities[N] | null>;
}
