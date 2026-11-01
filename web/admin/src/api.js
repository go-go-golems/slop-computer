// Every button in the back office is a call to /api/v1/<verb>: the UI holds
// no rules of its own. The session cookie authenticates; the CSRF token from
// /auth/session goes in a header. (api-app.js is the same interface for the
// back office built as an app: build.mjs --app.)
let csrf = '';

export async function session() {
  const r = await fetch('/auth/session', { credentials: 'same-origin' });
  const s = await r.json();
  csrf = s.csrf || '';
  return s;
}

export async function call(verb, args = {}) {
  const r = await fetch('/api/v1/' + verb, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(args),
  });
  let out = {};
  try { out = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || out.error) {
    const e = new Error(out.error?.message || r.statusText);
    e.code = out.error?.code || 'error';
    e.trace = out.error?.trace;
    throw e;
  }
  return out.result;
}

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  location.assign('/auth/login');
}

export function signIn() { location.assign('/auth/login?return=/'); }

// hosts are in the page's boot data.
export async function hosts() { return JSON.parse(document.getElementById('slop-admin').textContent).hosts; }

// onChange calls fn when the platform changed elsewhere (not tracked here).
export function onChange() { return () => {}; }
