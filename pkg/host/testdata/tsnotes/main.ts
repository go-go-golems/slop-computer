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
