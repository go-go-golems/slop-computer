// The shell's side of the kernel worker: calls, coalesced events, and the bridges the kernel
// needs from the outer page (Claude for `sample`, the downloads capability).
export class Client {
  constructor(url) {
    this.seq = 0; this.calls = new Map(); this.listeners = new Set(); this.bridges = {};
    this.ready = new Promise((res, rej) => { this._ready = res; this._fail = rej; });
    this.w = new Worker(url, { type: 'module' });
    this.w.onmessage = (e) => this.onMsg(e.data);
    this.w.onerror = (e) => { this._fail(new Error(e.message || 'the kernel worker failed to start')); };
  }
  call(op, args, transfer) {
    return new Promise((res, rej) => {
      const id = ++this.seq; this.calls.set(id, { res, rej });
      this.w.postMessage({ id, op, args }, transfer || []);
    });
  }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  async onMsg(m) {
    if (m.type === 'ready') { this._ready(); return; }
    if (m.type === 'res') {
      const c = this.calls.get(m.id); if (!c) return; this.calls.delete(m.id);
      if (m.ok) c.res(m.value); else { const e = new Error(m.error.message); e.code = m.error.code; e.trace = m.error.trace; c.rej(e); }
      return;
    }
    if (m.type === 'events') { for (const f of this.listeners) { try { f(m.names); } catch (e) { console.error(e); } } return; }
    const b = this.bridges[m.type];
    if (b) {
      try { const value = await b(m); this.w.postMessage({ type: 'reply', reqId: m.reqId, ok: true, value }); }
      catch (e) { this.w.postMessage({ type: 'reply', reqId: m.reqId, ok: false, error: { code: e.code || 'unavailable', message: String(e.message || e) } }); }
    }
  }
}
