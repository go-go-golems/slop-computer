// Code, Log, Actor and Turns.
import React, { useEffect, useMemo, useState } from 'react';
import { useLab, useK, useLocal, Table, Json, Trace, Err, StorePick, fmtDate, fmtDur, fmtTime, short, Empty } from './ui.jsx';

// ---------------------------------------------------------------- Code
export function CodeView() {
  const { client, store: picked, setStore, as, toast, ov } = useLab();
  // A data store's code lives in its app's store: show that tree unless the data store has files of its own.
  const ps = ov.stores.find(s => s.id === picked);
  const [own, setOwn] = useState(false);
  const store = ps && ps.app && !ps.isApp && !own ? ps.app : picked;
  const [info, infoErr] = useK(() => client.call('storeInfo', { id: store }), [store]);
  const [path, setPath] = useLocal('code.path.' + store, null);
  const [text, setText] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState('');
  const [pub, setPub] = useState(null);
  const [diff, setDiff] = useState(null);
  const [newName, setNewName] = useState('');
  const files = info ? info.files : [];
  const cur = path && files.find(f => f.path === path) ? path : (files.find(f => f.path === 'actor.js') || files.find(f => f.path === 'index.html') || files[0] || {}).path;
  const curFile = files.find(f => f.path === cur);
  const dirty = text != null && loaded != null && text !== loaded.text;
  useEffect(() => {
    if (!cur) { setText(null); setLoaded(null); return; }
    if (dirty && loaded && loaded.path === cur) return; // keep unsaved edits
    client.call('file', { store, path: cur }).then(f => { setLoaded({ path: cur, text: f ? f.text : '', sha: curFile && curFile.sha256 }); setText(f ? f.text : ''); }, setErr);
  }, [store, cur, curFile && curFile.sha256]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => { setErr(null); try { await client.call('verb', { as, verb: 'write', args: [store, cur], input: text }); setLoaded({ path: cur, text }); toast(`Saved ${cur} to the working tree. Publish to ship it.`); } catch (e) { setErr(e); } };
  const publish = async () => { setErr(null); setPub(null); try { const r = await client.call('verb', { as, verb: 'publish', args: [store, msg] }); setPub(r); setMsg(''); toast(`Snapshot ${r.snapshot} is main`); } catch (e) { setErr(e); } };
  const rollback = async (n) => { try { const r = await client.call('verb', { as, verb: 'ref', args: [store, 'main', String(n)] }); setPub({ snapshot: n, activations: r.activations, rollback: true }); toast(`main → snapshot ${n}`); } catch (e) { setErr(e); } };
  const showDiff = async () => { try { setDiff(await client.call('verb', { as, verb: 'diff', args: [store] })); } catch (e) { setErr(e); } };
  const create = async (e) => { e.preventDefault(); if (!newName) return; try { await client.call('verb', { as, verb: 'write', args: [store, newName], input: '' }); setPath(newName); setNewName(''); } catch (er) { setErr(er); } };
  const remove = async () => { try { await client.call('verb', { as, verb: 'rm', args: [store, cur] }); setPath(null); } catch (e) { setErr(e); } };
  const main = info && info.refs.find(r => r.name === 'main');
  return (
    <div className="tabbody col">
      <div className="toolbar"><StorePick value={store} onChange={setStore} /><span className="lbl">the working tree of {store}{main ? ` · main is snapshot ${main.n}` : ' · never published'}</span><span className="sp" /><span className="lbl">saves as <b>{as}</b></span></div>
      {ps && ps.app && !ps.isApp && <div className="codenote">{picked} runs {ps.app}@{ps.running}: {own ? <>showing {picked}'s own files. <button className="link" onClick={() => setOwn(false)}>show {ps.app}'s code</button></> : <>showing {ps.app}'s tree, the code it runs. <button className="link" onClick={() => setOwn(true)}>show {picked}'s own files</button></>}</div>}
      <Err e={infoErr} />
      {info && <div className="split3">
        <nav className="listnav">
          <div className="grp">Files</div>
          {files.map(f => <button key={f.path} className={f.path === cur ? 'on' : ''} onClick={() => setPath(f.path)}>{f.path}{f.path === cur && dirty ? ' •' : ''}<small>{f.size}</small></button>)}
          <form onSubmit={create} className="newfile"><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="new file, e.g. sql/002_tags.sql" aria-label="New file" /></form>
        </nav>
        <div className="pane edpane">
          {cur ? <>
            <div className="toolbar filebar"><b>{cur}</b>{dirty && <span className="dim">edited</span>}<span className="sp" /><button className="btn sm" disabled={!dirty} onClick={() => setText(loaded.text)}>Revert</button><button className="btn sm danger" onClick={remove}>Delete</button><button className={'btn sm' + (dirty ? ' primary' : '')} disabled={!dirty} onClick={save}>Save <kbd>⌘S</kbd></button></div>
            <textarea className="codearea full" value={text ?? ''} spellCheck={false} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (dirty) save(); } if (e.key === 'Tab') { e.preventDefault(); const t = e.target, a = t.selectionStart; setText(t.value.slice(0, a) + '  ' + t.value.slice(t.selectionEnd)); setTimeout(() => { t.selectionStart = t.selectionEnd = a + 2; }); } }} aria-label={`Contents of ${cur}`} />
          </> : <Empty>This store's tree is empty. Make a file with app.json to turn it into an app.</Empty>}
          <Err e={err} />
        </div>
        <aside className="side">
          <div className="block"><header><h2>Publish</h2><span className="sub">snapshot the tree, move main</span></header>
            <input className="filter" value={msg} onChange={e => setMsg(e.target.value)} placeholder="what changed" aria-label="Message" />
            <button className="btn primary" onClick={publish} disabled={dirty} title={dirty ? 'Save first' : ''}>Publish {store}</button>
            {info.isApp && <p className="note">Every store that runs {store} activates the new main: migrations, setup and smoke in one transaction.{info.instances.length ? ` Runs in: ${info.instances.join(', ')}.` : ''}</p>}
            {pub && <div className="pubres">{pub.unchangedFrom && <p className="dim">Same tree as snapshot {pub.unchangedFrom}.</p>}{(pub.activations || []).map(a => <div key={a.store} className={a.ok ? '' : 'bad'}><b>{a.store}</b>: {a.ok ? `${store}@${a.version} · ${a.steps}` : `rolled back, still on ${store}@${a.running || '–'}. ${a.error}`}</div>)}</div>}
            <button className="link" onClick={showDiff}>diff the working tree against main</button>
            {diff && (diff.length ? diff.map(d => <div key={d.path} className="diffr"><b>{d.path}</b> <span className="dim">{d.change}</span>{d.lines && <pre className="src diff">{d.lines.map((l, i) => <div key={i} className={l[0] === '+' ? 'add' : 'del'}>{l}</div>)}</pre>}</div>) : <p className="dim">No changes since main.</p>)}
          </div>
          <div className="block"><header><h2>Snapshots</h2><span className="sub">{info.snapshots.length}</span></header>
            {info.snapshots.length ? info.snapshots.map(s => <div key={s.n} className="snap"><b>{s.n}</b>{main && main.n === s.n && <span className="tagm">main</span>} <span>{s.message || <i className="dim">no message</i>}</span><div className="dim">{s.by} · {fmtDate(s.at)}{main && main.n !== s.n && <> · <button className="link" onClick={() => rollback(s.n)}>make main</button></>}</div></div>) : <p className="empty">None.</p>}
          </div>
        </aside>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- Log
export function LogView() {
  const { client, store, setStore, ov, as, toast } = useLab();
  const [info, e] = useK(() => client.call('storeInfo', { id: store }), [store], ['commit']);
  const [open, setOpen] = useState(null);
  const revert = async (id) => { try { const r = await client.call('verb', { as, verb: 'revert', args: [id] }); toast(`Reverted ${id}: ${r.report.length} changes`); } catch (er) { toast(er.message, true); } };
  return (
    <div className="tabbody col scroll">
      <div className="toolbar"><StorePick value={store} onChange={setStore} /><span className="lbl">every commit, newest first: who, through which door, and what changed</span></div>
      <Err e={e} />
      <div className="padded">
        {info && <Table rows={info.commits} sel={open} onRow={(c) => setOpen(open === c.rev ? null : c.rev)} cols={[
          { k: 'rev', h: 'rev', num: true }, { k: 'at', h: 'at', r: c => fmtTime(c.at) }, { k: 'principal', h: 'principal' }, { k: 'via', h: 'via' }, { k: 'summary', h: 'summary' },
          { k: 'changes', h: 'changes', r: c => open === c.rev ? <div className="chg">{c.changes.map((x, i) => <div key={i}><span className="dim">{x.kind}</span> {x.key} <span className="dim">{x.op}{x.version ? ` v${x.version}` : ''}</span></div>)}</div> : <span className="dim">{short(c.changes.map(x => `${x.kind}:${x.key}`).join(' '), 60)}</span> },
        ]} />}
        <h3>Steps</h3>
        <p className="note">A step groups the commits of one agent request or one <code>step begin</code> … <code>step end</code> in the console. Reverting writes the old documents, files and refs back; table changes are listed but not undone.</p>
        <Table rows={ov.steps} empty="No steps yet." cols={[{ k: 'id', h: 'step' }, { k: 'principal', h: 'by' }, { k: 'message', h: 'message', r: s => short(s.message, 60) }, { k: 'commits', h: 'commits', r: s => s.commits.map(c => `${c.store}@${c.rev}`).join(' ') }, { k: 'state', h: 'state' }, { k: 'x', h: '', r: s => s.state !== 'reverted' && s.commits.length ? <button className="link" onClick={() => revert(s.id)}>revert</button> : null }]} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Actor
export function ActorView() {
  const { client, store, setStore, as, toast, ov, setSiteAddr, focus } = useLab();
  const [info, e] = useK(() => client.call('storeInfo', { id: store }), [store]);
  const [args, setArgs] = useLocal('actor.args', { draft: '{"title": "A post from the Actor view", "body": "Called directly, not through a page."}', publish: '{"id": ""}', slowPublish: '{"id": "", "delayMs": 60000}', summarize: '{"id": ""}' });
  const [results, setResults] = useState({});
  const a = info && info.actor;
  const desc = a && a.desc;
  const call = async (name) => {
    setResults(r => ({ ...r, [name]: { busy: true } }));
    try { const v = await client.call('verb', { as, verb: 'call', args: [store, name, args[name] || '{}'] }); setResults(r => ({ ...r, [name]: { v } })); }
    catch (er) { setResults(r => ({ ...r, [name]: { e: er } })); }
  };
  const mount = ov.mounts.find(m => m.store === store);
  if (info && !info.app) return <div className="tabbody col"><div className="toolbar"><StorePick value={store} onChange={setStore} /></div><Empty>{store} runs no app, so it has no actor. Stores that run an app with actor.js get one actor each.</Empty></div>;
  return (
    <div className="tabbody col scroll">
      <div className="toolbar"><StorePick value={store} onChange={setStore} filter={s => !!s.app} />
        <span className="sp" />
        <button className="btn sm" onClick={() => client.call('run', { as: 'usr_me', line: `fault crash ${store}` }).then(() => toast(`The next turn on ${store} will crash`))}>Crash the next turn</button>
        <button className="btn sm" onClick={() => client.call('run', { as: 'usr_me', line: `fault fail-commit ${store}` }).then(() => toast(`The next commit on ${store} will fail`))}>Fail the next commit</button>
        <button className="btn sm" onClick={() => client.call('verb', { as, verb: 'activate', args: [store] }).then(() => toast(`Activated ${store}`), er => toast(er.message, true))}>Activate main</button>
      </div>
      <Err e={e} />
      {info && <div className="padded actorv">
        <dl className="kv wide">
          <dt>state</dt><dd className={a && a.state === 'broken' ? 'bad' : ''}>{a ? a.state : 'cold (wakes on the next event)'}</dd>
          <dt>code</dt><dd>{info.app}@{info.version || '–'}{info.main !== info.version ? <span className={info.failed ? 'bad' : 'dim'}> · main is {info.main}{info.failed ? ', its activation failed' : ''}</span> : ''}</dd>
          {a && <><dt>turns · cpu</dt><dd>{a.turns} · {a.cpuMs} ms</dd><dt>inbox · waiting on an await</dt><dd>{a.inbox.length} · {a.waiting.length}{a.waiting.length ? ` (${a.waiting.join(', ')})` : ''}</dd></>}
          <dt>store head</dt><dd>rev {info.rev}</dd>
        </dl>
        {a && a.errors.length > 0 && <div className="errbox"><b>recent errors</b>{a.errors.map((x, i) => <div key={i}>{x}</div>)}</div>}
        {!desc && <p className="note">The actor is cold. It boots on its next event; calling an action wakes it.</p>}
        {desc && <>
          <h3>Actions <span className="dim">run as {as}</span></h3>
          {desc.actions.map(n => <div key={n} className="actrow">
            <b>{n}</b><input className="filter" value={args[n] ?? '{}'} onChange={ev => setArgs({ ...args, [n]: ev.target.value })} aria-label={`Arguments for ${n}`} spellCheck={false} /><button className="btn sm" onClick={() => call(n)}>Call</button>
            {results[n] && <div className="actres">{results[n].busy ? <span className="dim">running… (an await ends the turn; advance the clock if it sleeps)</span> : results[n].e ? <span className="bad">{results[n].e.code}: {results[n].e.message}</span> : <code>{short(results[n].v, 200)}</code>}</div>}
          </div>)}
          <h3>HTTP routes</h3>
          {desc.http.length ? desc.http.map(h => { const path = h.route.split(' ').pop(); return <div key={h.route} className="actrow"><b>{h.route}</b><span className="dim">needs {h.level}</span>{mount && <button className="link" onClick={() => { setSiteAddr(mount.host + (mount.path === '/' ? '' : mount.path) + path); focus('site'); }}>open {mount.host}{mount.path === '/' ? '' : mount.path}{path}</button>}</div>; }) : <p className="empty">None.</p>}
          <h3>Reactors <span className="dim">synchronous, exactly once per commit, from a cursor</span></h3>
          {desc.on.length ? <Table rows={desc.on.map(k => { const c = info.cursors.find(x => x.name === k); return { key: k, cursor: c ? c.rev : '–', behind: c ? info.rev - c.rev : '', error: a && a.reactorErrors[k] }; })} cols={[{ k: 'key', h: 'selector', r: r => <b>{r.key}</b> }, { k: 'cursor', h: 'cursor', num: true }, { k: 'behind', h: 'commits since', num: true }, { k: 'error', h: 'error', r: r => r.error ? <span className="bad">{r.error}</span> : '' }]} /> : <p className="empty">None.</p>}
          <h3>Alarms <span className="dim">at least once, on the virtual clock</span></h3>
          {info.alarms.length ? <Table rows={info.alarms} cols={[{ k: 'name', h: 'name', r: x => <b>{x.name}</b> }, { k: 'every', h: 'every', r: x => x.every || 'once' }, { k: 'at', h: 'due', r: x => `${fmtTime(x.at)} (in ${fmtDur(x.at - ov.now)})` }, { k: 'running', h: 'state', r: x => x.running ? 'running' : 'waiting' }, { k: 'go', h: '', r: x => <button className="link" onClick={() => client.call('clockSet', { advance: Math.max(1, x.at - ov.now + 1) })}>advance to it</button> }]} /> : <p className="empty">None.</p>}
        </>}
        <h3>Activations</h3>
        <Table rows={info.activations} empty="None in this session." cols={[{ k: 'at', h: 'at', r: x => fmtDate(x.at) }, { k: 'v', h: 'code', r: x => `${x.app}@${x.version}` }, { k: 'r', h: 'result', r: x => x.ok ? x.steps.join(', ') || 'nothing to run' : <span className="bad">rolled back: {x.error}</span> }]} />
        <h3>Migrations applied</h3>
        <Table rows={info.migrations} empty="None." cols={[{ k: 'name', h: 'name' }, { k: 'app', h: 'app' }, { k: 'rev', h: 'rev', num: true }]} />
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- Turns
const STATUS = ['commit', 'rollback', 'denied', 'read', 'no writes'];
export function TurnsView() {
  const { client, ov, turnSel, setTurnSel } = useLab();
  const [turns] = useK(() => client.call('turns', { limit: 400 }), [], ['turn']);
  const [store, setStore] = useLocal('turns.store', '');
  const [show, setShow] = useLocal('turns.show', { commit: true, rollback: true, denied: true, read: false, 'no writes': true });
  const list = useMemo(() => (turns || []).filter(t => (!store || t.store === store) && (show[t.status] ?? true)).reverse(), [turns, store, show]);
  const counts = useMemo(() => { const c = {}; for (const t of turns || []) c[t.status] = (c[t.status] || 0) + 1; return c; }, [turns]);
  return (
    <div className="tabbody col">
      <div className="toolbar">
        <select value={store} onChange={e => setStore(e.target.value)} aria-label="Store"><option value="">every store</option>{ov.stores.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select>
        <div className="chips evchips">{STATUS.map(s => <button key={s} className={show[s] ? 'on' : ''} onClick={() => setShow({ ...show, [s]: !show[s] })}>{s} <small>{counts[s] || 0}</small></button>)}</div>
      </div>
      <div className="turnsplit">
        <div className="evlist turnlist">
          {list.map(t => <div key={t.id} className={'ev trow' + (t.id === turnSel ? ' sel' : '') + (t.status === 'rollback' || t.status === 'denied' ? ' bad' : '')} onClick={() => setTurnSel(t.id)}>
            <span className="t">{t.id}</span><span className="kd">{t.status}{t.rev ? ` ${t.rev}` : ''}</span><span className="who">{t.store} · {t.principal}</span><span className="s">{t.via}</span><span className="what">{t.label}{t.error ? ` — ${t.error.code}` : ''}</span>
          </div>)}
          {!list.length && <p className="empty padded">No turns match.</p>}
        </div>
        <div className="turndetail">{turnSel ? <TurnDetail id={turnSel} /> : <Empty>Pick a turn. A turn is one event handled in one SQLite transaction: its statements, what the authorizer allowed or denied, and the changes it committed.</Empty>}</div>
      </div>
    </div>
  );
}

function TurnDetail({ id }) {
  const { client } = useLab();
  const [t, e] = useK(() => client.call('turn', { id }), [id], []);
  if (e) return <Err e={e} />;
  if (!t) return null;
  return (
    <div className="scroll padded tdet">
      <h3>{t.label} <span className={t.status === 'rollback' || t.status === 'denied' ? 'bad' : 'dim'}>{t.status}{t.rev ? ` · rev ${t.rev}` : ''}</span></h3>
      <dl className="kv wide"><dt>store</dt><dd>{t.store}</dd><dt>principal</dt><dd>{t.principal}{t.who !== t.principal ? ` (for ${t.who})` : ''}</dd><dt>via</dt><dd>{t.via}</dd>{t.app && <><dt>code</dt><dd>{t.app}</dd></>}{t.step && <><dt>step</dt><dd>{t.step}</dd></>}<dt>clock</dt><dd>{fmtDate(t.now)}</dd><dt>time</dt><dd>{t.ms} ms{t.cpuMs ? ` · ${t.cpuMs} ms in the sandbox` : ''}</dd></dl>
      {t.error && <div className="errbox"><b>{t.error.code}</b> {t.error.message}</div>}
      {t.denied && <><h4>Why it was refused</h4><Trace lines={t.denied} /></>}
      {t.awaits && t.awaits.length > 0 && <p className="note">This turn ended at an await on <b>{t.awaits.join(', ')}</b>. What it wrote before that committed here; the rest runs in a continuation turn.</p>}
      <h4>Statements <span className="dim">{t.statements.length}</span></h4>
      {t.statements.length ? t.statements.map((s, i) => <div key={i} className="stmt">
        <div className="hrow"><span className="dim">{s.kind}</span><span className="sp" /><span className="dim">{s.ms} ms{s.rows !== undefined ? ` · ${s.rows} rows` : ''}{s.changes !== undefined ? ` · ${s.changes} changed` : ''}</span></div>
        <pre className="src">{s.sql}{s.bind && s.bind.length ? `\n-- ${JSON.stringify(s.bind)}` : ''}</pre>
        {s.error && <div className="bad">{s.error}</div>}
        {s.auth && s.auth.length > 0 && <div className="auth">{s.auth.map((x, j) => <span key={j} className={x.ok ? '' : 'bad'} title={x.why || ''}>{x.ok ? '✓' : '✗'} {x.action}{x.a ? ` ${x.a}` : ''}{x.b && x.action !== 'READ' ? ` ${x.b}` : ''}{x.via ? ` (via ${x.via})` : ''}{x.ok ? '' : `: ${x.why}`}</span>)}</div>}
      </div>) : <p className="empty">None: this turn used only kernel calls (documents, files) or nothing at all.</p>}
      <h4>Changes <span className="dim">{t.changes.length}</span></h4>
      {t.changes.length ? <Table rows={t.changes} cols={[{ k: 'kind', h: 'kind' }, { k: 'key', h: 'key' }, { k: 'op', h: 'op' }, { k: 'version', h: 'version', r: c => c.version ?? '' }]} /> : <p className="empty">None.</p>}
      {t.logs.length > 0 && <><h4>console</h4><pre className="src">{t.logs.map(l => `${l.level}: ${l.msg}`).join('\n')}</pre></>}
      {t.released.length > 0 && <p className="note">Released after commit: {t.released.map(r => `${r.kind} ${r.topic}`).join(', ')}.</p>}
      {t.event && t.event.arg != null && <details className="ev-json"><summary>Event</summary><Json value={t.event} /></details>}
    </div>
  );
}
