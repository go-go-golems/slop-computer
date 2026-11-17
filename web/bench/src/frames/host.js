// frames/host.js — an iframe showing one of the person's instances, with the
// probe inside it; the pool of headless ones.
//
// Every frame shows a real instance as slop serves it (an embedded view,
// with the probe): dev (follows draft: the canvas), test (follows draft,
// seeded with a fixture: scenarios) or prop (follows the proposal under
// review). A frame never shows unsaved text: what it shows is a snapshot
// some instance runs. The bench is the shell of its embedded frames: it
// answers their runtime's hello and renew messages for the view it opened.
//
// What only the page can do (its mode, pins and preview, the Console, picks
// and pins on the canvas) comes through FrameHost.ui, which the shell sets
// at boot; the defaults do nothing.
//
// Owns: iframes, their loads, the probe calls in flight, a recording in
// progress. Public API: FrameHost, FrameHosts, Headless.
import { $, h, toast } from '../lib/dom.js';
import { Instances } from '../server/instances.js';
import { Slop } from '../server/slop.js';
import { Streams } from './streams.js';
import { emitter, now, sleep, uid } from '../lib/util.js';
import { escHtml } from '../lib/text.js';

export const FrameHosts = new Set()
const hostByNonce = new Map()     // nonce of a load → its FrameHost (iframes reload when the dock moves them)
addEventListener('message', e => {
  const m = e.data
  if (!m || m.__sb !== 'probe') return
  const fh = hostByNonce.get(m.nonce)
  if (!fh) return
  const want = fh.next && fh.next.nonce === m.nonce ? fh.next.origin : fh.origin
  if (want && e.origin !== want) return
  fh.onMessage(m)
})

// The instance a workspace is shown on: draft on the dev instance, a
// proposal on the prop instance.
export const showing = ws => ws === 'draft' ? { kind: 'dev', ref: null } : { kind: 'prop', ref: ws }

export class FrameHost {
  // o: {project, route, w, h, kind: dev | test | prop, ref (prop: the proposal), fid, headless}
  constructor(o) {
    Object.assign(this, { project: o.project, route: o.route, w: o.w, h: o.h, kind: o.kind || 'dev', ref: o.ref || null, fid: o.fid || uid('h'), headless: !!o.headless })
    this.el = h('div', { style: { position: 'relative', width: o.w + 'px', height: o.h + 'px', overflow: 'hidden' } })
    this.iframe = null; this.nonce = ''; this.readyP = null; this.pend = new Map(); this.seq = 0
    this.logs = []; this.issues = []; this.errors = 0; this.ev = emitter(); this.loading = false; this.saved = null
    this.embed = null; this.origin = ''; this.layoutMap = null
    FrameHosts.add(this)
  }
  // the workspace this frame shows
  get ws() { return this.kind !== 'dev' && this.ref ? this.ref : 'draft' }
  size(w, hh) {
    this.w = w; this.h = hh
    Object.assign(this.el.style, { width: w + 'px', height: hh + 'px' })
    if (this.iframe) Object.assign(this.iframe.style, { width: w + 'px', height: hh + 'px' })
  }
  async load({ keepState = true } = {}) {
    if (keepState && this.iframe && this.ready) { try { this.saved = await this.call('state', [], 400) } catch { } }
    const style = { width: this.w + 'px', height: this.h + 'px', position: 'absolute', left: 0, top: 0, border: 0, opacity: this.iframe ? 0 : 1 }
    const nonce = uid('n'), ifr = h('iframe', { allow: 'clipboard-write; fullscreen', title: this.route, style })
    let res
    const p = new Promise(r => { res = r })
    this.next = { ifr, nonce, res }; this.loading = true; this.ready = false; this.readyP = p
    this.el.appendChild(ifr); hostByNonce.set(nonce, this)
    this.logs = this.logs.filter(l => l.keep); this.errors = 0
    try {
      const e = await Instances.embed(this.project, this.kind, this.ref)
      if (!this.next || this.next.nonce !== nonce) return this   // a newer load took over
      const u = new URL(this.route.split('#')[0] || e.src, e.src)
      u.searchParams.set('sbn', nonce)
      u.hash = this.route.includes('#') ? this.route.slice(this.route.indexOf('#')) : ''
      this.next.embed = e; this.next.origin = e.origin
      ifr.src = u.href
    } catch (err) {
      ifr.setAttribute('sandbox', 'allow-scripts')
      ifr.srcdoc = '<pre style="font:13px monospace;padding:16px;white-space:pre-wrap">The ' + this.kind + ' instance could not be shown: ' + escHtml(err.message || String(err)) +
        '</pre><script>parent.postMessage({ __sb: "probe", nonce: ' + JSON.stringify(nonce) + ', ev: "ready" }, "*")<\/script>'
    }
    const timer = setTimeout(() => { if (this.next && this.next.nonce === nonce) this.swap() }, 10000)
    await p
    clearTimeout(timer)
    return this
  }
  // on screen with a layout: a canvas frame in a hidden tab measures as 0×0, so reads go to a headless frame instead
  get shown() { return this.headless || (this.el.isConnected && this.el.getClientRects().length > 0) }
  reloadSoon() { clearTimeout(this.reloadT); this.reloadT = setTimeout(() => this.load({ keepState: true }), 60) }
  // Loaded and showing snapshot n (or later); resolves false after ms (an
  // activation that failed never reloads the frame).
  waitVersion(n, ms = 6000) {
    if (n == null) return Promise.resolve(false)
    const ok = () => !!this.embed && this.embed.version >= n && this.ready && !this.loading
    if (ok()) return Promise.resolve(true)
    return new Promise(res => {
      const iv = setInterval(() => { if (ok()) { clearInterval(iv); clearTimeout(t); res(true) } }, 40)
      const t = setTimeout(() => { clearInterval(iv); res(false) }, ms)
    })
  }
  swap() {
    const n = this.next
    if (!n) return
    if (this.iframe && this.iframe !== n.ifr) {
      hostByNonce.delete(this.nonce); this.iframe.remove()
      if (this.embed && (!n.embed || n.embed.view !== this.embed.view)) Instances.close(this.embed)
    }
    n.ifr.style.opacity = 1
    this.iframe = n.ifr; this.nonce = n.nonce; this.next = null; this.loading = false; this.ready = true
    this.embed = n.embed || null; this.origin = n.origin || ''
    this.greet()
    for (const [, x] of this.pend) x.rej(Object.assign(new Error('page reloaded'), { kind: 'frame' }))
    this.pend.clear()
    n.res(this)
    if (this.saved) { this.post({ op: 'restore', args: [this.saved], id: 0 }); this.saved = null }
    if (!this.headless) { this.runCheck(); FrameHost.ui.ready(this); Streams.frame(this, 'load', this.route) }
    this.ev.emit('ready')
  }
  // what the probe needs to know: the mode, and on the canvas its pins and the panels' preview
  greet() {
    if (this.headless) { this.post({ push: 'mode', mode: 'play' }); return }
    this.post({ push: 'mode', mode: FrameHost.ui.mode() })
    this.post({ push: 'pins', pins: FrameHost.ui.pinsFor(this.route) })
    const pv = FrameHost.ui.preview()
    if (pv) this.post({ push: 'preview', preview: pv })
  }
  async runCheck() {
    try { this.issues = await this.call('check', [], 4000); this.ev.emit('issues', this.issues); FrameHost.ui.health() } catch { }
    try { this.layoutMap = await this.call('layout', [], 4000) } catch { }
  }
  post(m, nonce) {
    const nx = this.next && nonce === this.next.nonce, ifr = nx ? this.next.ifr : this.iframe, to = (nx ? this.next.origin : this.origin) || '*'
    if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage(Object.assign({ __sb: 'host' }, m), to)
  }
  push(m) {
    this.post(m)
    if (this.next && this.next.ifr.contentWindow) this.next.ifr.contentWindow.postMessage(Object.assign({ __sb: 'host' }, m), this.next.origin || '*')
  }
  async call(op, args = [], timeout = 5000) {
    if (!this.ready) {
      const t = sleep(Math.max(timeout, 4500)).then(() => { throw Object.assign(new Error('frame did not load'), { kind: 'frame' }) })
      await Promise.race([this.readyP, t])
    }
    const id = ++this.seq
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pend.delete(id); rej(Object.assign(new Error(op + ' timed out in frame ' + this.route), { kind: 'timeout' })) }, timeout)
      this.pend.set(id, { res: v => { clearTimeout(t); res(v) }, rej: e => { clearTimeout(t); rej(e) } })
      this.post({ op, args, id })
    })
  }
  onMessage(m) {
    if (this.next && m.nonce === this.next.nonce) { if (m.ev === 'ready') this.swap(); return }
    if (m.nonce !== this.nonce) return
    if (m.ev === 'ready') { this.greet(); if (!this.headless) this.runCheck(); return }   // the same load came back (the dock re-parented the iframe)
    const ui = FrameHost.ui
    switch (m.ev) {
      case 'res': {
        const p = this.pend.get(m.id)
        if (p) { this.pend.delete(m.id); m.ok ? p.res(m.value) : p.rej(Object.assign(new Error(m.error), { kind: 'frame' })) }
        break
      }
      case 'invalid':
        if (!this.headless) toast('Not sent: "' + m.field + '": ' + m.message, 5000)
        break
      case 'modekey':
        if (!this.headless) document.dispatchEvent(new KeyboardEvent('keydown', { key: String(m.key || '') }))
        break
      case 'print':
        if (!this.headless) toast('Printing does not work inside the bench\'s frame. It works when the app is open in its own browser tab (after Publish, at its web address).', 7000)
        break
      case 'log': {
        const l = { t: now(), level: m.level, text: m.text, src: m.src || '', frame: this.route, fid: this.fid }
        this.logs.push(l)
        if (this.logs.length > 300) this.logs.shift()
        if (m.level === 'error') this.errors++
        if (!this.headless) { ui.log(this, l); Streams.frame(this, 'console', m.level + ': ' + m.text) }
        break
      }
      case 'act': if (!this.headless) Streams.frame(this, m.kind, m.sel + (m.text ? ' “' + m.text + '”' : ''), { sel: m.sel, text: m.text }); break
      case 'pick': ui.pick(this, { ...m.info, fid: this.fid, route: this.route, ws: this.ws }); break
      case 'rec': if (this.rec) this.recStep(m.step); break
      case 'pin': ui.placePin(this, m); break
      case 'pinclick': ui.openPin(this, m.id); break
      case 'textedit': ui.textEdit(this, m); break
    }
  }
  // ---- recording: interact with a frame, get a scenario's steps ----
  async startRecording(fr) {
    this.rec = { steps: [], page: this.route, size: [this.w, this.h], fid: fr ? fr.id : null, t: now() }
    await this.load({ keepState: false })
    this.ev.emit('rec', this.rec)
  }
  recStep(step) {
    const r = this.rec
    if (!r || !step) return
    const last = r.steps[r.steps.length - 1]
    if (step.type && last && last.type === step.type) last.text = step.text           // typing into the same field: keep the final text
    else if (step.expect && last && last.expect === step.expect) Object.assign(last, step)
    else r.steps.push(step)
    this.ev.emit('rec', r)
  }
  async stopRecording() {
    const r = this.rec
    this.rec = null
    if (r) this.route = r.page
    this.saved = null
    await this.load({ keepState: false })
    this.ev.emit('nav', this.route); this.ev.emit('rec', null)
    return r
  }
    // show another page of the app (a hash route, or another file)
  navigate(route) {
    this.route = route || 'index.html'
    this.saved = null
    this.ev.emit('nav', this.route)
    return this.load({ keepState: false })
  }
  dispose() {
    FrameHosts.delete(this); hostByNonce.delete(this.nonce)
    if (this.next) hostByNonce.delete(this.next.nonce)
    this.el.remove()
    if (this.embed) Instances.close(this.embed)
    if (this.next && this.next.embed) Instances.close(this.next.embed)
  }
}
// What only the page can do, set by the shell (ui/app.js) at boot.
FrameHost.ui = {
  mode: () => 'select', pinsFor: () => [], preview: () => null, health: () => { }, ready: () => { }, hostFor: () => null,
  log: () => { }, pick: () => { }, placePin: () => { }, openPin: () => { }, textEdit: () => { }, reveal: () => { }
}

// The bench is the shell of its embedded frames: it answers their slop
// runtime (slop: 1 messages) as slop's shell answers a page it frames
// (pkg/doors/pages/assets/shell.js), for the view the bench opened. A new
// version (reload) or changed access (reopen) loads the frame again, in
// place. What needs the main host's session (consent, confirm, downloads)
// is declined here; open the app on its own mount for those.
addEventListener('message', async e => {
  const m = e.data
  if (!m || m.slop !== 1 || typeof m.type !== 'string') return
  let fh = null, cur = false
  for (const x of FrameHosts) {
    if (x.next && x.next.embed && x.next.ifr.contentWindow === e.source) { fh = x; break }
    if (x.embed && x.iframe && x.iframe.contentWindow === e.source) { fh = x; cur = true; break }
  }
  if (!fh) return
  const emb = cur ? fh.embed : fh.next.embed
  if (e.origin !== emb.origin) return
  const reply = r => e.source.postMessage(Object.assign({}, r, { slop: 1 }), emb.origin)
  const give = () => reply({ type: 'view', view: emb.view, secret: emb.secret, expiresAt: emb.expiresAt })
  switch (m.type) {
    case 'hello': give(); return
    case 'renew':
      try { Object.assign(emb, await Slop.call('renew', { view: emb.view })); give() } catch (err) { if (cur) fh.reloadSoon() }
      return
    case 'reload': case 'reopen': if (cur) fh.reloadSoon(); return
    case 'consent':
      reply({ id: m.id, states: Object.fromEntries((Array.isArray(m.names) ? m.names : []).map(n => [String(n), 'denied'])) })
      toast(fh.route + ' asked for ' + (m.names || []).join(', ') + ': not in the bench; open the app on its mount')
      return
    case 'download': reply({ id: m.id, status: 'declined' }); return
    case 'confirm': reply({ id: m.id, approved: false }); toast(fh.route + ' asked to confirm a change: not in the bench'); return
    case 'compose': reply({ id: m.id, opened: false }); return
    case 'permissions': reply({ id: m.id }); return
  }
})

// Headless frames: for the agent's frame calls when the canvas is not showing
// that page at that size, and scenario runs.
export const Headless = {
  pool: new Map(),
  root() {
    let r = $('#headless')
    if (!r) {
      r = h('div#headless', { 'aria-hidden': 'true', style: { position: 'fixed', left: '-30000px', top: 0, width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' } })
      document.body.appendChild(r)
    }
    return r
  },
  key(project, route, { kind = 'dev', ref = null, w = 375, h = 720 } = {}) { return project.id + '|' + kind + '|' + (ref || '') + '|' + route + '|' + w + 'x' + h },
  // o: {kind, ref, w, h}
  async get(project, route, o = {}) {
    const k = this.key(project, route, o)
    let fh = this.pool.get(k)
    if (!fh) {
      fh = new FrameHost({ project, route, w: o.w || 375, h: o.h || 720, kind: o.kind, ref: o.ref, headless: true })
      this.root().appendChild(fh.el); this.pool.set(k, fh)
      await fh.load()
    } else if (fh.stale) { fh.stale = false; await fh.load({ keepState: false }) }
    else if (!fh.ready) await fh.readyP
    return fh
  },
  peek(project, route, o = {}) { return this.pool.get(this.key(project, route, o)) || null },
  // a frame of its own, outside the pool (scenario runs); dispose it when done
  async fresh(project, route, o = {}) {
    const fh = new FrameHost({ project, route, w: o.w || 375, h: o.h || 720, kind: o.kind || 'test', ref: o.ref, headless: true })
    this.root().appendChild(fh.el)
    await fh.load()
    return fh
  },
  // every pooled frame of a project reloads on its next use (the instance moved)
  stale(project) { for (const fh of this.pool.values()) if (fh.project === project) fh.stale = true },
  clear(project) { for (const [k, fh] of this.pool) if (!project || fh.project === project) { fh.dispose(); this.pool.delete(k) } },
  // pooled frames of refs no longer live (a closed proposal) are disposed
  prune(project, live) { for (const [k, fh] of this.pool) if (fh.project === project && fh.ref && !live(fh.ref)) { fh.dispose(); this.pool.delete(k) } }
}
