// Start here, Site, Stores and Data.
import React, { useEffect, useRef, useState } from 'react';
import { useLab, useK, useLocal, Table, Json, Trace, Err, StorePick, fmtDate, fmtDur, short, Empty, Menu } from './ui.jsx';

export function DownloadMenu({ id, label = 'Download ▾', className = 'btn sm' }) {
  const { downloadStore } = useLab();
  return (
    <Menu className={className} right label={label} title={`Download ${id}`}>
      <button onClick={() => downloadStore(id, 'json')}><span className="t">{id}.json</span><small>documents, table rows, text files and the log, readable</small></button>
      <button onClick={() => downloadStore(id, 'sqlite')}><span className="t">{id}.sqlite, zipped</span><small>the store itself: open it with sqlite3 or DB Browser</small></button>
    </Menu>
  );
}

// ---------------------------------------------------------------- Start here
const SCENARIOS = [
  { t: 'A page, as two people', d: 'Open the blog as Ramon, who holds interact. Draft a post and publish it. Then put Ana, an invited guest, beside him: her frame updates live, and she sees no drafts but her own.',
    go: [['Open as Ramon, with Ana beside him', (L) => { L.setAs('usr_ramon'); L.setSiteAddr('site.lab/'); L.setSecond('gst_ana'); L.focus('site'); }]] },
  { t: 'One event, one turn', d: 'Every action is one SQLite transaction. Publishing commits a change to the posts table; the reactor table:posts then runs as its own turn and rewrites stats/main. Open a turn to see its statements, the authorizer\'s decisions and the changes it committed.',
    go: [['Show the turns', (L) => L.focus('turns')]] },
  { t: 'An await ends the turn', d: '"Publish in a minute" runs slowPublish: the first turn marks the title as scheduled and commits, then the actor waits on time.sleep. Advance the clock a minute and a second turn, the continuation, publishes the post.',
    go: [['Open the blog as you', (L) => { L.setAs('usr_me'); L.setSiteAddr('site.lab/'); L.focus('site'); }]] },
  { t: 'SQL under a policy', d: 'Admins get raw SQL, read-only unless --write. Kernel tables are readable by admins and actors, never writable by anyone but the kernel. Pages get structured queries over exposed views only.',
    go: [['Try four statements', async (L) => { L.setAs('usr_me'); for (const l of ['sql blog "DELETE FROM posts"', 'sql blog "UPDATE _log SET summary = \'x\'" --write', 'sql blog "SELECT rev, via, summary FROM _log ORDER BY rev DESC LIMIT 5"', 'sql blog "SELECT title FROM published_posts"']) await L.runConsole(l, { as: 'usr_me' }); }]] },
  { t: 'Hidden reads look missing', d: 'data/users/<id>/ is private to that person, even from the owner and admins. A read of someone else\'s subtree is not refused, it comes back empty: not_found and missing look the same.',
    go: [['Ask as Ramon', async (L) => { await L.runConsole('get team-board data/users/usr_me/notes', { as: 'usr_ramon' }); await L.runConsole('can usr_ramon team-board doc.read data/users/usr_me/notes', { as: 'usr_ramon' }); }]] },
  { t: 'A release that fails to activate', d: 'Make journal\'s smoke check throw, then publish. Activation runs the migrations, setup and smoke in one transaction; the throw rolls all of it back and blog keeps running journal@1. Then fix it and publish again.',
    go: [['Break it', async (L) => { await L.runConsole(`edit journal actor.js --old "sql.one('SELECT count(*) AS n FROM published_posts');" --new "throw new Error('smoke check failed on purpose');"`, { as: 'usr_me' }); await L.runConsole('publish journal a broken smoke check', { as: 'usr_me' }); }],
      ['Fix it', async (L) => { await L.runConsole(`edit journal actor.js --old "throw new Error('smoke check failed on purpose');" --new "sql.one('SELECT count(*) AS n FROM published_posts');"`, { as: 'usr_me' }); await L.runConsole('publish journal smoke check fixed', { as: 'usr_me' }); }]] },
  { t: 'A store from a URL', d: 'site.lab/t/:board mounts any store of type tracker. When none exists and the visitor may instantiate tracker, the mount offers to create one: a new store, with Kim as its owner.',
    go: [['Open site.lab/t/kims-board as Kim', (L) => { L.setAs('usr_kim'); L.setSecond(null); L.setSiteAddr('site.lab/t/kims-board'); L.focus('site'); }]] },
  { t: 'Capabilities need approval', d: 'journal declares sample for its actor. Until an admin approves sample for a specific version, use(\'sample\') returns null and summarize fails. Approve it in Access, then call summarize from the Actor view.',
    go: [['Open Access', (L) => L.focus('access')], ['Try summarize first', async (L) => { const r = await L.client.call('verb', { as: 'system', verb: 'sql', args: ['blog', 'SELECT id FROM posts LIMIT 1'] }); if (r[0]) await L.runConsole(`call blog summarize {"id":"${r[0].id}"}`, { as: 'usr_me' }); }]] },
  { t: 'Faults', d: 'Arm a crash: the next turn on blog dies mid-way and rolls back, and the caller gets "lost". Three crashes inside a minute mark the actor broken. A failed commit rolls back the same way.',
    go: [['Arm a crash on blog', (L) => L.runConsole('fault crash blog', { as: 'usr_me' })], ['Then draft a post', (L) => L.runConsole('call blog draft {"title":"Will this survive?"}', { as: 'usr_me' })]] },
  { t: 'Ask the agent', d: 'The agent works through the same verbs as the console, as a token that acts for you. Each request is a step: its commits are grouped, and you can revert the step.',
    go: [['Add tags to journal', (L) => { L.setAgentPrompt('Add tags to journal posts: a migration with a tags column, a way to set tags when drafting, and show them on the page. Publish it and check that blog activated.'); L.focus('agent'); }]] },
];

export function StartView() {
  const L = useLab();
  const [, setSecond] = useLocal('siteSecond', null);
  const api = { ...L, setSecond: (v) => { setSecond(v); window.dispatchEvent(new CustomEvent('lab:second', { detail: v })); } };
  return (
    <div className="tabbody col scroll startv">
      <div className="doc padded">
        <h1>A durable-object computer, in one tab</h1>
        <p className="lead">This is the v3 kernel running in your browser: every <b>store</b> is a SQLite database (sqlite-wasm), every <b>actor</b> is a QuickJS sandbox, and every event is a <b>turn</b>, one transaction. Apps are stores whose tree has <code>app.json</code>; mounts point URLs at stores. Nothing here is mocked: the views read the same kernel the pages use.</p>
        <dl className="kv keys">
          <dt>The world</dt><dd>two apps (journal, tracker), three data stores, six principals</dd>
          <dt>Who you are</dt><dd>the header's <b>as</b> menu: pages, the console and edits act as that principal</dd>
          <dt>Time</dt><dd>a virtual clock: pause it, or jump an hour and watch alarms fire in order</dd>
          <dt>Saving</dt><dd>the whole world is saved as SQLite images, privately, after each change</dd>
        </dl>
        <h2>Try these</h2>
        <ol className="scen">
          {SCENARIOS.map((s, i) => <li key={i}><b>{s.t}.</b> {s.d}<div className="hrow">{s.go.map(([label, f]) => <button key={label} className="btn sm" onClick={() => Promise.resolve(f(api)).catch(e => L.toast(e.message, true))}>{label}</button>)}</div></li>)}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Site
export function SiteView() {
  const { siteAddr, setSiteAddr, as, ov } = useLab();
  const [addr, setAddr] = useState(siteAddr);
  const [second, setSecond] = useLocal('siteSecond', null);
  const [showMounts, setShowMounts] = useState(false);
  useEffect(() => setAddr(siteAddr), [siteAddr]);
  useEffect(() => { const f = (e) => setSecond(e.detail); window.addEventListener('lab:second', f); return () => window.removeEventListener('lab:second', f); }, [setSecond]);
  const name = (id) => (ov.principals.find(p => p.id === id) || { name: id }).name;
  return (
    <div className="tabbody col">
      <div className="toolbar">
        <form className="addrform" onSubmit={(e) => { e.preventDefault(); setSiteAddr(addr.trim()); }}>
          <input className="filter addr" value={addr} onChange={e => setAddr(e.target.value)} aria-label="Address" placeholder="site.lab/ or store:blog" />
          <button className="btn">Go</button>
        </form>
        <span className="lbl">beside it, as</span>
        <select value={second || ''} onChange={e => setSecond(e.target.value || null)} aria-label="Second frame">
          <option value="">nobody</option>
          {ov.principals.filter(p => p.id !== as).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="sp" />
        <button className={'tog' + (showMounts ? ' on' : '')} onClick={() => setShowMounts(!showMounts)}>Mounts</button>
      </div>
      {showMounts && <Mounts />}
      <div className="frames">
        <Frame addr={siteAddr} as={as} who={name(as)} />
        {second && <Frame addr={siteAddr} as={second} who={name(second)} />}
      </div>
    </div>
  );
}

function Frame({ addr, as, who }) {
  const { client, ov, toast, setStore, focus } = useLab();
  const [res, setRes] = useState(null);
  const [view, setView] = useState(null);
  const [err, setErr] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [traceOpen, setTraceOpen] = useState(false);
  const sent = useRef(false), frame = useRef(null);
  const st = res && res.store ? ov.stores.find(s => s.id === res.store) : null;
  // A new version activated under an open view: reopen it, so the page runs the new code.
  useEffect(() => { if (view && st && st.running && view.version && st.running !== view.version) setNonce(n => n + 1); }, [st && st.running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true, opened = null;
    setErr(null); setView(null); sent.current = false;
    (async () => {
      let r;
      if (addr.startsWith('store:')) r = { kind: 'live', store: addr.slice(6).trim(), trace: [`store:${addr.slice(6).trim()}: opened directly, no mount`] };
      else { const [host, ...rest] = addr.replace(/^https?:\/\//, '').split('/'); r = await client.call('resolve', { host, path: '/' + rest.join('/'), as }); }
      if (!live) return;
      setRes(r);
      if (r.kind === 'live') {
        const ch = new MessageChannel();
        const v = await client.call('openView', { store: r.store, as }, [ch.port1]);
        if (!live) { client.call('closeView', { view: v.view }); return; }
        opened = v.view; setView({ ...v, port: ch.port2 });
      }
    })().catch(e => { if (live) setErr(e); });
    return () => { live = false; if (opened) client.call('closeView', { view: opened }).catch(() => {}); };
  }, [addr, as, nonce, client]);
  // The port goes to the page once. If the frame loads again (the dock moved it, which reloads an
  // iframe), its port is gone with the old document: open a fresh view.
  const onLoad = () => { if (!view || !frame.current) return; if (sent.current) { setNonce(n => n + 1); return; } sent.current = true; frame.current.contentWindow.postMessage({ type: 'slop:port' }, '*', [view.port]); };
  const logs = view ? ov.pageLogs.filter(l => l.view === view.view) : [];
  const create = async () => { try { await client.call('createFromMount', { app: res.app, id: res.suggested, as }); toast(`Created ${res.suggested}, owned by ${who}`); setNonce(n => n + 1); } catch (e) { toast(e.message, true); } };
  const summary = res ? (res.kind === 'live' && view ? `${view.store} · ${view.app ? `${view.app}@${view.version}` : 'no app'} · ${who} (${view.level})` : res.kind) : '…';
  return (
    <div className="frame">
      <div className="framebar">
        <button className="link" onClick={() => setTraceOpen(!traceOpen)} title="How this address resolved">{traceOpen ? '▾' : '▸'} {summary}</button>
        <span className="sp" />
        {res && res.store && <><button className="link" onClick={() => { setStore(res.store); focus('data'); }}>data</button><button className="link" onClick={() => { setStore(st && st.app ? st.app : res.store); focus('code'); }}>code</button></>}
        <button className="link" onClick={() => setNonce(n => n + 1)} title="Reload this frame">reload</button>
      </div>
      {traceOpen && res && <div className="framebody-trace"><Trace lines={res.trace} /></div>}
      <Err e={err} />
      {res && res.kind === 'live' && view && <iframe key={view.view} ref={frame} title={`${addr} as ${who}`} sandbox="allow-scripts allow-forms" srcDoc={view.html} onLoad={onLoad} />}
      {res && res.kind === 'http' && <div className="padded scroll"><p><b>HTTP {res.response.status}</b> <span className="dim">from an http route in actor.js, as {who}</span></p>{res.response.json !== undefined ? <Json value={res.response.json} /> : <pre className="src">{String(res.response.body ?? '')}</pre>}</div>}
      {res && res.kind === 'file' && <div className="padded scroll"><p><b>{res.type}</b> <span className="dim">{res.size} bytes, a file from the app's snapshot</span></p><pre className="src">{res.text ?? '(binary)'}</pre></div>}
      {res && res.kind === 'create' && <div className="padded"><p>No store <b>{res.suggested}</b> yet. This mount creates <b>{res.app}</b> stores on demand, and {who} may instantiate {res.app}.</p><button className="btn primary" onClick={create}>Create {res.suggested} as {who}</button></div>}
      {res && res.kind === 'denied' && <div className="padded"><p className="bad"><b>Refused.</b> {who} cannot see this.</p><Trace lines={res.trace} /></div>}
      {res && res.kind === '404' && <div className="padded"><p><b>Nothing here.</b></p><Trace lines={res.trace} /></div>}
      {logs.length > 0 && <div className="pagelog">{logs.slice(-6).map((l, i) => <div key={i} className={l.level === 'error' ? 'bad' : 'dim'}>{l.level}: {l.msg}</div>)}</div>}
    </div>
  );
}

function Mounts() {
  const { client, ov, as, toast } = useLab();
  const [f, setF] = useState({ at: 'site.lab/', target: '', type: '', create: '' });
  const save = async (e) => { e.preventDefault(); try { await client.call('run', { as, line: `mount ${f.at} ${f.target}${f.type ? ' --type ' + f.type : ''}${f.create ? ' --create ' + f.create : ''}` }); toast(`Mounted ${f.at}`); } catch (er) { toast(er.message, true); } };
  return (
    <div className="mounts">
      <Table rows={ov.mounts} cols={[{ k: 'at', h: 'host/path', r: m => <b>{m.host}{m.path}</b> }, { k: 'store', h: 'store', r: m => m.store || `:${m.store_param}` }, { k: 'type', h: 'type', r: m => m.type || '' }, { k: 'on_missing', h: 'missing', r: m => m.on_missing === 'create' ? `create ${m.create_app}` : '' }, { k: 'by', h: 'changed by', r: m => m.changed_by }]} />
      <form className="hrow" onSubmit={save}>
        <input className="filter" value={f.at} onChange={e => setF({ ...f, at: e.target.value })} placeholder="host/path" aria-label="Host and path" />
        <input className="filter" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} placeholder="store, or :param" aria-label="Store" />
        <input className="filter sm" value={f.type} onChange={e => setF({ ...f, type: e.target.value })} placeholder="type" aria-label="Type" />
        <input className="filter sm" value={f.create} onChange={e => setF({ ...f, create: e.target.value })} placeholder="create app" aria-label="Create app" />
        <button className="btn sm">Mount</button>
      </form>
      <p className="note dim">Mounts name stores, never code: the store decides which app version answers. Changing a mount is a platform-admin act.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Stores
export function StoresView() {
  const { client, ov, as, setStore, focus, setSiteAddr, toast, downloadStore } = useLab();
  const [levels] = useK(() => client.call('verb', { as, verb: 'stores' }).catch(() => []), [as]);
  const [nf, setNf] = useState({ id: '', app: '', from: '' });
  const lvl = (id) => (levels || []).find(s => s.id === id)?.level || 'none';
  const apps = ov.stores.filter(s => s.isApp);
  const create = async (e) => {
    e.preventDefault();
    try { const r = await client.call('run', { as, line: `new ${nf.id}${nf.app ? ' --app ' + nf.app : ''}${nf.from ? ' --from ' + nf.from : ''}` }); toast(`Created ${nf.id}`); setNf({ id: '', app: '', from: '' }); }
    catch (er) { toast(`${er.code}: ${er.message}`, true); }
  };
  return (
    <div className="tabbody col scroll">
      <div className="padded">
        <p className="note">A store is one SQLite file: documents, files, app tables, its log, snapshots and refs. An app is a store whose tree has <code>app.json</code>; a data store runs an app's <code>main</code>. <b>download</b> gives you a store as readable JSON or as its SQLite file; World ▾ › Export world gives you all of them in one .zip.</p>
        <Table rows={ov.stores} onRow={(s) => setStore(s.id)} cols={[
          { k: 'id', h: 'store', r: s => <b>{s.id}</b> },
          { k: 'type', h: 'type' },
          { k: 'code', h: 'runs', r: s => s.app ? <span className={s.failed ? 'bad' : ''}>{s.app}@{s.running || '–'}{s.main && s.main !== s.running ? ` (main ${s.main}${s.failed ? ' failed' : ''})` : ''}</span> : s.isApp ? <span className="dim">app · main {s.main || '–'}</span> : '' },
          { k: 'rev', h: 'rev', num: true },
          { k: 'actor', h: 'actor', r: s => s.actor ? <span className={s.actor.state === 'broken' || s.actor.reactorErrors ? 'bad' : ''}>{s.actor.state}{s.actor.waiting ? ` · ${s.actor.waiting} waiting` : ''}</span> : '' },
          { k: 'owner', h: 'owner' },
          { k: 'level', h: `level as ${as}`, r: s => lvl(s.id) },
          { k: 'go', h: '', r: s => <span className="acts">{s.app && <button className="link" onClick={(e) => { e.stopPropagation(); setSiteAddr('store:' + s.id); focus('site'); }}>open</button>}<button className="link" onClick={(e) => { e.stopPropagation(); setStore(s.id); focus('data'); }}>data</button><button className="link" onClick={(e) => { e.stopPropagation(); setStore(s.id); focus('code'); }}>files</button><span onClick={(e) => e.stopPropagation()}><DownloadMenu id={s.id} className="link" label="download" /></span></span> },
        ]} />
        <h3>New store</h3>
        <form className="hrow wrap" onSubmit={create}>
          <input className="filter" required value={nf.id} onChange={e => setNf({ ...nf, id: e.target.value.toLowerCase() })} placeholder="id, e.g. notes" aria-label="Store id" />
          <select value={nf.app} onChange={e => setNf({ ...nf, app: e.target.value, from: '' })} aria-label="App"><option value="">no app</option>{apps.map(a => <option key={a.id} value={a.id}>runs {a.id}</option>)}</select>
          <select value={nf.from} onChange={e => setNf({ ...nf, from: e.target.value, app: '' })} aria-label="Fork from"><option value="">empty</option>{ov.stores.filter(s => s.id !== 'system').map(s => <option key={s.id} value={s.id}>fork of {s.id}</option>)}</select>
          <button className="btn">Create as {as}</button>
        </form>
        <h3>Activations</h3>
        <Table rows={ov.activations} empty="None yet." cols={[{ k: 'at', h: 'at', r: a => fmtDate(a.at) }, { k: 'store', h: 'store' }, { k: 'code', h: 'code', r: a => `${a.app}@${a.version}` }, { k: 'ok', h: 'result', r: a => a.ok ? (a.steps.join(', ') || 'nothing to run') : <span className="bad">rolled back: {short(a.error, 90)}</span> }]} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Data
export function DataView() {
  const { client, store, setStore, as, toast, ov } = useLab();
  const [sel, setSel] = useState({ kind: 'sql' });
  const [info, infoErr] = useK(() => client.call('storeInfo', { id: store }), [store]);
  useEffect(() => { setSel(s => (s.kind === 'sql' ? s : { kind: 'sql' })); }, [store]);
  return (
    <div className="tabbody col">
      <div className="toolbar"><StorePick value={store} onChange={setStore} /><span className="lbl">browsing as system · writes and SQL as <b>{as}</b></span>{info && <span className="lbl">rev {info.rev} · epoch {info.epoch}</span>}<span className="sp" /><DownloadMenu id={store} /></div>
      <Err e={infoErr} />
      {info && <div className="split2">
        <nav className="listnav">
          <div className="grp">Documents</div>
          {info.colls.length ? info.colls.map(c => <button key={c.coll} className={sel.kind === 'coll' && sel.name === c.coll ? 'on' : ''} onClick={() => setSel({ kind: 'coll', name: c.coll })}>{c.coll}<small>{c.n}</small></button>) : <p className="empty">none</p>}
          <button className={sel.kind === 'newdoc' ? 'on' : ''} onClick={() => setSel({ kind: 'newdoc' })}>+ document</button>
          <div className="grp">SQL</div>
          {info.tables.map(t => <button key={t.name} className={sel.kind === 'table' && sel.name === t.name ? 'on' : ''} onClick={() => setSel({ kind: 'table', name: t.name })}>{t.name}<small>{t.type === 'view' ? 'view' : t.rows}</small></button>)}
          <button className={sel.kind === 'sql' ? 'on' : ''} onClick={() => setSel({ kind: 'sql' })}>› SQL console</button>
          <div className="grp">Kernel</div>
          {['_log', '_changes', '_docs', '_files', '_cursors', '_alarms', '_migrations', '_meta'].map(n => <button key={n} className={sel.kind === 'ktable' && sel.name === n ? 'on' : ''} onClick={() => setSel({ kind: 'ktable', name: n })}>{n}</button>)}
        </nav>
        <div className="pane">
          {sel.kind === 'coll' && <Docs store={store} coll={sel.name} />}
          {sel.kind === 'newdoc' && <DocEditor store={store} path="" isNew />}
          {(sel.kind === 'table' || sel.kind === 'ktable') && <Rows store={store} name={sel.name} info={info} />}
          {sel.kind === 'sql' && <SqlConsole store={store} info={info} />}
        </div>
      </div>}
    </div>
  );
}

function Docs({ store, coll }) {
  const { client } = useLab();
  const [docs, e] = useK(() => client.call('docs', { store, coll }), [store, coll]);
  const [open, setOpen] = useState(null);
  return (
    <div className="scroll padded">
      <Err e={e} />
      <Table rows={docs} sel={open} onRow={(d) => setOpen(d.path === open ? null : d.path)} cols={[{ k: 'path', h: 'path', r: d => <b>{d.path}</b> }, { k: 'version', h: 'v', num: true }, { k: 'rev', h: 'rev', num: true }, { k: 'data', h: 'data', r: d => <code>{short(d.data, 90)}</code> }]} />
      {open && <DocEditor key={open} store={store} path={open} />}
    </div>
  );
}

function DocEditor({ store, path, isNew }) {
  const { client, as, toast } = useLab();
  const [p, setP] = useState(path || '');
  const [text, setText] = useState(isNew ? '{\n  \n}' : '');
  const [err, setErr] = useState(null);
  const [doc] = useK(() => (path ? client.call('doc', { store, path }) : Promise.resolve(null)), [store, path], []);
  useEffect(() => { if (doc) setText(JSON.stringify(doc.data, null, 2)); }, [doc]);
  const save = async () => { setErr(null); try { JSON.parse(text); const r = await client.call('verb', { as, verb: 'set', args: [store, p, text], flags: {} }); toast(`${p} → version ${r.version}, as ${as}`); } catch (e) { setErr(e); } };
  const del = async () => { setErr(null); try { await client.call('verb', { as, verb: 'del', args: [store, p] }); toast(`Deleted ${p}`); } catch (e) { setErr(e); } };
  return (
    <div className="doced">
      <div className="hrow">{isNew ? <input className="filter" value={p} onChange={e => setP(e.target.value)} placeholder="collection/id" aria-label="Document path" /> : <b>{path}</b>}{doc && <span className="dim">version {doc.version} · rev {doc.rev} · by {doc.by}</span>}<span className="sp" /><button className="btn sm primary" onClick={save}>Save as {as}</button>{!isNew && <button className="btn sm danger" onClick={del}>Delete</button>}</div>
      <textarea className="codearea" value={text} onChange={e => setText(e.target.value)} spellCheck={false} rows={Math.min(18, text.split('\n').length + 1)} aria-label="Document JSON" />
      <Err e={err} />
    </div>
  );
}

function Rows({ store, name, info }) {
  const { client } = useLab();
  const t = info.tables.find(x => x.name === name);
  const [rows, e] = useK(() => client.call('verb', { as: 'system', verb: 'sql', args: [store, `SELECT * FROM "${name}" ${name.startsWith('_') ? 'ORDER BY rowid DESC' : ''} LIMIT 200`.replace('ORDER BY rowid DESC', name === '_log' ? 'ORDER BY rev DESC' : name === '_changes' ? 'ORDER BY rev DESC, seq' : '')] }), [store, name]);
  return (
    <div className="scroll padded">
      {t && t.sql && <pre className="src">{t.sql}</pre>}
      <Err e={e} />
      <Table rows={rows} empty="No rows." />
    </div>
  );
}

function SqlConsole({ store, info }) {
  const { client, as } = useLab();
  const [q, setQ] = useLocal('sql.' + store, info.tables.length ? `SELECT * FROM ${info.tables[0].name} LIMIT 20` : 'SELECT name, type FROM sqlite_schema');
  const [write, setWrite] = useState(false);
  const [out, setOut] = useState(null);
  const run = async () => {
    const before = (await client.call('overview')).turnSeq;
    let rows = null, error = null;
    try { rows = await client.call('verb', { as, verb: 'sql', args: [store, q], flags: write ? { write: true } : {} }); } catch (e) { error = e; }
    const turns = await client.call('turns', { since: before });
    const t = turns.filter(x => x.store === store).pop();
    const full = t ? await client.call('turn', { id: t.id }) : null;
    setOut({ rows, error, turn: full });
  };
  const st = out && out.turn && out.turn.statements && out.turn.statements[0];
  return (
    <div className="scroll padded sqlc">
      <textarea className="codearea" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }} spellCheck={false} rows={4} aria-label="SQL" />
      <div className="hrow"><button className="btn primary sm" onClick={run}>Run as {as} <kbd>⌘↵</kbd></button><button className={'tog' + (write ? ' on' : '')} onClick={() => setWrite(!write)}>--write</button><span className="dim">Admin SQL: read-only unless --write. The authorizer still applies: no kernel-table writes, no DDL outside migrations.</span></div>
      {out && <>
        <Err e={out.error} />
        {Array.isArray(out.rows) ? <Table rows={out.rows} empty="No rows." /> : out.rows ? <Json value={out.rows} /> : null}
        {st && st.auth && st.auth.length > 0 && <><h3>The authorizer, statement by statement</h3><Table rows={st.auth} cols={[{ k: 'action', h: 'action' }, { k: 'a', h: 'object', r: x => x.a || '' }, { k: 'b', h: 'column / arg', r: x => x.b || '' }, { k: 'via', h: 'via view', r: x => x.via || '' }, { k: 'ok', h: 'decision', r: x => x.ok ? 'allow' : <span className="bad">deny: {x.why}</span> }]} /></>}
        {out.turn && <p className="dim">Turn {out.turn.id}: {out.turn.status}{out.turn.rev ? `, rev ${out.turn.rev}` : ''} · {out.turn.ms} ms</p>}
      </>}
    </div>
  );
}
