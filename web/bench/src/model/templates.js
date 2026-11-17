// model/templates.js — what a new app starts with.
//
// A template is a set of files for a new app store (committed to its draft
// by Projects.create) and the frames its canvas opens with. Every template
// is a working slop app: app.json, a page that uses the runtime
// (window.claude), and, where it needs one, an actor with SQL migrations.
// New apps are TypeScript (SLOP3-024): the server compiles .ts files, and
// `slop types` gives the declarations to check them with tsc. pkg/host's
// TestTemplateTypes runs every template and type-checks it.
//
// Public API: APP_TEMPLATES [{id, name, blurb, files({id, title}) → {path:
// text}, frames}].

const esc = s => String(s).replace(/[<&"]/g, '')

// page is the entry page: its script is main.ts, which the server
// compiles to JavaScript when it serves it.
const page = (title, body) => `<!doctype html>
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
<script type="module" src="main.ts"></script>
</body>
</html>
`

// TYPES is the README's part on checking the types.
const TYPES = `Files are TypeScript; the server compiles them (types are stripped, not
checked). To check them, pull the app and run \`slop types <app>\`: it writes
the declarations into \`.slop/types/\` and the tsconfig files, then
\`tsc -p tsconfig.json\` checks the pages`

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
<ul id="list"></ul>`),
      'main.ts': `// The page: notes in the app's document database.
interface Note {
  text: string
  at: number
}

const db = await claude.use('db')
const list = document.querySelector<HTMLUListElement>('#list')!
const form = document.querySelector<HTMLFormElement>('#add')!

async function show() {
  if (!db) return
  const snap = await db.collection<Note>('notes').orderBy('at').get()
  list.replaceChildren(...snap.docs.map(d => {
    const li = document.createElement('li')
    li.textContent = d.data()?.text ?? ''
    return li
  }))
}

form.addEventListener('submit', async e => {
  e.preventDefault()
  const input = form.elements.namedItem('text') as HTMLInputElement
  const text = input.value.trim()
  if (!text || !db) return
  const note: Note = { text, at: Date.now() }
  await db.collection<Note>('notes').add(note)
  form.reset()
  await show()
})
await show()
`,
      'styles.css': STYLES,
      'README.md': `# ${esc(title)}

A slop app: \`app.json\` is its manifest, \`index.html\` its page, and
\`main.ts\` the page's script. It keeps notes in the app's document database
(\`claude.use('db')\`).

${TYPES}.

Edits in the bench go to the \`draft\` ref and your dev instance runs them;
publishing moves \`main\`, which production instances run.
`,
    }),
  },
  {
    id: 'actor', name: 'Page and actor', blurb: 'A page that calls its actor, which keeps rows in SQL (a migration in sql/).',
    frames: [{ route: 'index.html', w: 1024, h: 700 }, { route: 'index.html', w: 375, h: 700 }],
    files: ({ title }) => ({
      'app.json': JSON.stringify({ title: esc(title), page: 'index.html', actor: 'actor.ts', capabilities: { user: {} } }, null, 2) + '\n',
      'api.ts': `// The contract between the page and the actor: types only. Both sides
// import it with \`import type\`, so a change here is checked on both.
export type Item = {
  id: number
  text: string
  by: string
  at: number
}

export interface Actions {
  list(args: {}): Item[]
  add(args: { text: string }): { added: string }
}
`,
      'actor.ts': `// The app's server half: actions the page calls, rows in SQL.
import type { Actions, Item } from './api.ts'

const sql = use('sql')

defineActor({
  actions: {
    list: {
      requires: 'view',
      run(ctx) {
        return sql.all('SELECT id, text, by, at FROM items ORDER BY at DESC LIMIT 100') as Item[]
      },
    },
    add: {
      requires: 'interact',
      run(ctx, { text }) {
        const t = String(text || '').trim().slice(0, 500)
        if (!t) ctx.fail('invalid_argument', 'text is empty')
        sql.run('INSERT INTO items (text, by, at) VALUES (?, ?, ?)', t, ctx.visitor.name || ctx.visitor.id || 'someone', Date.now())
        return { added: t }
      },
    },
  },
} satisfies ActorOf<Actions>)
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
<ul id="list"></ul>`),
      'main.ts': `// The page: it calls the actor's actions, typed by the contract in api.ts.
import type { Actions } from './api.ts'

const slop = await claude.use<Actions>('slop')
const list = document.querySelector<HTMLUListElement>('#list')!
const form = document.querySelector<HTMLFormElement>('#add')!

async function show() {
  if (!slop) return
  const rows = await slop.actions.list({})
  list.replaceChildren(...rows.map(r => {
    const li = document.createElement('li')
    li.textContent = r.text + ' · ' + r.by
    return li
  }))
}

form.addEventListener('submit', async e => {
  e.preventDefault()
  if (!slop) return
  const input = form.elements.namedItem('text') as HTMLInputElement
  await slop.actions.add({ text: input.value })
  form.reset()
  await show()
})
await show()
`,
      'styles.css': STYLES,
      'README.md': `# ${esc(title)}

A slop app with an actor: the page (\`index.html\`, \`main.ts\`) calls the
actions in \`actor.ts\`, which keeps rows in SQL (\`sql/001_items.sql\`).
\`api.ts\` is their contract: the actor implements it
(\`satisfies ActorOf<Actions>\`), and the page calls it
(\`claude.use<Actions>('slop')\`).

${TYPES}, and \`tsc -p tsconfig.actor.json\` the actor.

Edits in the bench go to the \`draft\` ref and your dev instance runs them;
publishing moves \`main\`, which production instances run (their migrations
run then).
`,
    }),
  },
]
