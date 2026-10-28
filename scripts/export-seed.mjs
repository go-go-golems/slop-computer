// Exports the Workshop prototype's fake data (sources/workshop/seed.js) as
// files that `slop dev seed` pushes through the real API:
//   <out>/seed.json                     projects, artifacts, routes, threads
//   <out>/artifacts/<id>/v<n>/<files>   every version's file tree
// Usage: node scripts/export-seed.mjs <prototype dir> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: export-seed.mjs <prototype dir> <out dir>'); process.exit(1); }

// seed.js and boutique-css.js are browser scripts that assign to window.
const window = {};
const ctx = vm.createContext({ window, console });
for (const f of ['boutique-css.js', 'seed.js']) vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f });
const S = window.SLOP_SEED(Date.now());

fs.rmSync(out, { recursive: true, force: true });
const meta = { projects: S.projects, users: S.users.map(u => ({ id: u.id, name: u.name, role: u.role })), artifacts: [], routes: [], threads: [] };
for (const a of Object.values(S.artifacts)) {
  if (a.trust === 'shell') continue; // the Workshop's own screens are not artifacts in v1
  const entry = { id: a.id, title: a.title, kind: a.kind, type: a.type || '', viewer: a.viewer || '', project: a.project, versions: [] };
  for (const v of a.versions) {
    const dir = path.join(out, 'artifacts', a.id, 'v' + v.n);
    for (const [p, content] of Object.entries(v.files)) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), content);
    }
    entry.versions.push({ n: v.n, message: v.message, by: v.by, via: v.via, session: v.session || '', manifest: v.manifest || {} });
  }
  meta.artifacts.push(entry);
}
for (const r of S.routes) {
  if (r.host !== 'slop.boutique') continue;
  meta.routes.push({ path: r.path, page: r.page, version: r.version, record: r.record || '', access: r.access, bindings: r.bindings || {} });
}
for (const t of S.threads) {
  if (!meta.artifacts.some(a => a.id === t.artifact)) continue;
  meta.threads.push({ artifact: t.artifact, version: t.version, anchor: t.anchor, resolved: !!t.resolved,
    comments: t.comments.map(c => ({ by: c.by, agent: !!c.agent, version: c.version || null, text: c.text })) });
}
fs.writeFileSync(path.join(out, 'seed.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`exported ${meta.artifacts.length} artifacts, ${meta.artifacts.reduce((n, a) => n + a.versions.length, 0)} versions, ${meta.routes.length} routes, ${meta.threads.length} threads to ${out}`);
