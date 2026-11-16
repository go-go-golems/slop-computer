// ---------- slop: the bench's actor, app stores as projects, sync to draft (SLOP3-022) ----------
// On a slop server the page has an actor (apps/bench/actor.js) trusted with
// the workshop module. A project can then be an app store: its files are the
// app's tree at the draft ref, and every edit is pushed there; the bench's
// own documents keep only what Sitebench adds (threads, timeline, boards,
// proposals). Without an actor (a claude.ai artifact) Slop.on is false and
// the bench is Sitebench as it was.
const Slop = {
  on: false, actions: null, apps: [], ev: emitter(), error: '',

  async init() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        const s = await window.claude.use('slop')
        if (s && s.actions && typeof s.actions.apps === 'function') { this.actions = s.actions; this.on = true }
      }
    } catch (e) { this.on = false }
    if (this.on) this.refresh().catch(e => { this.error = e.message || String(e) })
    return this.on
  },
  async call(name, args) {
    if (!this.on) throw Object.assign(new Error('not on a slop server with the bench actor'), { kind: 'policy' })
    return await this.actions[name](args || {})
  },
  async refresh() { this.apps = (await this.call('apps')) || []; this.error = ''; this.ev.emit('apps'); return this.apps },
  app(id) { return this.apps.find(a => a.id === id) || null },

  // File texts at a ref, in as many reads as the actor's answer budget needs.
  async readAll(app, at, paths) {
    const texts = {}, binary = []
    let want = paths.slice()
    while (want.length) {
      const r = await this.call('read', { app, at, paths: want })
      Object.assign(texts, r.texts || {}); binary.push(...(r.binary || []))
      if (!r.more || !r.more.length || r.more.length === want.length) break
      want = r.more
    }
    return { texts, binary }
  }
}

// Files the bench never loads as text: they ride along in pushes by hash.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|wasm|mp3|mp4|m4a|webm|ogg|wav|mov|sqlite|db|bin)$/i
const textish = f => !BINARY_EXT.test(f.path) && f.size <= 240000

// Sync pushes the open app project's tree to its draft: changed files as
// text, the rest by the hash the server gave them. One push at a time; edits
// during a push are picked up by the next.
const Sync = {
  P: null, status: 'idle', error: '', n: null, act: null, timer: 0, busy: false, again: false, ev: emitter(),
  set(s, err = '') { this.status = s; this.error = err; this.ev.emit('status', s, err) },
  attach(P) { clearTimeout(this.timer); this.P = P; this.n = P && P.refs ? P.refs.draft : null; this.act = P && P.devStatus ? { n: P.devStatus.n, broken: P.devStatus.broken } : null; this.set(P ? 'synced' : 'idle') },
  schedule(P) {
    if (P !== this.P) return
    clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 300)
    if (this.status !== 'error') this.set('dirty')
  },
  async run() {
    const P = this.P
    if (!P || !P.meta.app) return
    if (this.busy) { this.again = true; return }
    this.busy = true; this.set('pushing')
    const sent = new Map(), files = []
    for (const [path, text] of P.files) {
      const t = P.tree.get(path)
      if (t && P.synced.get(path) === text) files.push({ path, sha256: t.sha256, size: t.size })
      else { files.push({ path, text }); sent.set(path, text) }
    }
    for (const [path, e] of P.extern) files.push({ path, sha256: e.sha256, size: e.size })
    const changed = [...sent.keys()], gone = [...P.synced.keys()].filter(p => !P.files.has(p))
    const message = 'bench: ' + [...changed, ...gone.map(p => '-' + p)].slice(0, 6).join(' ') + (changed.length + gone.length > 6 ? ' …' : '')
    try {
      const r = await Slop.call('sync', { app: P.meta.app, files, message })
      if (this.P !== P) return
      P.tree = new Map((r.files || []).map(f => [f.path, f]))
      for (const [path, text] of sent) P.synced.set(path, text)
      for (const p of gone) P.synced.delete(p)
      this.n = r.n; this.act = (r.activated || [])[0] || this.act
      P.refs = { ...(P.refs || {}), draft: r.n }
      this.set('synced'); P.ev.emit('sync', r)
    } catch (e) {
      this.set('error', (e && e.message) || String(e)); toast('Pushing to draft failed: ' + this.error, 5000)
    } finally { this.busy = false }
    if (this.again) { this.again = false; this.run() }
  },
  label() {
    const s = { idle: 'ready', dirty: 'unsaved', pushing: 'pushing…', synced: 'draft ' + (this.n ?? '–'), error: 'error' }[this.status] || this.status
    const a = this.act, dev = a ? (a.broken ? 'dev broken' : a.n === this.n ? 'dev ok' : 'dev on ' + a.n) : ''
    return { status: s, dev, title: this.error || (a && a.broken) || '' }
  }
}

// A new slop app: the smallest tree slop runs, a page and its manifest.
function slopAppFiles(title) {
  const t = title.replace(/[<&"]/g, '')
  return {
    'app.json': JSON.stringify({ title: t, page: 'index.html', capabilities: { db: {} } }, null, 2) + '\n',
    'index.html': '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + t + '</title>\n<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n<main>\n  <h1>' + t + '</h1>\n  <p>A new slop app.</p>\n</main>\n</body>\n</html>\n',
    'styles.css': 'body { font: 16px/1.5 system-ui, sans-serif; margin: 0; }\nmain { max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }\n',
    'README.md': '# ' + t + '\n\nA slop app. `app.json` is its manifest; `index.html` its page. Edits in the bench go to the `draft` ref; publishing moves `main`.\n'
  }
}
