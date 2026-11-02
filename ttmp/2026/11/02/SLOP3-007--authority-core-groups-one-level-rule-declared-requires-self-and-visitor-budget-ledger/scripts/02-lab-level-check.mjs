const { Access } = await import(process.argv[2]);
const people = { ana: { id: 'ana', kind: 'user', role: 'pending' }, bo: { id: 'bo', kind: 'user', role: 'member' }, cy: { id: 'cy', kind: 'user', role: 'disabled' }, ad: { id: 'ad', kind: 'user', role: 'admin' } };
const stores = { s: { owner: 'ana', app: null }, t: { owner: 'ad', app: null } };
const grants = [{ store: 't', subject: 'bo', level: 'owner', via: 'direct' }, { store: 't', subject: '*anyone', level: 'view', via: 'direct' }];
const db = {
  kone: (q, a) => q.includes('FROM principals') ? people[a[0]] : stores[a[0]],
  kall: (q, a) => grants.filter(g => g.store === a[0] && a.slice(1).includes(g.subject)),
};
const acc = new Access({ system: { db } });
const cases = [['ana', 's', 'interact'], ['bo', 't', 'admin'], ['cy', 't', 'none'], ['ad', 't', 'owner'], ['ana', 't', 'view']];
let bad = 0;
for (const [who, st, want] of cases) {
  const got = acc.level(people[who], st).level;
  console.log(who, st, got, got === want ? 'ok' : 'WANT ' + want); if (got !== want) bad++;
}
process.exit(bad);
