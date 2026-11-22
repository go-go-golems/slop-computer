// Permissions (the contract's permissions namespace) and consent. This is
// the only module that knows the viewer's permission states. A capability
// gets a Grant bound to its own name when it is built (index.ts), so no
// capability can ask for another's consent: there is no consent(name) to
// call with the wrong name (SLOP3-025 design 02).
import { ask, boot, connect, type Hello } from "./transport.ts";
import { fail, freeze } from "./util.ts";

let states: Record<string, string> = {};
const denied = new Set<string>(); // a "no" is final for the page load

export function initPermissions(h: Hello | null) {
  states = { ...(h?.permissions ?? {}) };
}

function stateOf(name: string): string {
  if (denied.has(name)) return "denied";
  return states[name] ?? "unavailable";
}

/** Asks the shell's dialog for capabilities still at "prompt". */
async function request(names?: readonly string[]): Promise<Record<string, string>> {
  const want = (names ?? Object.keys(states)).filter((n) => stateOf(n) === "prompt");
  if (want.length) {
    try {
      const res = await ask("consent", { names: want, app: boot.runtime?.app });
      const got = (res.states ?? {}) as Record<string, string>;
      for (const n of want) {
        if (got[n] === "granted") states[n] = "granted";
        else denied.add(n);
      }
    } catch {
      for (const n of want) denied.add(n);
    }
  }
  const out: Record<string, string> = {};
  for (const n of names ?? Object.keys(states)) out[n] = stateOf(n);
  return freeze(out);
}

/** Before a capability call that needs consent: asks once, then holds. */
async function consent(name: string, code = "not_granted") {
  if (stateOf(name) === "granted") return;
  const r = await request([name]);
  if (r[name] !== "granted") throw fail(code, `the viewer has not allowed ${name}`);
}

/** A capability's consent, bound to its own name. */
export type Grant = { readonly name: string; consent(code?: string): Promise<void> };

/** The grant a capability is built with; only index.ts's resolve calls it,
 *  with the name being resolved (test/consent.test.ts checks). */
export function grantFor(name: string): Grant {
  return Object.freeze({ name, consent: (code?: string) => consent(name, code) });
}

export const permissions = Object.freeze({
  async state(name?: string) {
    await connect();
    if (typeof name === "string") return stateOf(name);
    const out: Record<string, string> = {};
    for (const n of Object.keys(states)) out[n] = stateOf(n);
    return freeze(out);
  },
  async request(names?: readonly string[]) {
    await connect();
    return request(names);
  },
  async manage() {
    try {
      await ask("permissions", {});
    } catch {
      throw fail("unavailable", "the permissions panel did not open");
    }
  },
});
