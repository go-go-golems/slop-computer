import type { Actions } from './api.ts'

const slop = await claude.use<Actions>('slop')
const list = document.querySelector('#notes')!
if (slop && list) {
  await slop.actions.add({ text: 'from the page' })
  for (const n of await slop.actions.list({ max: 5 })) {
    const li = document.createElement('li')
    li.textContent = n.text + ' (' + n.at.slice(0, 10) + ')' // at arrives as a string
    list.append(li)
  }
}

// The document database, typed by what the app keeps in it.
interface Pin { text: string; at: number }
const db = await claude.use('db')
if (db) {
  await db.collection<Pin>('pins').add({ text: 'pinned', at: Date.now() })
  const snap = await db.collection<Pin>('pins').where('at', '>', 0).orderBy('at', 'desc').limit(5).get()
  for (const d of snap.docs) console.log(d.id, d.data()?.text)
}
