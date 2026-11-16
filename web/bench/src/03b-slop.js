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

// How long flush waits for other pushes, and how many pushes it tries.
const FLUSH_WAIT = 60000, FLUSH_TRIES = 20

// Sync pushes app projects' trees to their drafts: changed files as text,
// the rest by the hash the server gave them. One push at a time; edits
// during a push are picked up by the next. The attached project (the open
// one) is what the header shows; a project let go with edits still
// unpushed (switched away from mid-eval, or one an agent turn still
// writes to) stays queued and is pushed all the same.
const Sync = {
  P: null, status: 'idle', error: '', n: null, act: null, timer: 0, busy: false, again: false, queue: new Set(), ev: emitter(),
  set(s, err = '') { this.status = s; this.error = err; this.ev.emit('status', s, err) },
  attach(P) { this.P = P; this.n = P && P.refs ? P.refs.draft : null; this.act = P && P.devStatus ? { n: P.devStatus.n, broken: P.devStatus.broken } : null; this.set(P ? 'synced' : 'idle') },
  soon() { clearTimeout(this.timer); if ([...this.queue].some(Q => !this.held(Q))) this.timer = setTimeout(() => this.runAll(), 300) },
  schedule(P) {
    if (!P || !P.meta.app) return
    this.queue.add(P); this.soon()
    if (P === this.P && this.status !== 'error') this.set('dirty')
  },
  // While an eval runs on P, P is not pushed: its writes may still roll
  // back. Each eval holds P with a token of its own (flush tells them
  // apart); releasing P's last hold pushes whatever then differs from its
  // draft. Other projects push as usual.
  hold(P) { const tok = {}; (P.syncHolds || (P.syncHolds = new Set())).add(tok); return tok },
  held(P) { return !!(P && P.syncHolds && P.syncHolds.size) },
  release(P, tok) {
    if (P.syncHolds) P.syncHolds.delete(tok)
    if (this.held(P)) return
    if (!this.pending(P)) { this.queue.delete(P); if (P === this.P && this.status === 'dirty') this.set('synced') }
    this.soon()
  },
  // every queued project not held, the attached one first
  async runAll() {
    for (const Q of [...this.queue].sort((a, b) => (b === this.P) - (a === this.P))) if (!this.held(Q)) await this.run(Q)
  },
  async run(P = this.P) {
    if (!P || !P.meta.app || this.held(P)) return
    if (this.busy || Outside.merging) { this.queue.add(P); this.again = true; return }
    this.queue.delete(P)
    if (!this.pending(P) && P.refs && P.refs.draft != null) { if (P === this.P && this.status !== 'error') this.set('synced'); return }
    this.busy = true; if (P === this.P) this.set('pushing')
    const sent = new Map(), files = []
    for (const [path, text] of P.files) {
      const t = P.tree.get(path)
      if (t && P.synced.get(path) === text) files.push({ path, sha256: t.sha256, size: t.size })
      else { files.push({ path, text }); sent.set(path, text) }
    }
    for (const [path, e] of P.extern) files.push({ path, sha256: e.sha256, size: e.size })
    const changed = [...sent.keys()], gone = [...new Set([...P.synced.keys(), ...P.tree.keys()])].filter(p => !P.files.has(p) && !P.extern.has(p))
    const message = 'bench: ' + [...changed, ...gone.map(p => '-' + p)].slice(0, 6).join(' ') + (changed.length + gone.length > 6 ? ' …' : '')
    try {
      const r = await Slop.call('sync', { app: P.meta.app, files, message, base: P.refs ? P.refs.draft ?? null : null })
      if (r.conflict) {   // draft moved under us: take what changed there, keep what changed here, push again
        await Outside.merge(P, r.n, r.files || [])
        this.queue.add(P); this.again = true
      } else {
        P.tree = new Map((r.files || []).map(f => [f.path, f]))
        for (const [path, text] of sent) P.synced.set(path, text)
        for (const p of gone) P.synced.delete(p)
        P.refs = { ...(P.refs || {}), draft: r.n }; P.syncError = ''; P.lastAct = (r.activated || [])[0] || P.lastAct || null
        if (this.pending(P)) this.queue.add(P)
        if (P === this.P) { this.n = r.n; this.act = P.lastAct || this.act; this.set(this.pending(P) ? 'dirty' : 'synced'); App.ev.emit('health') }
        P.ev.emit('sync', r)
      }
    } catch (e) {
      P.syncError = (e && e.message) || String(e)
      if (P === this.P) this.set('error', P.syncError)
      toast('Pushing ' + P.meta.app + ' to draft failed: ' + P.syncError, 5000)
    } finally { this.busy = false }
    if (this.again) { this.again = false; this.runAll() }
  },
  // Edits not yet in draft: a text that differs from what was last pushed,
  // or a file of draft's tree (text or hash-only) that is gone here.
  pending(P) {
    for (const [p, t] of P.files) if (P.synced.get(p) !== t) return true
    for (const p of P.synced.keys()) if (!P.files.has(p)) return true
    for (const p of P.tree.keys()) if (!P.files.has(p) && !P.extern.has(p)) return true
    return false
  },
  // Push P (default: the attached project) now and wait until every edit
  // made so far is in its draft (an eval's effects need the activation;
  // switching projects must not drop edits). A push that fails is not
  // retried in a loop: one try, then the error. If other pushes keep it
  // waiting past FLUSH_WAIT, it says so rather than answer with a draft
  // that lacks the edits.
  //
  // Evals still running on P hold it (their writes may roll back), and
  // nothing of P is pushed until the last hold ends. own lists the caller's
  // holds: its own (app.publish inside an eval) and those of the evals that
  // delegated to it, which cannot end before it does. While one of them
  // holds P, waiting is pointless: P stays queued for after them and the
  // result is deferred. Otherwise another eval's hold is waited for, up to
  // FLUSH_WAIT, and if it outlasts that the result says so: an eval that
  // ended while another still runs must not report the old draft as its
  // own. wait: false returns at once instead (switching projects does not
  // block on someone's eval; P stays queued).
  async flush(P = this.P, { own = [], wait = true } = {}) {
    if (!P || !P.meta.app) return { n: null, act: null, error: '', deferred: false }
    const mine = new Set(own), holders = () => [...(P.syncHolds || [])]
    const ours = () => holders().some(t => mine.has(t)), others = () => holders().some(t => !mine.has(t))
    let tries = 0, waited = ''
    for (const t0 = now(); ;) {
      const blocked = this.busy || Outside.merging ? 'push' : wait && others() && !ours() && this.pending(P) ? 'eval' : ''
      if (blocked) {
        if (now() - t0 > FLUSH_WAIT) { waited = blocked; break }
        await sleep(30); continue
      }
      if (this.held(P) || !this.pending(P) || (tries && P.syncError) || tries >= FLUSH_TRIES) break
      tries++
      await this.run(P)
    }
    // gave up with edits unpushed (and no push error to say why): say so
    let late = ''
    const secs = Math.round(FLUSH_WAIT / 1000)
    if (this.pending(P) && !P.syncError) {
      if (waited === 'eval') late = 'another eval on this app is still running after ' + secs + ' s: these edits reach draft when it ends'
      else if (this.held(P)) late = ''
      else if (waited) late = 'still waiting for another push after ' + secs + ' s: these edits are not in draft yet'
      else if (tries >= FLUSH_TRIES) late = 'draft kept moving: ' + tries + ' pushes did not get these edits in'
    }
    // held by the caller or the evals it runs inside: pushed after they end
    const deferred = !late && !P.syncError && this.pending(P) && ours()
    // an error is about edits still unpushed: with none left (undone, or
    // pushed since), draft has everything
    if (!this.pending(P)) { P.syncError = ''; if (P === this.P && this.status === 'error') this.set('synced') } else this.queue.add(P)
    this.soon()
    return { n: P.refs ? P.refs.draft ?? null : null, act: late || deferred ? null : P.lastAct || (P === this.P ? this.act : null), error: late || P.syncError || '', deferred }
  },
  label() {
    const s = { idle: 'ready', dirty: 'unsaved', pushing: 'pushing…', synced: 'draft ' + (this.n ?? '–'), error: 'error' }[this.status] || this.status
    const a = this.act, dev = a ? (a.broken ? 'dev broken' : a.n === this.n ? 'dev ok' : 'dev on ' + a.n) : ''
    return { status: s, dev, title: this.error || (a && a.broken) || '' }
  }
}

addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') return; if (Sync.P && Sync.pending(Sync.P)) Sync.queue.add(Sync.P); Sync.runAll() })

// Outside: pushes to draft that did not come from this page (a terminal's
// slop dev or slop push, another person, the agent of another bench), and
// the dev instance's log. Polled every few seconds while an app project is
// open. A file changed outside and not here is taken; a file changed here
// keeps this page's text (the next push writes it): the second push wins,
// file by file.
const Outside = {
  timer: 0, logT: 0, merging: false,
  start(P) {
    clearInterval(this.timer); this.logT = Date.now() - 60000
    if (P && P.meta.app && Slop.on) this.timer = setInterval(() => this.poll(P), 3000)
  },
  async poll(P) {
    if (Sync.P !== P || document.hidden) return
    try {
      if (!Sync.busy && Sync.status !== 'dirty') {
        const r = await Slop.call('head', { app: P.meta.app, base: P.refs ? P.refs.draft ?? null : null })
        if (r.files && Sync.P === P && !Sync.busy && Sync.status !== 'dirty') await this.merge(P, r.refs.draft ?? null, r.files)
        if (r.dev && Sync.P === P && (!Sync.act || Sync.act.n !== r.dev.n || (Sync.act.broken || '') !== r.dev.broken)) { Sync.act = r.dev; Sync.ev.emit('status', Sync.status); App.ev.emit('health') }
      }
      if (Embeds.ready.has(P.meta.app)) await this.logs(P)
    } catch (e) { /* the next poll tries again */ }
  },
  // The dev instance's new log lines go to the Console; its broken state to the header.
  async logs(P) {
    const r = await Slop.call('logs', { app: P.meta.app })
    for (const l of (r.lines || []).filter(l => l.at > this.logT)) App.consoleAdd({ t: l.at, level: l.level === 'warn' ? 'warn' : l.level === 'error' ? 'error' : 'log', text: l.text, src: '', frame: 'actor', fid: 'actor' })
    for (const l of r.lines || []) this.logT = Math.max(this.logT, l.at)
    // app.logs' broken is the actor's (crashing turns), not a failed
    // activation: it may add one, never clear one (head's status does)
    if (Sync.P === P && Sync.act && r.broken && r.broken !== Sync.act.broken) { Sync.act = { ...Sync.act, broken: r.broken }; Sync.ev.emit('status', Sync.status); App.ev.emit('health') }
    return r
  },
  async merge(P, n, tree) {
    this.merging = true
    try { return await this.mergeIn(P, n, tree) } finally {
      this.merging = false
      if (Sync.again && !Sync.busy) { Sync.again = false; Sync.runAll() }
    }
  },
  async mergeIn(P, n, tree) {
    const next = new Map(tree.map(f => [f.path, f]))
    // changed here since the last push: a text edited, or a file of the old tree (text or hash-only) removed
    const mine = p => P.files.has(p) ? P.files.get(p) !== P.synced.get(p) : P.synced.has(p) || (P.tree.has(p) && !P.extern.has(p))
    const take = [], gone = []
    for (const [p, f] of next) { const cur = P.tree.get(p); if ((!cur || cur.sha256 !== f.sha256) && !mine(p)) take.push(f) }
    for (const p of P.tree.keys()) if (!next.has(p) && !mine(p)) gone.push(p)
    // what each of those files is here now: an edit made while the read is
    // in flight wins over the outside text (the next push sends it)
    const local = new Map([...take.map(f => f.path), ...gone].map(p => [p, P.files.get(p)]))
    const { texts } = take.length ? await Slop.readAll(P.meta.app, String(n), take.filter(textish).map(f => f.path)) : { texts: {} }
    const changed = [], note = 'pushed outside the bench (draft ' + n + ')'
    for (const f of take) {
      if (P.files.get(f.path) !== local.get(f.path)) continue
      if (typeof texts[f.path] === 'string') { P.files.set(f.path, texts[f.path]); P.synced.set(f.path, texts[f.path]); P.extern.delete(f.path); P.log({ kind: 'write', ws: 'main', who: 'push', path: f.path, after: texts[f.path], note }) }
      else { P.extern.set(f.path, f); P.files.delete(f.path); P.synced.delete(f.path) }
      changed.push(f.path)
    }
    for (const p of gone) { if (P.files.get(p) !== local.get(p)) continue; P.files.delete(p); P.synced.delete(p); P.extern.delete(p); P.log({ kind: 'remove', ws: 'main', who: 'push', path: p, note }); changed.push(p) }
    P.tree = next; P.refs = { ...(P.refs || {}), draft: n }
    if (Sync.P === P) { Sync.n = n; Sync.ev.emit('status', Sync.status) }
    if (changed.length) { P.ev.emit('files', 'main', changed); toast('draft ' + n + ': ' + plural(changed.length, 'file') + ' changed outside the bench (' + changed.slice(0, 3).join(', ') + (changed.length > 3 ? ', …' : '') + ')', 4000) }
    return changed
  }
}

// Embedded views (Phase 2): canvas frames of an app project show the
// person's dev instance, which runs the app at draft on its own data, as
// slop serves it (instrumented, with the probe). The dev instance is made
// the first time a frame needs it.
const Embeds = {
  ready: new Map(),   // app -> a promise of its dev instance {id, status}
  dev(P) {
    const app = P.meta.app
    if (!this.ready.has(app)) {
      this.ready.set(app, Slop.call('dev', { app }).then(r => {
        P.dev = r.id; P.devStatus = r.status
        if (Sync.P === P && r.status) { Sync.act = { n: r.status.n, broken: r.status.broken }; Sync.ev.emit('status', Sync.status) }
        return r
      }, e => { this.ready.delete(app); throw e }))
    }
    return this.ready.get(app)
  },
  async open(P) { await this.dev(P); return await Slop.call('embed', { app: P.meta.app }) },
  // The view of a frame that reloaded or went away (best effort: it expires anyway).
  close(e) { if (e && e.view) Slop.call('close', { view: e.view }).catch(() => { }) },
  // The page slop serves with the runtime: app.json's page (index.html).
  entry(P) { try { return JSON.parse(P.read('app.json') || '{}').page || 'index.html' } catch (e) { return 'index.html' } }
}

// Publishing (Phase 5): main moves to a draft snapshot, only if main is
// still where the preflight saw it; production instances follow on their
// next view (or now: activate). Publishing main's previous snapshot again is
// the rollback.
const Publish = {
  // Only once every edit is in draft: a preflight of an older draft would
  // approve (and publish) code that is not what the editor shows.
  async preflight(P, o = {}) {
    const f = await Sync.flush(P, o)
    if (f.error) throw new Error('your edits are not in draft (' + f.error + '); fix that before publishing')
    if (Sync.pending(P)) throw new Error(Sync.held(P) ? 'edits a running eval made are not in draft until it ends (this one included, when publishing from an eval): publish after that' : 'your edits are still being pushed to draft; try again in a moment')
    return await Slop.call('preflight', { app: P.meta.app })
  },
  async run(P, pf, who = 'you', note = '') {
    const n = pf.refs.draft, at = pf.refs.main ?? 0
    const r = await Slop.call('publish', { app: P.meta.app, n, ifAt: at })
    P.refs = { ...(P.refs || {}), main: n }
    P.mark({ label: 'Published draft ' + n + ' to main', note: (note ? note + ' · ' : '') + (at ? 'main was ' + at : 'first publish') + (pf.migrations.length ? ' · migrations: ' + pf.migrations.join(', ') : ''), by: who, kind: 'milestone' })
    Slop.refresh().catch(() => { })
    return { n, from: r.from ?? at }
  },
  async rollback(P, to, from, who = 'you') {
    await Slop.call('publish', { app: P.meta.app, n: to, ifAt: from })
    P.refs = { ...(P.refs || {}), main: to }
    P.mark({ label: 'Rolled main back to ' + to, note: 'from ' + from, by: who, kind: 'milestone' })
    Slop.refresh().catch(() => { })
  },
  // A preflight as lines, for the dialog and the agent's approval card.
  lines(pf) {
    const d = pf.refs.draft, m = pf.refs.main
    const out = [d === m ? 'main is already draft ' + d + ': nothing to publish' : 'draft ' + d + ' → main' + (m != null ? ' (now ' + m + ')' : ' (first publish)')]
    if (pf.added.length || pf.changed.length || pf.removed.length) out.push('files: ' + [...pf.added.map(p => '+' + p), ...pf.changed.map(p => '~' + p), ...pf.removed.map(p => '-' + p)].slice(0, 30).join(' '))
    if (pf.migrations.length) out.push('new migrations run on every production instance: ' + pf.migrations.join(', '))
    out.push(pf.dev ? (pf.dev.broken ? 'your dev instance failed on it: ' + pf.dev.broken : pf.dev.n === d ? 'your dev instance runs draft ' + d + ': ok' : 'your dev instance is on ' + pf.dev.n + ', not draft ' + d + (pf.dev.next === d ? ' (it has not been opened since)' : '')) : 'no dev instance of yours has run this draft')
    out.push(pf.production.length ? 'production: ' + pf.production.map(x => x.store + ' @' + x.n + (x.next ? ' (' + x.next + ' on its next view)' : '') + (x.broken ? ' (broken)' : '')).join(', ') : 'no production instance yet: nothing serves main')
    for (const b of pf.blockers) out.push('BLOCKED: ' + b)
    return out
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
