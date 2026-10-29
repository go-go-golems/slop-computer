const fs = require('fs'), path = require('path');
const src = path.join(__dirname, 'src');
const nodes = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor/node_modules/lucide-static/icon-nodes.json'), 'utf8'));
const icons = {};
const ea = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
for (const [name, list] of Object.entries(nodes)) {
  icons[name] = list.map(([tag, attrs]) => '<' + tag + Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => ` ${k}="${ea(v)}"`).join('') + '/>').join('');
}
const js = fs.readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort().map(f => `// ===== ${f} =====\n` + fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const iconJSON = JSON.stringify(icons).replace(/</g, '\\u003c');
const out = fs.readFileSync(path.join(src, 'head.html'), 'utf8') + '\n' + fs.readFileSync(path.join(src, 'body.html'), 'utf8') +
  `\n<script type="application/json" id="icons">${iconJSON}</script>\n<script>\n(function () {\n'use strict';\n${js}\n})();\n</script>\n`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/pinup.html'), out);
fs.writeFileSync(path.join(__dirname, 'dist/check.js'), `'use strict';\n${js}`);
console.log('built', (out.length / 1024).toFixed(0) + ' KB', Object.keys(icons).length + ' icons');
