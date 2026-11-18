import type { Actions, Note } from './api.ts'
import { toNote } from './server/rows.ts'
import * as yaml from 'yaml'

const sql = use('sql')
const db = use('db')
const workshop = use('workshop')

defineActor({
  actions: {
    list: {
      requires: 'view',
      run(ctx, { max }): Note[] {
        return sql.all('SELECT id, text, at FROM notes ORDER BY id DESC LIMIT ?', max ?? 20).map(toNote)
      },
    },
    add: {
      requires: 'interact',
      run(ctx, { text }) {
        const { lastRowid } = sql.run('INSERT INTO notes (text, at) VALUES (?, ?)', text, ctx.now)
        db.doc('meta/last').set({ id: lastRowid, by: ctx.visitor.name, as: yaml.stringify({ text }) })
        return { id: lastRowid }
      },
    },
    draftFiles: {
      requires: 'admin',
      async run(ctx, { store }) {
        const files = await workshop.files(store, 'draft')
        return files?.length ?? 0
      },
    },
  },
  http: {
    'GET /api/count': { level: 'public', run: () => ({ json: sql.one('SELECT count(*) AS n FROM notes') }) },
  },
} satisfies ActorOf<Actions>)
