// ---------- templates: a fresh "repository" for a new project ----------
const T_COFFEE = {
  'README.md': `# Corner Coffee

An order-ahead site for a neighbourhood coffee bar: four pages, two tables, one shared script.

## Pages

| Page | What it does |
|---|---|
| [index.html](index.html) | Hero, hours, today's picks from the \`menu\` table |
| [menu.html](menu.html) | Menu with category filters and Add buttons |
| [cart.html](cart.html) | Cart lines, quantities, checkout form |
| [orders.html](orders.html) | Barista queue: mark orders ready, then collected |

## Data

- \`menu\`: id, name, cat (coffee, tea, bakery), price, desc, tag (\`pick\` puts it on the home page)
- \`orders\`: id, name, items, total, status (new, ready, collected)

## How pages reach the data

[app.js](app.js) runs on every page and switches on \`body[data-page]\`.

- \`site.db.rows('menu')\` reads a table, \`site.db.insert\` and \`site.db.update\` write one, and \`site.db.on('orders', fn)\` repaints when it changes.
- The cart lives in \`site.store\` under \`cart\`. Every frame on the canvas shares it, so adding an item in the menu frame updates the cart frame.

## Known issues

- [ ] The category buttons overflow at 375px (\`.cats\` in [styles.css](styles.css)). The health pill shows it.
- [ ] No way to mark an item sold out.

## Ideas

- An About page with opening hours kept in a table
- Tell the customer on the cart page when their order is ready
`,
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="home">
  <header class="top">
    <a class="logo" href="index.html">Corner</a>
    <nav>
      <a href="menu.html">Menu</a>
      <a href="cart.html">Cart <span class="badge" id="cartCount">0</span></a>
    </nav>
  </header>
  <main>
    <section class="hero">
      <p class="kicker">Open 7–17 · Corner of 5th &amp; Pine</p>
      <h1>Small batch coffee, poured slowly.</h1>
      <p class="lede">Order ahead and skip the line. We roast on Mondays and bake every morning.</p>
      <a class="cta" href="menu.html">See the menu</a>
    </section>
    <section class="today">
      <h2>Today's picks</h2>
      <ul class="picks" id="picks"></ul>
    </section>
  </main>
  <footer class="foot">Corner Coffee · 12 Pine St</footer>
  <script src="app.js"></script>
</body>
</html>
`,
  'menu.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Menu · Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="menu">
  <header class="top">
    <a class="logo" href="index.html">Corner</a>
    <nav>
      <a href="menu.html" class="on">Menu</a>
      <a href="cart.html">Cart <span class="badge" id="cartCount">0</span></a>
    </nav>
  </header>
  <main>
    <h1>Menu</h1>
    <div class="cats" id="cats">
      <button class="cat on" data-cat="all">Everything</button>
      <button class="cat" data-cat="coffee">Coffee</button>
      <button class="cat" data-cat="tea">Tea &amp; other</button>
      <button class="cat" data-cat="bakery">Bakery</button>
    </div>
    <ul class="items" id="items"></ul>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'cart.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cart · Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="cart">
  <header class="top">
    <a class="logo" href="index.html">Corner</a>
    <nav>
      <a href="menu.html">Menu</a>
      <a href="cart.html" class="on">Cart <span class="badge" id="cartCount">0</span></a>
    </nav>
  </header>
  <main>
    <h1>Your order</h1>
    <ul class="lines" id="lines"></ul>
    <p class="total">Total <b id="total">$0.00</b></p>
    <form id="checkout" class="checkout">
      <label>Name for the cup <input name="name" required placeholder="Sam"></label>
      <button class="cta" type="submit">Place order</button>
    </form>
    <p class="done" id="done" hidden></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'orders.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orders · Corner Coffee</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body data-page="orders" class="staff">
  <header class="top">
    <a class="logo" href="index.html">Corner · bar</a>
    <nav><a href="orders.html" class="on">Orders</a></nav>
  </header>
  <main>
    <h1>Open orders</h1>
    <table class="queue">
      <thead><tr><th>#</th><th>Name</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody id="queue"></tbody>
    </table>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `/* Corner Coffee */
:root {
  --ink: #2b211b;
  --paper: #fbf7f1;
  --crema: #9b5b25;
  --line: #e6dccf;
  --muted: #7a6a5d;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.5 Georgia, "Times New Roman", serif;
  color: var(--ink);
  background: var(--paper);
}
a { color: inherit; }
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
}
.logo { font-weight: 700; font-size: 20px; text-decoration: none; letter-spacing: .02em; }
.top nav { display: flex; gap: 18px; }
.top nav a { text-decoration: none; color: var(--muted); }
.top nav a.on { color: var(--ink); border-bottom: 2px solid var(--crema); }
.badge {
  display: inline-block;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--crema);
  color: #fff;
  font: 12px/20px Arial, sans-serif;
  text-align: center;
}
main { padding: 20px; max-width: 760px; margin: 0 auto; }
h1 { font-size: 30px; line-height: 1.15; margin: 8px 0 16px; }
h2 { font-size: 20px; margin: 28px 0 10px; }
.hero { padding: 28px 0 8px; }
.kicker { color: var(--crema); font: 13px Arial, sans-serif; text-transform: uppercase; letter-spacing: .08em; margin: 0; }
.lede { color: var(--muted); max-width: 32em; }
.cta {
  display: inline-block;
  background: var(--ink);
  color: var(--paper);
  border: 0;
  padding: 12px 20px;
  border-radius: 4px;
  font: 15px Arial, sans-serif;
  text-decoration: none;
  cursor: pointer;
}
.picks, .items, .lines { list-style: none; padding: 0; margin: 0; }
.picks li, .items li, .lines li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.item-name { font-weight: 700; }
.item-desc { color: var(--muted); font-size: 14px; display: block; }
.price { font: 15px Arial, sans-serif; white-space: nowrap; }
.add {
  border: 1px solid var(--ink);
  background: none;
  border-radius: 4px;
  padding: 6px 12px;
  font: 14px Arial, sans-serif;
  cursor: pointer;
}
.add:hover { background: var(--ink); color: var(--paper); }
.cats { display: flex; gap: 8px; margin-bottom: 12px; }
.cat {
  min-width: 128px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 18px;
  font: 14px Arial, sans-serif;
  cursor: pointer;
}
.cat.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.qty { display: inline-flex; gap: 6px; align-items: center; font-family: Arial, sans-serif; }
.qty button { width: 26px; height: 26px; border: 1px solid var(--line); background: #fff; border-radius: 13px; cursor: pointer; }
.total { display: flex; justify-content: space-between; font-size: 18px; }
.checkout { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.checkout label { display: flex; flex-direction: column; gap: 4px; font: 14px Arial, sans-serif; color: var(--muted); }
.checkout input { font: 16px Arial, sans-serif; padding: 10px; border: 1px solid var(--line); border-radius: 4px; }
.done { background: #fff; border: 1px solid var(--line); padding: 14px; border-radius: 4px; }
.empty { color: var(--muted); }
.foot { padding: 24px 20px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); margin-top: 40px; }
.staff { font-family: Arial, sans-serif; }
.queue { width: 100%; border-collapse: collapse; font-size: 14px; }
.queue th, .queue td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); }
.status { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.status.ready { color: #2e7d32; }
`,
  'app.js': `// Corner Coffee — shared page script.
// site.db talks to the project's tables; site.store is a small key/value
// store shared by every frame of this project (the cart lives there).
const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2)
const page = document.body.dataset.page

function cart() { return site.store.get('cart', []) }
function saveCart(c) { site.store.set('cart', c) }
function cartCount() { return cart().reduce((n, l) => n + l.qty, 0) }

function paintBadge() {
  const b = document.getElementById('cartCount')
  if (b) b.textContent = cartCount()
}
site.store.on('cart', paintBadge)
paintBadge()

function addToCart(item) {
  const c = cart()
  const line = c.find(l => l.id === item.id)
  if (line) line.qty += 1
  else c.push({ id: item.id, name: item.name, price: item.price, qty: 1 })
  saveCart(c)
}

async function home() {
  const rows = await site.db.rows('menu')
  const picks = rows.filter(r => r.tag === 'pick')
  document.getElementById('picks').innerHTML = picks.map(r =>
    '<li><span><span class="item-name">' + r.name + '</span><span class="item-desc">' + r.desc + '</span></span>' +
    '<span class="price">' + money(r.price) + '</span></li>').join('')
}
if (page === 'home') site.db.on('menu', home)

async function menu() {
  let rows = await site.db.rows('menu')
  const list = document.getElementById('items')
  let cat = 'all'
  function paint() {
    const shown = rows.filter(r => cat === 'all' || r.cat === cat)
    list.innerHTML = shown.map(r =>
      '<li><span><span class="item-name">' + r.name + '</span><span class="item-desc">' + r.desc + '</span></span>' +
      '<span class="price">' + money(r.price) + '</span>' +
      '<button class="add" data-id="' + r.id + '">Add</button></li>').join('')
  }
  document.getElementById('cats').addEventListener('click', e => {
    const b = e.target.closest('.cat'); if (!b) return
    cat = b.dataset.cat
    document.querySelectorAll('.cat').forEach(x => x.classList.toggle('on', x === b))
    paint()
  })
  list.addEventListener('click', e => {
    const b = e.target.closest('.add'); if (!b) return
    addToCart(rows.find(r => String(r.id) === b.dataset.id))
    b.textContent = 'Added'
    setTimeout(() => { b.textContent = 'Add' }, 900)
  })
  site.db.on('menu', async () => { rows = await site.db.rows('menu'); paint() })
  paint()
}

function cartPage() {
  const lines = document.getElementById('lines')
  function paint() {
    const c = cart()
    lines.innerHTML = c.length ? c.map(l =>
      '<li><span class="item-name">' + l.name + '</span>' +
      '<span class="qty"><button data-d="-1" data-id="' + l.id + '">−</button>' + l.qty +
      '<button data-d="1" data-id="' + l.id + '">+</button></span>' +
      '<span class="price">' + money(l.price * l.qty) + '</span></li>').join('')
      : '<li class="empty">Nothing here yet. <a href="menu.html">Browse the menu</a>.</li>'
    document.getElementById('total').textContent = money(c.reduce((s, l) => s + l.price * l.qty, 0))
  }
  lines.addEventListener('click', e => {
    const b = e.target.closest('button[data-d]'); if (!b) return
    const c = cart(), l = c.find(x => String(x.id) === b.dataset.id)
    l.qty += Number(b.dataset.d)
    saveCart(c.filter(x => x.qty > 0))
  })
  site.store.on('cart', paint)
  paint()
  document.getElementById('checkout').addEventListener('submit', async e => {
    e.preventDefault()
    const c = cart(); if (!c.length) return
    const name = new FormData(e.target).get('name')
    const order = await site.db.insert('orders', {
      name, items: c.map(l => l.qty + '× ' + l.name).join(', '),
      total: c.reduce((s, l) => s + l.price * l.qty, 0), status: 'new'
    })
    saveCart([])
    const done = document.getElementById('done')
    done.hidden = false
    done.textContent = 'Thanks ' + name + '! Order #' + order.id + ' is with the bar.'
  })
}

async function orders() {
  const body = document.getElementById('queue')
  async function paint() {
    const rows = (await site.db.rows('orders')).filter(o => o.status !== 'collected')
    body.innerHTML = rows.map(o =>
      '<tr><td>' + o.id + '</td><td>' + o.name + '</td><td>' + o.items + '</td><td>' + money(o.total) + '</td>' +
      '<td class="status ' + o.status + '">' + o.status + '</td>' +
      '<td><button class="add" data-id="' + o.id + '">' + (o.status === 'new' ? 'Ready' : 'Collected') + '</button></td></tr>').join('')
  }
  body.addEventListener('click', async e => {
    const b = e.target.closest('button[data-id]'); if (!b) return
    const rows = await site.db.rows('orders'), o = rows.find(r => String(r.id) === b.dataset.id)
    await site.db.update('orders', o.id, { status: o.status === 'new' ? 'ready' : 'collected' })
  })
  site.db.on('orders', paint)
  paint()
}

({ home, menu, cart: cartPage, orders })[page]?.()
`
}
const T_COFFEE_TABLES = {
  menu: { cols: ['id', 'name', 'cat', 'price', 'desc', 'tag'], rows: [
    { id: 1, name: 'Espresso', cat: 'coffee', price: 3, desc: 'Double shot, house blend', tag: '' },
    { id: 2, name: 'Flat white', cat: 'coffee', price: 4.5, desc: 'Silky milk, ristretto', tag: 'pick' },
    { id: 3, name: 'Filter of the week', cat: 'coffee', price: 4, desc: 'Ethiopia Guji, washed', tag: 'pick' },
    { id: 4, name: 'Chai latte', cat: 'tea', price: 4.5, desc: 'Spiced, steamed oat milk', tag: '' },
    { id: 5, name: 'Sencha', cat: 'tea', price: 3.5, desc: 'Green tea, second flush', tag: '' },
    { id: 6, name: 'Cardamom bun', cat: 'bakery', price: 3.75, desc: 'Baked at 6am', tag: 'pick' },
    { id: 7, name: 'Butter croissant', cat: 'bakery', price: 3.25, desc: 'Laminated in house', tag: '' }
  ] },
  orders: { cols: ['id', 'name', 'items', 'total', 'status'], rows: [
    { id: 1, name: 'Ana', items: '1× Flat white, 1× Cardamom bun', total: 8.25, status: 'new' }
  ] }
}

const T_LANDING = {
  'README.md': `# Tidewater landing page

A one-page waitlist site for a notes app.

- [index.html](index.html): hero, features, pricing, signup form
- [styles.css](styles.css): the whole look, one file
- [app.js](app.js): stores each signup with \`site.db.insert('signups', {email, source})\`

## To do

- [ ] Monthly / yearly pricing toggle
- [ ] FAQ section
- [ ] Check the features grid at phone width
`,
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tidewater — notes that file themselves</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="nav">
    <span class="mark">Tidewater</span>
    <a href="#pricing">Pricing</a>
    <a class="btn small" href="#signup">Get early access</a>
  </header>
  <section class="hero">
    <h1>Notes that file themselves.</h1>
    <p>Write anywhere. Tidewater sorts every note into the right project, links the people in it, and reminds you before it matters.</p>
    <a class="btn" href="#signup">Join the waitlist</a>
  </section>
  <section class="features">
    <article><h3>Auto-filing</h3><p>Every note lands in the project it belongs to, with no folders to keep.</p></article>
    <article><h3>People, linked</h3><p>Names become contacts, with every note about them a click away.</p></article>
    <article><h3>Gentle reminders</h3><p>Dates in your notes turn into nudges a day ahead.</p></article>
  </section>
  <section class="pricing" id="pricing">
    <h2>Pricing</h2>
    <div class="plans">
      <div class="plan"><h3>Free</h3><p class="amt">$0</p><p>500 notes, one device.</p></div>
      <div class="plan best"><h3>Pro</h3><p class="amt">$6<small>/mo</small></p><p>Unlimited notes, every device, reminders.</p></div>
    </div>
  </section>
  <section class="signup" id="signup">
    <h2>Get early access</h2>
    <form id="form">
      <input name="email" type="email" required placeholder="you@example.com">
      <button class="btn" type="submit">Join</button>
    </form>
    <p id="thanks" hidden>You're on the list. We'll write soon.</p>
  </section>
  <footer class="foot">© Tidewater</footer>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `:root { --ink: #0f2533; --sea: #1c7c8c; --foam: #eef6f7; --muted: #5d7480; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); }
.nav { display: flex; align-items: center; gap: 20px; padding: 16px 24px; }
.nav .mark { font-weight: 800; margin-right: auto; }
.nav a { color: var(--muted); text-decoration: none; }
.btn { display: inline-block; background: var(--sea); color: #fff; padding: 12px 22px; border-radius: 999px; border: 0; font: inherit; text-decoration: none; cursor: pointer; }
.btn.small { padding: 7px 14px; font-size: 14px; color: #fff; }
.hero { padding: 72px 24px 56px; background: var(--foam); text-align: center; }
.hero h1 { font-size: 48px; line-height: 1.05; margin: 0 0 16px; }
.hero p { max-width: 34em; margin: 0 auto 24px; color: var(--muted); }
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 48px 24px; max-width: 1000px; margin: 0 auto; }
.features h3 { margin: 0 0 6px; }
.features p { margin: 0; color: var(--muted); }
.pricing, .signup { padding: 40px 24px; text-align: center; }
.plans { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.plan { border: 1px solid #d5e4e8; border-radius: 12px; padding: 20px 28px; min-width: 220px; }
.plan.best { border-color: var(--sea); box-shadow: 0 0 0 1px var(--sea); }
.amt { font-size: 32px; font-weight: 800; margin: 4px 0; }
.amt small { font-size: 14px; color: var(--muted); }
form { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
input { font: inherit; padding: 11px 14px; border: 1px solid #c7d9de; border-radius: 999px; min-width: 260px; }
.foot { text-align: center; color: var(--muted); padding: 32px; font-size: 14px; }
`,
  'app.js': `// Tidewater landing — store signups in the "signups" table.
document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault()
  const email = new FormData(e.target).get('email')
  await site.db.insert('signups', { email, source: 'landing' })
  e.target.hidden = true
  document.getElementById('thanks').hidden = false
})
`
}
const T_LANDING_TABLES = { signups: { cols: ['id', 'email', 'source'], rows: [] } }

const T_BLANK = {
  'README.md': `# Untitled

A fresh project. Every \`.html\` file is a page; \`styles.css\` and \`app.js\` load into the pages that link them.

- Ask the agent to build something, or edit files in Code.
- Keep notes and plans in Markdown files: they render in the Docs panel.
`,
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Untitled</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>Hello</h1>
    <p>Start here, or ask the agent to build something.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
main { padding: 32px; max-width: 720px; margin: 0 auto; }
`,
  'app.js': `// Page script. site.db.rows(table), site.db.insert(table, row), site.store.get/set
`
}

const TEMPLATES = [
  { id: 'coffee', name: 'Corner Coffee', blurb: 'Menu, cart and a barista queue. Four pages, two tables, one layout bug at phone width.',
    files: T_COFFEE, tables: T_COFFEE_TABLES,
    frames: [{ route: 'index.html', w: 375, h: 720 }, { route: 'menu.html', w: 375, h: 720 }, { route: 'cart.html', w: 375, h: 720 }, { route: 'orders.html', w: 960, h: 600 }] },
  { id: 'landing', name: 'Landing page', blurb: 'A one-page waitlist site with a signup table.',
    files: T_LANDING, tables: T_LANDING_TABLES, frames: [{ route: 'index.html', w: 1200, h: 860 }, { route: 'index.html', w: 375, h: 760 }] },
  { id: 'blank', name: 'Blank', blurb: 'One page, an empty stylesheet and script. A fresh repository.',
    files: T_BLANK, tables: {}, frames: [{ route: 'index.html', w: 1024, h: 700 }, { route: 'index.html', w: 375, h: 700 }] }
]
