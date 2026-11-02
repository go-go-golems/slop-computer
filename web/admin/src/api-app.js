// The back office as an app (build.mjs --app): the same interface as
// api.js, but every verb goes through the app's actor, whose system module
// calls it as the visiting person (SLOP3-002). Governance changes ask the
// person in the shell first; the runtime repeats the call once allowed.
/* global claude */
const slopP = claude.use('slop');
const userP = claude.use('user');
const dbP = claude.use('db');

export async function session() {
  const [slop, user] = await Promise.all([slopP, userP]);
  if (!slop) throw new Error('this page needs the slop runtime');
  const me = user ? await user.me() : null;
  const role = me?.audience === 'admin' ? 'admin' : me?.audience || 'guest';
  return { signedIn: !!me && !me.guest, person: { name: me?.name || '', email: me?.email || '', role } };
}

export async function call(verb, args = {}) {
  const slop = await slopP;
  try {
    return await slop.actions.verb({ name: verb, args });
  } catch (e) {
    const err = new Error(e.message);
    err.code = e.code || 'error';
    throw err;
  }
}

export const signOut = null; // the shell's bar signs out

export function signIn() { slopP.then((s) => s && s.signIn()); }

export async function hosts() { return call('server.hosts'); }

// onChange calls fn when the actor saw a change in the system log (its
// system:* reactor bumps ui/changed).
export function onChange(fn) {
  let off = () => {};
  let first = true;
  dbP.then((db) => {
    if (!db) return;
    off = db.doc('ui/changed').onSnapshot(() => { if (first) { first = false; return; } fn(); }, () => {});
  });
  return () => off();
}
