/* Pinboard · the agent: one tool (eval), modes, steps with revert, images from clips or the composer. */
(function (PB) {
  'use strict';
  const el = PB.el;
  const INSTRUCTIONS = [
    "You are the agent of a pinboard: a canvas of clips (notes, links, images, docs, app windows), collections (small databases) and little apps built with a fluent JavaScript grammar. You help the person organise what they pasted into proper collections, build and change apps, and answer questions about what is on the board.",
    "You have one tool, eval. Its input is JavaScript: the body of an async function run in the page with this scope: board, db, ui, app, apps, m, describe, log, fragment, PB, select. The return value comes back as YAML, cut at 9,000 characters; log(...) lines come back too. A thrown error comes back as 'Error: …' and you carry on.",
    "How to work:",
    "- Look before changing: describe(), board.clips(), board.find(q), db.collections(), db.x.all(), apps.source(name).",
    "- Change only through m(x => x.move(id, {x, y}).retitle(id, t).tag(id, …).insert(coll, row).promote(clipId, coll).group(ids).pin(id).remove(id)…): one m() call is one transaction and one undo step. db.x.insert/update/remove and board.clip(…) are mutations too.",
    "- To make an app, put ONLY the app chain in a step (helper consts are fine, nothing else): app('name').icon('△').title('…')….view(…).register(). The step's code is saved as the app's source and re-evaluated when the board loads, so it must be self-contained. Then apps.open('name') in another step. To change an app, read apps.source(name), then register the full new source the same way (same name replaces it). Build-time lambdas get a builder (b); runtime lambdas get the context (c). Image fields and ui.image take a blob id (blob:…); the page cannot load images from the web.",
    "- Keep results small: return counts, ids and a few sample rows, not whole collections. Prefer one step that loops over many steps.",
    "- Images: an image clip is sent to you as an image when it is selected, when the message names its id, or when the person pastes an image into the composer. If you need to see one, say which id to select or name it, and stop. Images you were sent are listed under [attached images] in the same message, in order.",
    "- Answer in a few short paragraphs of Markdown: what you found, what you changed (with ids like clip:ab12c and collection names), and what to do next. No exclamation marks. British spelling. Say which step did what when it matters. Mention when something could not be done and why.",
    "- The [context] block in the latest message is the live state of the board; earlier context blocks are stale.",
    "The reference below is the same one the person reads in the Reference app.",
  ].join('\n');

  const A = PB.agent = { sample: null, limits: null, available: false, threads: [], cur: null, mode: 'ask', tier: 'default', attachments: [], busy: null, open: false, sendSelected: true, _step: 0 };
  let $panel, $msgs, $ta, $att, $threads;

  // ---------- threads ----------
  function newThread(title) { const t = { id: PB.id('th'), title: title || 'thread ' + (A.threads.length + 1), msgs: [], at: Date.now() }; A.threads.unshift(t); A.cur = t; save(); renderThreads(); renderMsgs(); return t; }
  function save() { PB.meta('threads', A.threads.slice(0, 12).map(t => ({ id: t.id, title: t.title, at: t.at, msgs: t.msgs.slice(-40).map(m => ({ role: m.role, text: (m.text || '').slice(0, 12000), images: m.images, steps: (m.steps || []).map(s => ({ n: s.n, code: s.code.slice(0, 4000), result: (s.result || '').slice(0, 2000), status: s.status, ms: s.ms, changed: s.changed, by: s.by })) })) }))); PB.meta('agentMode', A.mode); PB.meta('agentTier', A.tier); }
  function renderThreads() {
    $threads.innerHTML = '';
    A.threads.slice(0, 6).forEach(t => { const b = el('button', 'tht' + (t === A.cur ? ' on' : ''), t.title.slice(0, 22)); b.title = t.title; b.addEventListener('click', () => { A.cur = t; renderThreads(); renderMsgs(); }); b.addEventListener('dblclick', () => { const n = prompt('thread title', t.title); if (n) { t.title = n; save(); renderThreads(); } }); $threads.append(b); });
    const x = el('button', 'tht new', '+ New'); x.addEventListener('click', () => newThread()); $threads.append(x);
  }

  // ---------- messages ----------
  function renderMsgs() {
    $msgs.innerHTML = '';
    if (!A.cur) return;
    if (!A.cur.msgs.length) {
      const e = el('div', 'empty padded');
      e.append(el('div', '', A.available ? 'Select some clips and say what to do with them, or ask about the board.' : 'Claude is not available in this view, so the panel is a console: a message starting with > runs as a step against the same API the agent uses.'));
      const sug = el('div', 'sugs'); ['these are all one kind of thing: make a collection and a browser app for them', 'tag everything on the board by topic', 'what is on this board?', 'build me a small app that…', '> describe()'].forEach(s => { const b = el('button', 'btn sm', s); b.addEventListener('click', () => { $ta.value = s; $ta.focus(); }); sug.append(b); });
      e.append(sug); $msgs.append(e); return;
    }
    A.cur.msgs.forEach(m => $msgs.append(msgEl(m)));
    $msgs.scrollTop = $msgs.scrollHeight;
  }
  function msgEl(m) {
    const d = el('div', 'msg ' + m.role); m._el = d;
    d.append(el('div', 'who', m.role === 'you' ? 'You' : m.role === 'console' ? 'Console' : 'Agent'));
    if (m.role === 'you') { const t = el('div', 'txt'); t.textContent = m.text; d.append(t); if (m.images && m.images.length) d.append(el('div', 'small muted', '▢ sent ' + m.images.join(', '))); return d; }
    (m.steps || []).forEach(s => d.append(stepEl(s)));
    const t = el('div', 'txt doc'); t.innerHTML = linkIds(PB.md(m.text || '')); d.append(t); m._txt = t;
    if (m.status === 'thinking') { const th = el('div', 'thinking', 'Thinking'); th.append(el('span', 'dot-thinking')); d.append(th); m._th = th; }
    if (m.error) d.append(el('div', 'fail', m.error));
    return d;
  }
  function linkIds(html) { return html.replace(/\b(clip:[a-z0-9]{5,10})\b/g, '<a href="#" data-focus="$1">$1</a>'); }
  function stepEl(s) {
    const d = el('div', 'step ' + s.status); s._el = d;
    const head = el('div', 'shead'); head.append(el('span', 'sdot'), el('span', 'slbl', 'step ' + s.n + (s.by === 'you' ? ' · console' : '') + (s.status === 'waiting' ? ' · waiting for you' : s.status === 'declined' ? ' · declined' : s.status === 'reverted' ? ' · reverted' : '')), el('span', 'sp'), el('span', 'stime', s.ms != null ? (s.ms / 1000).toFixed(2) + ' s' : ''));
    const code = el('pre', 'scode'); code.textContent = s.code; const res = el('pre', 'sres'); res.textContent = s.result || ''; if (!s.result) res.style.display = 'none';
    const acts = el('div', 'sacts');
    if (s.status === 'waiting') { const run = el('button', 'btn primary sm', 'Run this step'); run.addEventListener('click', () => s._resolve && s._resolve(true)); const dec = el('button', 'btn sm', 'Decline'); dec.addEventListener('click', () => s._resolve && s._resolve(false)); acts.append(run, dec); }
    if (s.changed && s.status === 'done') { const rv = el('button', 'btn sm', 'revert to before this step'); rv.addEventListener('click', () => A.revert(s)); acts.append(rv); }
    head.addEventListener('click', () => d.classList.toggle('folded'));
    d.append(head, code, res, acts); if (s.status === 'done' && s.code.split('\n').length > 6) d.classList.add('folded'); return d;
  }
  function refreshStep(s) { const old = s._el; if (old && old.parentNode) { const n = stepEl(s); old.replaceWith(n); } save(); }

  // ---------- running code ----------
  const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
  A.runCode = async function (code, opts = {}) {
    const logs = []; const cap = []; const prevCap = PB.apps._capture; PB.apps._capture = cap; const prevActor = PB.actor; PB.actor = opts.by || 'agent'; PB.readonly = !!opts.readonly;
    const mfn = (fn) => { if (PB.readonly) throw new Error('Read-only mode: mutations are off. Ask the person to switch the mode to Ask or Auto.'); return PB.mutate(fn, PB.actor); };
    const scope = { board: PB.boardAPI, db: PB.db, ui: PB.ui, app: PB.app, apps: PB.apps, m: mfn, describe: (o) => { if (typeof o === 'string') { const c = PB.S.clips[o]; return c ? PB.describeClip(c) : (PB.S.apps[o] ? { app: o, source: PB.apps.source(o) } : 'nothing called ' + o); } return PB.describe(o); }, log: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : PB.toYAML(x)).join(' ')), fragment: PB.fragment, PB, select: (ids) => PB.board.select([].concat(ids)) };
    const started = performance.now(); let value, error;
    try {
      const fn = new AsyncFunction(...Object.keys(scope), '"use strict";\n' + code);
      value = await Promise.race([fn(...Object.values(scope)), new Promise((_, rej) => setTimeout(() => rej(new Error('step timed out after 25 s (code may still be running)')), 25000))]);
      if (cap.length && !PB.readonly) { cap.forEach(def => { PB.apps.registerSource(code); }); logs.push('registered app ' + cap.map(d => d.name).join(', ') + ' with this step\'s code as its source' + (/\bm\(|\.insert\(|board\.clip\(/.test(code) ? ' · warning: the step also mutates; those mutations will run again when the board loads. Keep app steps to the app chain.' : '')); }
    } catch (e) { error = e; }
    finally { PB.apps._capture = prevCap; PB.actor = prevActor; PB.readonly = false; }
    const ms = Math.round(performance.now() - started);
    let out = error ? 'Error: ' + (error && error.message || error) : value === undefined ? 'ok' : PB.toYAML(value);
    if (logs.length) out = logs.map(l => '· ' + l).join('\n') + '\n' + out;
    if (out.length > 9000) out = out.slice(0, 9000) + '\n… cut at 9,000 characters; return less (ids, counts, a few rows).';
    return { out, ms, error };
  };
  function addStep(msg, code, by) { const s = { n: ++A._step, code, status: 'waiting', by: by || 'agent', histIdx: PB.history.idx, result: '' }; (msg.steps = msg.steps || []).push(s); if (msg._el) { const e = stepEl(s); if (msg._txt) msg._txt.before(e); else msg._el.append(e); } $msgs.scrollTop = $msgs.scrollHeight; return s; }
  async function execStep(s, readonly) {
    s.status = 'running'; refreshStep(s); const r = await A.runCode(s.code, { readonly, by: s.by });
    s.result = r.out; s.ms = r.ms; s.status = r.error ? 'failed' : 'done'; s.changed = PB.history.idx > s.histIdx; refreshStep(s); $msgs.scrollTop = $msgs.scrollHeight; return r.out;
  }
  A.revert = function (s) { if (PB.history.idx <= s.histIdx) return PB.toast('already reverted'); PB.revertTo(s.histIdx); s.status = 'reverted'; s.changed = false; refreshStep(s); PB.toast('reverted to before step ' + s.n); };

  // ---------- images ----------
  function imagesToSend(text) {
    // An image clip counts by its reference; its bytes may not be cached yet
    // (A.send fetches them).
    const isImage = (c) => c && c.kind === 'image' && PB.isAssetRef(c.blobId);
    const sel = [...PB.board.sel].map(i => PB.S.clips[i]).filter(isImage);
    const named = [...new Set((text.match(/clip:[a-z0-9]{5,10}/g) || []))].map(i => PB.S.clips[i]).filter(isImage);
    const clips = [...new Map([...(A.sendSelected ? sel : []), ...named].map(c => [c.id, c])).values()];
    const list = [...A.attachments.map(a => ({ blob: a.blob, label: a.name })), ...clips.map(c => ({ blob: PB.blobs[c.blobId] || null, ref: c.blobId, label: c.id + (c.title ? ' "' + c.title + '"' : '') + (c.dims ? ' ' + c.dims.w + '×' + c.dims.h : '') }))];
    const max = A.limits && A.limits.images ? A.limits.images.maxCount : 0;
    return { list: list.slice(0, max || list.length), dropped: max ? Math.max(0, list.length - max) : 0, max };
  }
  function renderAttachments() {
    $att.innerHTML = '';
    const { list, max } = imagesToSend($ta.value);
    A.attachments.forEach((a, i) => { const t = el('span', 'attach'); const im = el('img'); im.src = a.url; t.append(im, el('span', '', a.name.slice(0, 18))); const x = el('button', 'ib', '×'); x.addEventListener('click', () => { A.attachments.splice(i, 1); renderAttachments(); }); t.append(x); $att.append(t); });
    const clipsIn = list.filter(x => !A.attachments.some(a => a.blob === x.blob));
    if (clipsIn.length) { const t = el('span', 'small muted', '▢ ' + clipsIn.length + ' image clip' + (clipsIn.length > 1 ? 's' : '') + ' will be sent'); const tg = el('button', 'btn sm', A.sendSelected ? 'skip selected' : 'send selected'); tg.addEventListener('click', () => { A.sendSelected = !A.sendSelected; renderAttachments(); }); $att.append(t, tg); }
    if (list.length && !(A.limits && A.limits.images) && A.available) $att.append(el('span', 'small fail', 'this view cannot send images'));
    $att.style.display = $att.children.length ? '' : 'none';
  }
  A.attach = async function (blob, name) { const url = URL.createObjectURL(blob); A.attachments.push({ blob, name: name || 'pasted image', url }); renderAttachments(); A.toggle(true); };

  // ---------- send ----------
  A.send = async function () {
    const text = $ta.value.trim(); if (!text || A.busy) return;
    if (!A.cur) newThread();
    $ta.value = '';
    if (text.startsWith('>')) { // console step
      const code = text.slice(1).trim(); const msg = { role: 'console', text: '', steps: [] }; A.cur.msgs.push(msg); $msgs.append(msgEl(msg)); const s = addStep(msg, code, 'you'); await execStep(s, false); save(); return;
    }
    if (!A.available) { PB.toast('Claude is not available here. Start a message with > to run code directly.'); $ta.value = text; return; }
    const imgs = imagesToSend(text);
    for (const i of imgs.list) if (!i.blob && i.ref) i.blob = await PB.fetchBlob(i.ref).catch(() => null);
    imgs.list = imgs.list.filter(i => i.blob);
    const you = { role: 'you', text, images: imgs.list.map(i => i.label) }; A.cur.msgs.push(you); $msgs.append(msgEl(you));
    if (A.cur.msgs.length === 1) { A.cur.title = text.slice(0, 40); renderThreads(); }
    const agentMsg = { role: 'agent', text: '', steps: [], status: 'thinking' }; A.cur.msgs.push(agentMsg); $msgs.append(msgEl(agentMsg)); $msgs.scrollTop = $msgs.scrollHeight;
    const ctl = new AbortController(); A.busy = { ctl, msg: agentMsg }; setBusy(true);
    const turns = [{ role: 'user', content: INSTRUCTIONS + '\n\n' + PB.REFERENCE }];
    A.cur.msgs.slice(0, -2).slice(-14).forEach(m => { if (m.role === 'you') turns.push({ role: 'user', content: m.text }); else if (m.role === 'agent' && (m.text || (m.steps || []).length)) turns.push({ role: 'assistant', content: (m.steps || []).map(s => 'step ' + s.n + ' (' + s.status + '): ' + s.code.split('\n')[0].slice(0, 100) + (s.result ? ' → ' + s.result.split('\n')[0].slice(0, 100) : '')).join('\n') + (m.text ? '\n\n' + m.text : '') }); else if (m.role === 'console') turns.push({ role: 'user', content: '[the person ran in the console] ' + (m.steps || []).map(s => s.code + '\n→ ' + (s.result || '').slice(0, 400)).join('\n') }); });
    let ctxText = PB.toYAML(PB.describe({ max: 50 })); if (ctxText.length > 30000) ctxText = ctxText.slice(0, 30000) + '\n… context cut; use board.clips() for the rest';
    const attached = imgs.list.length ? '\n\n[attached images]\n' + imgs.list.map((i, k) => (k + 1) + '. ' + i.label).join('\n') + (imgs.dropped ? '\n(' + imgs.dropped + ' more not sent: limit ' + imgs.max + ')' : '') : '';
    turns.push({ role: 'user', content: '[context]\n' + ctxText + attached + '\n\n[mode] ' + A.mode + '\n\n' + text });
    const tool = {
      name: 'eval', description: 'Run JavaScript in the pinboard page: the body of an async function with board, db, ui, app, apps, m, describe, log, fragment, PB, select in scope. Returns the value as YAML (cut at 9,000 characters) plus log() lines; errors come back as "Error: …". One call per step; keep results small.',
      inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript, the body of an async function. Use return to send a value back.' }, label: { type: 'string', description: 'three to eight words saying what this step does' } }, required: ['code'] },
      execute: async (input, context) => {
        const code = String(input.code || ''); const s = addStep(agentMsg, code, 'agent'); if (input.label) s.label = String(input.label);
        if (A.mode === 'ask') { const ok = await new Promise(res => { s._resolve = res; context.signal.addEventListener('abort', () => res(false), { once: true }); }); s._resolve = null; if (!ok) { s.status = 'declined'; refreshStep(s); return 'Declined by the person. Do not retry the same step; ask what they would prefer, or stop.'; } }
        if (context.signal.aborted) { s.status = 'declined'; refreshStep(s); return 'Stopped.'; }
        return await execStep(s, A.mode === 'readonly');
      },
    };
    try {
      const opts = { cache: false, signal: ctl.signal, tools: [tool], modelTier: A.tier, onText: ({ text: t }) => { agentMsg.text = t; if (agentMsg._th) { agentMsg._th.remove(); agentMsg._th = null; } if (agentMsg._txt) agentMsg._txt.innerHTML = linkIds(PB.md(t)); $msgs.scrollTop = $msgs.scrollHeight; } };
      if (imgs.list.length && A.limits && A.limits.images) opts.images = imgs.list.map(i => i.blob);
      const r = await A.sample(turns, opts);
      agentMsg.text = r.text; if (r.truncated) agentMsg.error = 'Cut short: ask for less at a time.';
    } catch (e) {
      agentMsg.text = e.text || agentMsg.text || '';
      const map = { cancelled: '', not_granted: 'You have not allowed this page to use Claude. The panel still works as a console (start with >).', rate_limited: 'Too many calls for now; try again in a little while.', refused: 'Claude declined this request.', prompt_too_large: 'Too much context; select fewer clips or start a new thread.', images_unavailable: 'This view cannot send images.', image_rejected: 'An image was rejected (type or size).', tools_unavailable: 'This view cannot run page tools, so the agent cannot act; it can still answer.', session_expired: 'Sign in again to continue.', sampling_disabled: 'Claude is not available for this account.' };
      agentMsg.error = map[e.code] !== undefined ? map[e.code] : (e.message || 'Something failed (' + e.code + ').');
      if (e.code === 'not_granted' || e.code === 'sampling_disabled') A.available = false;
      if (e.code === 'tools_unavailable') A.noTools = true;
      console.warn('sample failed', e);
    } finally {
      agentMsg.status = 'done'; A.busy = null; setBusy(false); A.attachments = []; renderAttachments();
      const old = agentMsg._el; const n = msgEl(agentMsg); if (old && old.parentNode) old.replaceWith(n); else $msgs.append(n); $msgs.scrollTop = $msgs.scrollHeight; save();
    }
  };
  function setBusy(b) { $panel.classList.toggle('busy', b); $panel.querySelector('.send').textContent = b ? 'Stop' : 'Send'; }
  A.stop = () => { if (A.busy) { A.busy.ctl.abort(); (A.busy.msg.steps || []).forEach(s => s._resolve && s._resolve(false)); } };
  A.prefill = (t) => { A.toggle(true); $ta.value = ($ta.value ? $ta.value + ' ' : '') + t; $ta.focus(); $ta.setSelectionRange($ta.value.length, $ta.value.length); renderAttachments(); };
  A.toggle = (open) => { A.open = open === undefined ? !A.open : open; document.body.classList.toggle('agent-open', A.open); PB.meta('agentOpen', A.open); if (A.open) setTimeout(() => $ta.focus(), 0); };

  // ---------- init ----------
  A.init = async function () {
    $panel = document.getElementById('agentpanel'); $msgs = $panel.querySelector('.msgs'); $ta = $panel.querySelector('textarea'); $att = $panel.querySelector('.attachments'); $threads = $panel.querySelector('.threads');
    A.threads = (PB.meta('threads') || []).map(t => Object.assign({}, t)); A.cur = A.threads[0] || null; A.mode = PB.meta('agentMode') || 'ask'; A.tier = PB.meta('agentTier') || 'default';
    A.threads.forEach(t => t.msgs.forEach(m => (m.steps || []).forEach(s => { A._step = Math.max(A._step, s.n || 0); if (s.status === 'waiting' || s.status === 'running') s.status = 'declined'; })));
    if (!A.cur) newThread('first thread');
    renderThreads(); renderMsgs();
    // mode / tier controls
    const modes = $panel.querySelector('.modes'); const tiers = $panel.querySelector('.tiers');
    const drawSeg = (host, opts, cur, set) => { host.innerHTML = ''; opts.forEach(([v, l]) => { const b = el('button', 'segb' + (v === cur ? ' on' : ''), l); b.addEventListener('click', () => { set(v); save(); drawSeg(host, opts, v, set); }); host.append(b); }); };
    drawSeg(modes, [['auto', 'Auto'], ['ask', 'Ask'], ['readonly', 'Read-only']], A.mode, v => A.mode = v);
    drawSeg(tiers, [['quick', 'Fast'], ['default', 'Balanced'], ['complex', 'Deep']], A.tier, v => A.tier = v);
    $panel.querySelector('.send').addEventListener('click', () => A.busy ? A.stop() : A.send());
    $ta.addEventListener('keydown', ev => { PB.keyStop(ev); if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); A.send(); } if (ev.key === 'Escape') $ta.blur(); });
    $ta.addEventListener('input', () => renderAttachments());
    $ta.addEventListener('paste', async ev => { const items = [...(ev.clipboardData && ev.clipboardData.items || [])].filter(i => i.type.startsWith('image/')); if (!items.length) { ev.stopPropagation(); return; } ev.preventDefault(); ev.stopPropagation(); for (const it of items) { const f = it.getAsFile(); if (f) await A.attach(f, f.name || 'pasted image'); } });
    const comp = $panel.querySelector('.composer');
    comp.addEventListener('dragover', ev => { ev.preventDefault(); comp.classList.add('droptarget'); }); comp.addEventListener('dragleave', () => comp.classList.remove('droptarget'));
    comp.addEventListener('drop', async ev => { ev.preventDefault(); comp.classList.remove('droptarget'); const files = [...(ev.dataTransfer.files || [])].filter(f => f.type.startsWith('image/')); for (const f of files) await A.attach(f, f.name); const item = await PB.itemFromDataTransfer(ev.dataTransfer); if (!files.length && item && item.url) A.prefill(item.url); });
    $msgs.addEventListener('click', ev => { const a = ev.target.closest('a[data-focus]'); if (a) { ev.preventDefault(); PB.board.focus(a.dataset.focus); } });
    $panel.querySelector('.close').addEventListener('click', () => A.toggle(false));
    document.getElementById('agentbtn').addEventListener('click', () => A.toggle());
    PB.on('selection', () => A.open && renderAttachments());
    PB.on('blobs', () => A.open && renderAttachments());
    if (PB.meta('agentOpen') !== false) { A.open = true; document.body.classList.add('agent-open'); }
    // Claude
    const off = $panel.querySelector('.offbanner');
    try {
      if (window.claude && claude.use) {
        const s = await claude.use('sample');
        if (s) { A.sample = s; A.available = true; try { A.limits = await s.limits(); } catch (e) { A.limits = null; } off.style.display = 'none'; if (!(A.limits && A.limits.tools)) { off.style.display = ''; off.textContent = 'This view cannot run page tools: the agent can answer but not act.'; } }
        else { off.textContent = 'Claude is not available in this view. The panel works as a console: start a message with > to run code against the board API.'; }
      } else off.textContent = 'Claude is not available outside claude.ai. The panel works as a console: start a message with > to run code against the board API.';
    } catch (e) { off.textContent = 'Claude could not be reached: ' + (e.message || e); }
    $ta.placeholder = A.available ? 'ask the agent · ⌘↩ sends · > runs code · paste an image to show it' : 'console · > describe()  · ⌘↩ runs';
    renderAttachments();
  };
})(window.PB);
