import { chromium } from '/home/manuel/.claude/jobs/3f423ad3/tmp/bd/benchdrive/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const src = fs.readFileSync(process.argv[2], 'utf8'), a = src.indexOf('  // qsa:begin'), b = src.indexOf('  // qsa:end')
const fn = src.slice(a, b)
const b0 = await chromium.launch(), p = await b0.newPage()
await p.setContent(`<div id=shifts>
 <article class=shift><h2>Pack boxes</h2><form class=signup><input name=name value=a></form><div class=tools><button>Edit</button></div></article>
 <article class=shift><h2>Greet clients</h2><form class=signup><input name=name value=b></form><div class=tools><button>Edit</button></div></article>
</div><button class=primary>Add item</button>`)
const res = await p.evaluate(fn => {
  eval(fn + '; window.qsa = qsa')
  const v = q => { try { return window.qsa(q).map(e => e.tagName.toLowerCase() + (e.value ? '=' + e.value : '') + (e.tagName === 'ARTICLE' ? ':' + e.querySelector('h2').textContent : '')) } catch (e) { return 'ERR ' + e.message } }
  return {
    trailing: v('button:has-text("Add")'),
    textAlias: v('button:text("Add")'),
    middle: v('article.shift:has-text("Pack boxes") form.signup input[name="name"]'),
    insideHas: v('article.shift:has(h2:has-text("Greet clients")) form.signup input[name="name"]'),
    insideHasChild: v('article:has(> h2:has-text("Pack")) .tools button'),
    plain: v('#shifts article:nth-of-type(2) input'),
    bad: v('article[[['),
    noMatch: v('article:has-text("Nope") input'),
  }
}, fn)
console.log(JSON.stringify(res, null, 1)); await b0.close()
