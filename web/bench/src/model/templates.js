// model/templates.js — what a new app starts with.
//
// A template is a set of files for a new app store (committed to its draft
// by Projects.create) and the frames its canvas opens with. Every template
// is a working slop app: app.json, a page that uses the runtime
// (window.claude), and, where it needs one, an actor with SQL migrations.
//
// Public API: APP_TEMPLATES [{id, name, blurb, files({id, title}) → {path:
// text}, frames}].

const esc = s => String(s).replace(/[<&"]/g, '')

const page = (title, body, script) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<main>
${body}
</main>
<script type="module">
${script}
</script>
</body>
</html>
`

const STYLES = `body { font: 16px/1.5 system-ui, sans-serif; margin: 0; color: #1a1a1a; }
main { max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
form { display: flex; gap: .5rem; margin: 1rem 0; }
input { flex: 1; font: inherit; padding: .4rem .6rem; border: 1px solid #bbb; }
button { font: inherit; padding: .4rem .9rem; border: 1px solid #1a1a1a; background: #fff; cursor: pointer; }
li { padding: .25rem 0; }
`

export const APP_TEMPLATES = [
  {
    id: 'blank', name: 'Page', blurb: 'One page that keeps its data in the app\'s document database.',
    frames: [{ route: 'index.html', w: 1024, h: 700 }, { route: 'index.html', w: 375, h: 700 }],
    files: ({ title }) => ({
      'app.json': JSON.stringify({ title: esc(title), page: 'index.html', capabilities: { db: {} } }, null, 2) + '\n',
      'index.html': page(esc(title), `<h1>${esc(title)}</h1>
<form id="add"><input name="text" placeholder="Something to remember" required><button>Add</button></form>
<ul id="list"></ul>`, `const db = await window.claude.use('db')
const list = document.getElementById('list')
async function show() {
  const snap = await db.collection('notes').get()
  list.replaceChildren(...snap.docs.map(d => Object.assign(document.createElement('li'), { textContent: d.data().text })))
}
document.getElementById('add').addEventListener('submit', async e => {
  e.preventDefault()
  const text = e.target.text.value.trim()
  if (!text) return
  await db.collection('notes').add({ text, at: Date.now() })
  e.target.reset()
  await show()
})
await show()`),
      'styles.css': STYLES,
      'README.md': `# ${esc(title)}

A slop app: \`app.json\` is its manifest, \`index.html\` its page. The page
keeps notes in the app's document database (\`window.claude.use('db')\`).

Edits in the bench go to the \`draft\` ref and your dev instance runs them;
publishing moves \`main\`, which production instances run.
`,
    }),
  },
  {
    id: 'actor', name: 'Page and actor', blurb: 'A page that calls its actor, which keeps rows in SQL (a migration in sql/).',
    frames: [{ route: 'index.html', w: 1024, h: 700 }, { route: 'index.html', w: 375, h: 700 }],
    files: ({ title }) => ({
      'app.json': JSON.stringify({ title: esc(title), page: 'index.html', actor: 'actor.js', capabilities: { user: {} } }, null, 2) + '\n',
      'actor.js': `// The app's server half: actions the page calls, rows in SQL.
const sql = use('sql');

defineActor({
  actions: {
    list: {
      requires: 'view',
      run(ctx) {
        return sql.all('SELECT id, text, by, at FROM items ORDER BY at DESC LIMIT 100');
      },
    },
    add: {
      requires: 'interact',
      run(ctx, { text }) {
        const t = String(text || '').trim().slice(0, 500);
        if (!t) ctx.fail('invalid_argument', 'text is empty');
        sql.run('INSERT INTO items (text, by, at) VALUES (?, ?, ?)', t, ctx.visitor.name || ctx.visitor.id, Date.now());
        return { added: t };
      },
    },
  },
});
`,
      'sql/001_items.sql': `-- The app's rows. A migration runs once per instance; change the schema
-- with a new file (sql/002_….sql), never by editing this one after it ran.
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
`,
      'index.html': page(esc(title), `<h1>${esc(title)}</h1>
<form id="add"><input name="text" placeholder="Add an item" required><button>Add</button></form>
<ul id="list"></ul>`, `const slop = await window.claude.use('slop')
const list = document.getElementById('list')
async function show() {
  const rows = await slop.actions.list({})
  list.replaceChildren(...rows.map(r => Object.assign(document.createElement('li'), { textContent: r.text + ' · ' + r.by })))
}
document.getElementById('add').addEventListener('submit', async e => {
  e.preventDefault()
  await slop.actions.add({ text: e.target.text.value })
  e.target.reset()
  await show()
})
await show()`),
      'styles.css': STYLES,
      'README.md': `# ${esc(title)}

A slop app with an actor: \`index.html\` calls the actions in \`actor.js\`,
which keeps rows in SQL (\`sql/001_items.sql\`).

Edits in the bench go to the \`draft\` ref and your dev instance runs them;
publishing moves \`main\`, which production instances run (their migrations
run then).
`,
    }),
  },
]
