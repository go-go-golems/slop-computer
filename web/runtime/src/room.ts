// The room capability: the lobby and named rooms of the target. Presence
// lives on the server per view and room; moments fan out to whoever is in
// the room now. Nothing persists.
import { limits } from "./limits.ts";
import { on, rpc, state } from "./transport.ts";
import { bytes, canon, depth, fail, freeze, isPlain, plain, type Body } from "./util.ts";

const topicRe = /^[a-z][a-z0-9_.-]{0,47}$/;
const roomRe = /^[a-z0-9][a-z0-9_.-]{0,47}$/;

type WirePeer = { peer: string; by: string | null; kind: string; guest: boolean; presence: Body; updatedAt: number };
type Peer = Readonly<WirePeer & { isMe: boolean; sameTab: boolean }>;

type Room = {
  name: string;
  joined: boolean;
  left: boolean;
  presence: Body;
  peers: readonly Peer[];
  topics: Map<string, Set<(m: unknown) => void>>;
  peerHandlers: Set<(c: unknown) => void>;
  connHandlers: Set<(c: boolean) => void>;
  errHandlers: Set<(e: unknown) => void>;
  api?: unknown;
};

const rooms = new Map<string, Room>();
const EMPTY: readonly Peer[] = Object.freeze([]);

function roomOf(name: string): Room {
  let r = rooms.get(name);
  if (!r) {
    r = { name, joined: false, left: false, presence: {}, peers: EMPTY, topics: new Map(), peerHandlers: new Set(), connHandlers: new Set(), errHandlers: new Set() };
    rooms.set(name, r);
  }
  return r;
}

function asPeer(p: WirePeer, prev?: Peer): Peer {
  const me = p.peer === state.view;
  if (prev && prev.updatedAt === p.updatedAt && canon(prev.presence) === canon(p.presence) && prev.isMe === me) return prev;
  return freeze({ ...p, presence: p.presence ?? {}, isMe: me, sameTab: me });
}

on("peers", (ev: { room: string; peers: WirePeer[] }) => {
  const r = rooms.get(ev.room);
  if (!r || r.left) return;
  const before = new Map(r.peers.map((p) => [p.peer, p]));
  const next = Object.freeze(ev.peers.map((p) => asPeer(p, before.get(p.peer))));
  const joined = next.filter((p) => !before.has(p.peer));
  const nextIds = new Set(next.map((p) => p.peer));
  const left = r.peers.filter((p) => !nextIds.has(p.peer));
  const updated = next.filter((p) => before.has(p.peer) && before.get(p.peer) !== p);
  r.peers = next;
  if (!joined.length && !left.length && !updated.length) return;
  const change = Object.freeze({ peers: next, joined: Object.freeze(joined), left: Object.freeze(left), updated: Object.freeze(updated) });
  for (const h of [...r.peerHandlers]) safe(() => h(change));
});

on("room", (ev: { room: string; topic: string; data: unknown; peer: string; by: string | null; kind: string; guest: boolean }) => {
  const r = rooms.get(ev.room);
  if (!r || r.left) return;
  const me = ev.peer === state.view;
  const msg = freeze({ topic: ev.topic, data: ev.data, peer: ev.peer, by: ev.by, isMe: me, sameTab: me, kind: ev.kind, guest: !!ev.guest });
  for (const h of [...(r.topics.get(ev.topic) ?? [])]) safe(() => h(msg));
});

on("connection", (c: boolean) => {
  for (const r of rooms.values()) if (!r.left) for (const h of [...r.connHandlers]) safe(() => h(c));
});

// A new view: join the rooms again and restore presence.
on("newview", () => {
  for (const r of rooms.values()) if (r.joined && !r.left) join(r).catch(() => {});
});

on("terminal", (code: string) => {
  for (const r of rooms.values()) {
    const e = fail(code, "this view was closed");
    for (const h of [...r.errHandlers]) safe(() => h(e));
    r.peers = EMPTY;
  }
});

function safe(fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(e);
  }
}

async function join(r: Room) {
  const res = await rpc<{ peers: WirePeer[] }>("room.join", { room: r.name });
  r.joined = true;
  if (Object.keys(r.presence).length) await rpc("room.presence", { room: r.name, patch: r.presence });
  if (r.peers === EMPTY) r.peers = Object.freeze(res.peers.map((p) => asPeer(p)));
}

function api(r: Room) {
  const check = () => {
    if (r.left) throw fail("invalid_argument", "you left this room");
    if (state.terminal) throw fail(state.terminal, "this view was closed");
  };
  const listen = <T>(set: Set<T>, h: T, onError?: (e: unknown) => void) => {
    if (typeof h !== "function") throw fail("invalid_argument", "a handler is a function");
    set.add(h);
    if (onError) r.errHandlers.add(onError);
    return () => {
      set.delete(h);
      if (onError) r.errHandlers.delete(onError);
    };
  };
  return {
    async emit(topic: string, data?: unknown) {
      check();
      if (typeof topic !== "string" || !topicRe.test(topic)) throw fail("invalid_argument", `a topic matches ${topicRe}`);
      const d = data === undefined ? null : plain(data);
      if (bytes(JSON.stringify(d)) > limits.MaxRoomData) throw fail("invalid_argument", `data is at most ${limits.MaxRoomData} bytes of JSON`);
      if (!state.connected) return; // dropped, never queued
      await rpc("room.emit", { room: r.name, topic, data: d });
    },
    on(topic: string, h: (m: unknown) => void, onError?: (e: unknown) => void) {
      if (!topicRe.test(topic)) throw fail("invalid_argument", `a topic matches ${topicRe}`);
      let set = r.topics.get(topic);
      if (!set) r.topics.set(topic, (set = new Set()));
      return listen(set, h, onError);
    },
    async presence(patch: Record<string, unknown>) {
      check();
      if (!isPlain(patch)) throw fail("invalid_argument", "presence takes a plain object");
      const next: Body = { ...r.presence };
      for (const [k, v] of Object.entries(plain(patch) as Body)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      if (bytes(JSON.stringify(next)) > limits.MaxPresence || depth(next) > 8)
        throw fail("invalid_argument", `presence is at most ${limits.MaxPresence} bytes and 8 levels`);
      r.presence = next;
      // Applied locally at once.
      r.peers = Object.freeze(r.peers.map((p) => (p.isMe ? freeze({ ...p, presence: next, updatedAt: Date.now() }) : p)));
      if (state.connected) await rpc("room.presence", { room: r.name, patch });
    },
    peers: () => r.peers,
    onPeers(h: (c: unknown) => void, onError?: (e: unknown) => void) {
      const off = listen(r.peerHandlers, h, onError);
      queueMicrotask(() => {
        if (r.peerHandlers.has(h) && r.peers !== EMPTY) safe(() => h(Object.freeze({ peers: r.peers, joined: r.peers, left: EMPTY, updated: EMPTY })));
      });
      return off;
    },
    connected: () => state.connected && !r.left,
    onConnection(h: (c: boolean) => void, onError?: (e: unknown) => void) {
      const off = listen(r.connHandlers, h, onError);
      queueMicrotask(() => r.connHandlers.has(h) && safe(() => h(state.connected)));
      return off;
    },
  };
}

export async function lobby() {
  const r = roomOf("");
  if (!r.api) {
    await join(r);
    const base = api(r);
    r.api = Object.freeze({
      ...base,
      async join(name: string) {
        if (typeof name !== "string" || !roomRe.test(name)) throw fail("invalid_argument", `a room name matches ${roomRe}`);
        const nr = roomOf(name);
        if (nr.api && !nr.left) return nr.api;
        nr.left = false;
        try {
          await join(nr);
        } catch (e: any) {
          throw e?.code === "limit_reached" ? e : fail(e?.code === "invalid_argument" ? e.code : "upstream_error", e?.message || "join failed");
        }
        nr.api = Object.freeze({
          name,
          ...api(nr),
          async leave() {
            if (nr.left) return;
            nr.left = true;
            nr.joined = false;
            nr.peers = EMPTY;
            nr.topics.clear();
            nr.peerHandlers.clear();
            nr.connHandlers.clear();
            await rpc("room.leave", { room: name }).catch(() => {});
          },
        });
        return nr.api;
      },
      async sendToClaudeSession(data: Record<string, unknown>, opts?: { deliver?: string; attachPresence?: boolean }) {
        if (!isPlain(data) || !Object.keys(data).length) throw fail("invalid_argument", "send a non-empty plain object");
        const body: Body = { ...(plain(data) as Body) };
        if (opts?.attachPresence !== false && Object.keys(r.presence).length) body.presence = r.presence;
        return Object.freeze(await rpc("room.sendToClaudeSession", { data: body, deliver: opts?.deliver === "send" ? "send" : "stage" }));
      },
      canSendToClaudeSession: () => rpc<string>("room.canSendToClaudeSession").catch(() => "off"),
    });
  }
  return r.api;
}
