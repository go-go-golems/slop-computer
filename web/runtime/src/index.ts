// window.claude: use(name) resolves a capability's namespace or null. The
// table comes from the view's hello (what this view may run), not from the
// page; nothing else is promised on window.claude.
import { artifact, assets, comments, downloads, initPermissions, permissions, slop, user } from "./caps.ts";
import { db } from "./db.ts";
import { lobby } from "./room.ts";
import { sample } from "./sample.ts";
import { staticDb, staticUser } from "./static.ts";
import { boot, connect, type Hello } from "./transport.ts";
import type { Body } from "./util.ts";

const memo = new Map<string, Promise<unknown>>();

async function resolve(name: string): Promise<unknown> {
  if (boot.mode === "static") {
    if (name === "db") return staticDb((boot.runtime?.docs ?? {}) as Record<string, Body>);
    if (name === "user") return staticUser;
    return null;
  }
  const h: Hello | null = await connect();
  initPermissions(h);
  if (name === "permissions") return permissions;
  if (!h) return null;
  if (name === "self") name = "artifact";
  if (!(name in h.caps)) return null;
  switch (name) {
    case "db":
      return db;
    case "user":
      return user(h);
    case "room":
      return lobby();
    case "comments":
      return comments(h);
    case "assets":
      return assets;
    case "downloads":
      return downloads;
    case "artifact":
      return artifact;
    case "sample":
      return sample(h);
    case "slop":
      return slop(h);
  }
  return null;
}

function use(name: string): Promise<unknown> {
  if (typeof name !== "string") return Promise.resolve(null);
  let p = memo.get(name);
  if (!p) {
    // Never within the page's first run: resolve after a macrotask.
    p = new Promise((r) => setTimeout(r, 0)).then(() => resolve(name)).catch((e) => {
      console.warn("claude.use(" + name + "):", e);
      return null;
    });
    memo.set(name, p);
  }
  return p;
}

const claude = Object.freeze({ use });
try {
  Object.defineProperty(window, "claude", { value: claude, writable: false, configurable: false, enumerable: true });
} catch {
  (window as unknown as { claude: unknown }).claude = claude;
}
