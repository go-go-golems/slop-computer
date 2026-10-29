// Builds Pinup for slop. Upstream build.js (dist/pinup.html, the claude.ai
// artifact) stays untouched; this adds slop/js/*.js to the module order and
// wraps the page in a document skeleton (slop serves index.html as written,
// the Artifact host wrapped it).
//   dist/slop/          the pinup tool        (slop push web/pinup/dist/slop -a pinup)
//   dist/slop-player/   the prototype player  (slop push web/pinup/dist/slop-player -a pinup-player)
// Both hold the same index.html; slop/js/00-slop.js reads the mode from the boot data.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const nodes = JSON.parse(fs.readFileSync(path.join(root, 'vendor/node_modules/lucide-static/icon-nodes.json'), 'utf8'));
const icons = {};
const ea = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
for (const [name, list] of Object.entries(nodes)) {
  icons[name] = list.map(([tag, attrs]) => '<' + tag + Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => ` ${k}="${ea(v)}"`).join('') + '/>').join('');
}
const mods = [['src', path.join(root, 'src')], ['slop/js', path.join(__dirname, 'js')]]
  .flatMap(([label, dir]) => fs.readdirSync(dir).filter(f => /^\d\d-.*\.js$/.test(f)).map(f => ({ label: label + '/' + f, file: path.join(dir, f), key: f })))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const js = mods.map(m => `// ===== ${m.label} =====\n` + fs.readFileSync(m.file, 'utf8')).join('\n');
// The bundle is inlined in a <script> element: a literal closing tag in any
// module would end it early (write <\/script> inside strings).
for (const m of mods) if (/<\/script/i.test(fs.readFileSync(m.file, 'utf8'))) throw new Error(m.label + ' contains </script>');
const iconJSON = JSON.stringify(icons).replace(/</g, '\\u003c');
const read = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${read('head.html')}
${read('body.html')}
<script type="application/json" id="icons">${iconJSON}</script>
<script>
(function () {
'use strict';
${js}
})();
</script>
</body>
</html>
`;
const manifests = {
  // An app on slop's runtime: designs are data artifacts with app = pinup.
  'slop': { title: 'Pinup', kind: 'page', capabilities: {
    db: {}, user: { scopes: ['profile'] }, room: {}, downloads: true, sample: {},
    slop: { permissions: ['artifacts:read', 'versions:read', 'versions:push', 'threads:write', 'routes:read', 'routes:write'] } } },
  // Read-only on a site route that binds target=<design>: static mode.
  'slop-player': { title: 'Pinup player', kind: 'page', capabilities: { db: {}, user: {} } },
};
for (const [dir, manifest] of Object.entries(manifests)) {
  const out = path.join(root, 'dist', dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), page);
  fs.writeFileSync(path.join(out, 'slop.json'), JSON.stringify(manifest, null, 2) + '\n');
}
fs.writeFileSync(path.join(root, 'dist/slop-check.js'), `'use strict';\n${js}`);
console.log('built slop', (page.length / 1024).toFixed(0) + ' KB', mods.length + ' modules', mods.filter(m => m.label.startsWith('slop/')).map(m => m.key).join(' '));
