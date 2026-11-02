// Access, Console and Agent.
import React, { useEffect, useRef, useState } from 'react';
import { useLab, useK, useLocal, Table, Trace, Err, Seg, StorePick, short, Empty } from './ui.jsx';

// ---------------------------------------------------------------- Access
const OPS = ['call', 'doc.read', 'doc.write', 'sql.read', 'sql.admin', 'files.read', 'files.write', 'platform'];
export function AccessView() {
  const { client, ov, as, store, setStore, toast } = useLab();
  const [matrix] = useK(() => client.call('matrix'), [], ['access', 'stores', 'commit']);
  const [q, setQ] = useLocal('access.q', { p: 'usr_ramon', store: 'team-board', op: 'doc.read', target: 'data/users/usr_me/notes' });
  const [ans, setAns] = useState(null);
  const [g, setG] = useState({ subject: '*signed-in', level: 'view' });
  const [appr] = useK(() => client.call('approvalsInfo'), [], ['access', 'stores', 'commit']);
  const explain = async (nq = q) => { setQ(nq); try { setAns(await client.call('verb', { as: 'system', verb: 'can', args: [nq.p, nq.store, nq.op, nq.target || undefined].filter(x => x !== undefined) })); } catch (e) { setAns({ ok: false, trace: [`✗ ${e.message}`] }); } };
  useEffect(() => { explain(q); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const grants = ov.stores.length ? null : null;
  const [gr] = useK(() => client.call('verb', { as: 'system', verb: 'grants', args: [store] }), [store], ['access']);
  const doGrant = async (e) => { e.preventDefault(); try { await client.call('verb', { as, verb: 'grant', args: [store, g.subject, g.level] }); toast(`${g.subject} holds ${g.level} on ${store}`); } catch (er) { toast(`${er.code}: ${er.message}`, true); } };
  const revoke = async (subject) => { try { await client.call('verb', { as, verb: 'revoke', args: [store, subject] }); } catch (er) { toast(`${er.code}: ${er.message}`, true); } };
  const approve = async (a) => { try { await client.call('verb', { as, verb: 'approve', args: [a.app, String(a.version), a.declared.join(',')] }); toast(`Approved ${a.declared.join(', ')} for ${a.app}@${a.version}`); } catch (er) { toast(`${er.code}: ${er.message}`, true); } };
  const stores = ov.stores.filter(s => s.id !== 'system');
  return (
    <div className="tabbody col scroll">
      <div className="padded accessv">
        <p className="note">A level is the most any path gives: platform role, ownership, grants (to a person, <code>*signed-in</code> or <code>*anyone</code>), then a cap by kind: guests at interact, tokens at their maximum, anonymous at view. Rules in app.json then say which level each path needs.</p>
        <h3>Levels <span className="dim">click a cell to explain it</span></h3>
        {matrix && <div className="tablewrap"><table className="rt matrix"><thead><tr><th>principal</th>{stores.map(s => <th key={s.id}>{s.id}</th>)}</tr></thead><tbody>
          {matrix.map(r => <tr key={r.p.id}><td className="nm" title={r.p.id}>{r.p.name} <span className="dim">{r.p.kind}</span></td>{stores.map(s => { const l = r.levels[s.id] || 'none'; return <td key={s.id} className={'lvl lvl-' + l} onClick={() => explain({ p: r.p.id, store: s.id, op: 'call', target: '' })}>{l}</td>; })}</tr>)}
        </tbody></table></div>}
        <h3>Explain a decision</h3>
        <form className="hrow wrap" onSubmit={(e) => { e.preventDefault(); explain(q); }}>
          <select value={q.p} onChange={e => setQ({ ...q, p: e.target.value })} aria-label="Principal">{ov.principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="app:journal">app:journal</option></select>
          <select value={q.store} onChange={e => setQ({ ...q, store: e.target.value })} aria-label="Store">{stores.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select>
          <select value={q.op} onChange={e => setQ({ ...q, op: e.target.value })} aria-label="Operation">{OPS.map(o => <option key={o}>{o}</option>)}</select>
          <input className="filter" value={q.target} onChange={e => setQ({ ...q, target: e.target.value })} placeholder="path or name" aria-label="Target" />
          <button className="btn sm">can()?</button>
        </form>
        {ans && <div className={'canans' + (ans.ok ? '' : ' no')}><b>{ans.ok ? 'allowed' : ans.code === 'not_found' ? 'not found (a hidden read)' : 'refused'}</b><Trace lines={ans.trace} /></div>}
        <h3>Grants on <StorePick value={store} onChange={setStore} filter={s => s.id !== 'system'} /></h3>
        <Table rows={gr} empty="No grants: only the owner and platform admins." cols={[{ k: 'subject', h: 'subject', r: x => <b>{x.subject}</b> }, { k: 'level', h: 'level' }, { k: 'created_by', h: 'by' }, { k: 'x', h: '', r: x => <button className="link" onClick={() => revoke(x.subject)}>revoke</button> }]} />
        <form className="hrow" onSubmit={doGrant}>
          <select value={g.subject} onChange={e => setG({ ...g, subject: e.target.value })} aria-label="Subject"><option>*signed-in</option><option>*anyone</option>{ov.principals.filter(p => p.kind !== 'anon').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="app:journal">app:journal</option><option value="app:tracker">app:tracker</option></select>
          <select value={g.level} onChange={e => setG({ ...g, level: e.target.value })} aria-label="Level"><option>view</option><option>interact</option><option>admin</option></select>
          <button className="btn sm">Grant as {as}</button>
        </form>
        <h3>Capabilities that need approval</h3>
        <p className="note">sample, mcp, fetch and the like are declared in app.json and approved per app version by a platform admin. A new version needs a new approval.</p>
        <Table rows={appr} empty="No app version declares one." cols={[{ k: 'v', h: 'app version', r: a => <b>{a.app}@{a.version}{a.isMain ? ' (main)' : ''}</b> }, { k: 'declared', h: 'declares', r: a => a.declared.join(', ') }, { k: 'approved', h: 'approved', r: a => a.approved.length ? a.approved.join(', ') : <span className="dim">nothing</span> }, { k: 'x', h: '', r: a => a.declared.some(c => !a.approved.includes(c)) ? <button className="btn sm" onClick={() => approve(a)}>Approve as {as}</button> : null }]} />
        <h3>Principals</h3>
        <Table rows={ov.principals} cols={[{ k: 'id', h: 'id', r: p => <b>{p.id}</b> }, { k: 'kind', h: 'kind' }, { k: 'name', h: 'name' }, { k: 'role', h: 'role' }, { k: 'user_id', h: 'acts for', r: p => p.user_id || '' }, { k: 'max_level', h: 'at most', r: p => p.max_level || (p.kind === 'guest' ? 'interact' : p.kind === 'anon' ? 'view' : '') }]} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Console
export function ConsoleView({ visible }) {
  const { client, as, setAs, ov, consoleLines, setConsoleLines, runConsole, downloadStore } = useLab();
  const [line, setLine] = useState('');
  const [hist, setHist] = useLocal('console.hist', []);
  const [hi, setHi] = useState(-1);
  const [stdin, setStdin] = useState(null);
  const end = useRef(null), inp = useRef(null), out = useRef(null);
  useEffect(() => { if (out.current) out.current.scrollTop = out.current.scrollHeight; }, [consoleLines, visible]);
  useEffect(() => { if (!consoleLines.length) setConsoleLines([{ kind: 'out', text: 'The console runs the same verbs as the agent and the UI, as the principal in the header.\nTry: help · stores · tables blog · sql blog "SELECT * FROM posts" · log blog · can anon blog call · clock +1h\n`as <principal>` switches who you are; `download <store> [json|sqlite]` saves a store; `clear` empties this.' }]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault();
    const l = line.trim(); if (!l) return;
    setHist(h => [...h.filter(x => x !== l), l].slice(-100)); setHi(-1); setLine('');
    if (l === 'clear') { setConsoleLines([]); return; }
    const dl = /^download\s+(\S+)(?:\s+(json|sqlite))?$/.exec(l);
    if (dl) { setConsoleLines(ls => [...ls, { kind: 'in', as, line: l }]); const ok = await downloadStore(dl[1], dl[2] || 'json'); setConsoleLines(ls => [...ls, ok ? { kind: 'out', text: `${dl[1]}: offered as ${dl[2] === 'sqlite' ? `${dl[1]}-sqlite.zip` : `${dl[1]}.json`}` } : { kind: 'err', text: 'not downloaded' }]); return; }
    const m = /^as\s+(\S+)$/.exec(l);
    if (m) { if (ov.principals.some(p => p.id === m[1])) { setAs(m[1]); setConsoleLines(ls => [...ls, { kind: 'in', as, line: l }, { kind: 'out', text: `now acting as ${m[1]}` }]); } else setConsoleLines(ls => [...ls, { kind: 'err', text: `no principal ${m[1]}` }]); return; }
    await runConsole(l, { quiet: true, input: stdin ?? undefined });
    setStdin(null);
  };
  const key = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); const i = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1); if (hist[i] != null) { setHi(i); setLine(hist[i]); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); const i = hi + 1; if (i >= hist.length) { setHi(-1); setLine(''); } else { setHi(i); setLine(hist[i]); } }
  };
  return (
    <div className="tabbody col consolev" onClick={(e) => { if (!window.getSelection().toString() && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') inp.current && inp.current.focus(); }}>
      <div className="conout" ref={out}>
        {consoleLines.map((l, i) => l.kind === 'in' ? <div key={i} className="cin"><span className="dim">{l.as} $</span> {l.line}</div> : <div key={i} className={l.kind === 'err' ? 'cerr' : 'cout'}>{l.text}{l.trace ? '\n' + l.trace.map(x => '  ' + x).join('\n') : ''}</div>)}
        <div ref={end} />
      </div>
      {stdin != null && <textarea className="codearea stdin" value={stdin} onChange={e => setStdin(e.target.value)} placeholder="stdin for the next command, e.g. the file content for write" spellCheck={false} aria-label="Standard input" />}
      <form className="conin" onSubmit={submit}>
        <span className="dim">{as} $</span>
        <input ref={inp} value={line} onChange={e => setLine(e.target.value)} onKeyDown={key} spellCheck={false} autoComplete="off" aria-label="Command" />
        <button type="button" className={'tog' + (stdin != null ? ' on' : '')} onClick={() => setStdin(stdin == null ? '' : null)} title="Attach stdin (file content for write)">stdin</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Agent
const SUGG = [
  'Explain, with evidence from the log, what happened in the blog store\'s last five commits',
  'Add tags to journal posts: a migration, a field in the draft form, and tags shown on the page. Publish and check blog activated.',
  'Make a new app "guestbook": signed-in people leave one entry each, everyone reads them. Mount it at site.lab/guestbook.',
  'Why can\'t Ana see Ramon\'s drafts? Show me the access decision.',
];

function agentPreamble(helpText, ov) {
  const stores = ov.stores.map(s => `- ${s.id}: ${s.isApp ? `app, main snapshot ${s.main || 'none'}` : s.app ? `runs ${s.app}@${s.running}` : s.type || 'plain store'}, rev ${s.rev}`).join('\n');
  const mounts = ov.mounts.map(m => `- ${m.host}${m.path} → ${m.store || ':' + m.store_param}${m.on_missing === 'create' ? ` (creates ${m.create_app} stores on demand)` : ''}`).join('\n');
  return `You are the agent inside "slop lab", a browser workbench for the slop v3 kernel. You act through one tool, \`slop\`, which runs one console command as principal tok_agent: a token acting for usr_me (a platform admin), capped at admin. This panel already wraps the whole request in one step the person can revert: never run \`step begin\` or \`step end\`.

# The model
- A store is one SQLite database: documents (JSON at slash paths; even segment counts are documents), a working tree of files, app tables (SQL), a log of commits, snapshots and refs.
- An app is a store whose tree has app.json. A data store runs an app's main snapshot (\`new <id> --app <app>\`). Code lives in the app store; data, grants and mounts belong to the data store. Mounts name data stores.
- \`publish <app> <message>\` snapshots the app's tree, moves main, and activates every store running it: sql/*.sql migrations (the only place DDL runs), then setup and smoke, in one transaction. If any throws, that store keeps its last good version. Read the activation results every time.

# actor.js (QuickJS; one actor per data store; each event is one transaction)
defineActor({ setup(ctx), smoke(ctx), actions: { name(ctx, args) {} }, http: { 'GET /path': { level: 'public'|'view'|..., run(ctx, req) { return { status: 200, json } } } }, on: { '<selector>'(ctx, commit) {} }, every: { name: { every: '5m', run(ctx) {} } } })
- ctx.principal = { id, kind: 'user'|'guest'|'token'|'anon'|'app'|'system', name, level, via }. Tokens appear as the user they act for (via = the token id). ctx.now, ctx.store.id, ctx.need(level) throws permission_denied.
- Throw errors with a code: throw Object.assign(new Error('message'), { code: 'permission_denied' }). Codes: invalid_argument, not_found, permission_denied, conflict.
- use(name) returns null when a module is not available:
  - sql: all(q, ...params), one(q, ...params), run(q, ...params), transaction(fn)
  - db: doc(path).get() → { exists, data() }, .set(obj), .update(obj), .delete(); collection(path).where(f, op, v).orderBy(f, dir).limit(n).get(), .add(obj)
  - stores: other stores. stores.open('<store>').get('<docpath>') → { exists, data() }, synchronous. await stores.open('<store>').call('<action>', args) runs that store's action (the await ends this turn). Equivalent shortcut: stores.get('<store>', '<docpath>').
  - alarm: at(ms, name, data), every(name, '5m', data), cancel(name); time: now(), sleep(ms) (await ends the turn); room: emit(topic, data); sample (only once an admin approves it per app version)
- The actor acts as principal app:<app>. In stores running its app it is admin. In any other store it holds only what grants give app:<app> or *anyone. Check with \`can app:<app> <store> doc.read <path>\`; fix with \`grant <store> app:<app> view\`.
- Reactors run synchronously, exactly once per matching commit, in order, from a cursor. Selectors: 'table:<t>', 'doc:<glob>', 'file:<glob>', 'ref:<name>', 'snapshot', 'schema', '*'. Prefix 'store:<other> ' to follow another store's commits (needs view there), e.g. on: { 'store:global-counter doc:counter/*'(ctx, commit) { ... } }.
- To show another store's data, copy it with a cross-store reactor into a document of your own store (and once in setup), then render that document with db.onSnapshot. Never poll an action on a timer: every call is a turn.

# Pages (index.html + files, sandboxed, run as the viewer)
window.claude.use(name) → Promise of a module, or null:
- db: doc(path).get()/set()/update()/delete()/onSnapshot(next, err); collection(path).where/orderBy/limit/get/onSnapshot/add. Reads this store's documents under app.json's db rules.
- user: me() → { id, name, kind, level, guest }, id(), profiles(ids)
- room: emit(topic, data), on(topic, fn), onPeers(fn)
- slop: actions.call(name, args) → the action's return value; sql.select(name, { columns, where: [[col, op, val]], orderBy: [[col, 'asc'|'desc']], limit }); sql.watch(name, q, onRows, onErr). Pages read only SQL names listed in app.json slop.sql.expose, and they write through actions or documents.
- A page can't read another store. Copy the data in with a reactor, as above.

# Access
Levels: none < view < interact < admin < owner. Grant subjects: a principal id, app:<app>, *signed-in (members and admins, not guests), *anyone (everyone, including anonymous visitors and apps). Guests are capped at interact, anonymous visitors at view. Principals: usr_me (admin), usr_ramon and usr_kim (members), gst_ana (guest), anon, tok_agent (you), tok_ci.

# How to work
- Look first: ls, cat, tables, sql (read-only unless --write), docs, get, log, turns, turn <id>, actors.
- Write whole files with \`write <store> <path>\` and the content in stdin. Change one exact, unique snippet with \`edit <store> <path> --old "..." --new "..."\`: double quotes, inner double quotes escaped as \\".
- New columns or tables go in a new migration file; never edit an applied one.
- Before you say something works, prove it: \`call <store> <action> {json}\`, \`get <store> <doc>\`, \`resolve site.lab/<path>\`, \`pagelog <store>\`. Check access for other people with \`can <principal> <store> <op> [target]\`. If something fails, read the error and \`turn <id>\` before guessing. Don't leave probe code in published versions.
- Reply briefly in plain prose: what you changed, how you checked it, and anything still unverified. No headings.

# Commands
${helpText}

# The world now
Stores:
${stores}
Mounts:
${mounts}`;
}

function Md({ text }) {
  const blocks = String(text || '').split(/\n```[a-z]*\n?|```/);
  return <div className="md">{blocks.map((b, i) => i % 2 ? <pre key={i} className="src">{b}</pre> : b.split(/\n{2,}/).map((p, j) => /^\s*[-*] /.test(p) ? <ul key={i + '-' + j}>{p.split('\n').filter(Boolean).map((li, k) => <li key={k}>{inline(li.replace(/^\s*[-*] /, ''))}</li>)}</ul> : <p key={i + '-' + j}>{inline(p)}</p>))}</div>;
}
function inline(s) { return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((x, i) => x.startsWith('`') ? <code key={i}>{x.slice(1, -1)}</code> : x.startsWith('**') ? <b key={i}>{x.slice(2, -2)}</b> : x); }

function ToolStep({ t, onDecide }) {
  const cls = 'tool' + (t.status === 'run' ? ' run' : t.status === 'ask' ? ' ask' : t.status === 'err' || t.status === 'declined' ? ' err' : '') + (t.reverted ? ' reverted' : '');
  return (
    <details className={cls} open={t.status === 'ask' || undefined}>
      <summary><i className="dot" /><span className="nm">slop</span><span className="first">{t.command}</span><span className="ms">{t.status === 'ask' ? 'waiting for you' : t.ms != null ? `${t.ms} ms` : ''}</span></summary>
      <div className="tb">
        <pre className="src">{t.command}{t.stdin ? `\n<<<\n${t.stdin}` : ''}</pre>
        {t.status === 'ask' && <div className="row"><button className="btn primary sm" onClick={() => onDecide(t.id, true)}>Run this step</button><button className="btn sm" onClick={() => onDecide(t.id, false)}>Decline</button></div>}
        {t.result != null && <pre className={'res src' + (t.status === 'err' || t.status === 'declined' ? ' bad' : '')}>{t.result}</pre>}
      </div>
    </details>
  );
}

function threadMarkdown(msgs, title) {
  const out = [`# ${title || 'slop lab agent thread'}`, '', `Exported ${new Date().toISOString()}`, ''];
  for (const m of msgs) {
    if (m.role === 'user') { out.push('## You', '', m.text, ''); continue; }
    out.push(`## Agent${m.step ? ` (step ${m.step})` : ''}`, '');
    for (const t of m.tools || []) {
      out.push(`### slop: ${t.command.split('\n')[0]}${t.status === 'err' || t.status === 'declined' ? ` (${t.status})` : ''}`, '', '```', t.command + (t.stdin ? `\n<<<\n${t.stdin}` : ''), '```', '');
      if (t.result != null) out.push('```', t.result, '```', '');
    }
    if (m.text) out.push(m.text, '');
    if (m.error) out.push(`**Error:** ${m.error}`, '');
  }
  return out.join('\n');
}

export function AgentView() {
  const { client, outer, agentPrompt, setAgentPrompt, ov, toast, saveFile } = useLab();
  const [mode, setMode] = useLocal('agent.mode', 'auto');
  const [tier, setTier] = useLocal('agent.tier', 'default');
  const [msgs, setMsgs] = useState([]);
  const [thread, setThread] = useState(() => ({ id: 'th_' + Date.now().toString(36), title: '' }));
  const [threads, setThreads] = useState([]);
  const loaded = useRef(false);
  // Threads live in the world (the system store), so they are saved, exported and survive a reload.
  useEffect(() => { client.call('threadLoad').then(t => { if (t && !loaded.current) { setThread({ id: t.id, title: t.title }); setMsgs(t.data || []); } loaded.current = true; }, () => { loaded.current = true; }); client.call('threadList').then(setThreads, () => {}); }, [client]);
  const persistThread = (next) => { if (!next.length) return; const title = thread.title || (next.find(m => m.role === 'user') || {}).text || 'thread'; client.call('threadSave', { id: thread.id, title: title.slice(0, 80), data: next }).then(() => client.call('threadList').then(setThreads), () => {}); };
  const openThread = async (id) => { const t = await client.call('threadGet', { id }); if (t) { setThread({ id: t.id, title: t.title }); setMsgs(t.data || []); } };
  const newThread = () => { setThread({ id: 'th_' + Date.now().toString(36), title: '' }); setMsgs([]); };
  const download = async () => { try { if (await saveFile(`agent-thread-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`, threadMarkdown(msgs, thread.title))) toast('Thread downloaded as Markdown'); } catch (e) { toast(e.message, true); } };
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef(null), asks = useRef({}), modeRef = useRef(mode), logEnd = useRef(null);
  modeRef.current = mode;
  useEffect(() => { if (agentPrompt) { setInput(agentPrompt); setAgentPrompt(null); } }, [agentPrompt, setAgentPrompt]);
  useEffect(() => { const el = logEnd.current && logEnd.current.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  const sample = outer && outer.sample;
  const decide = (id, ok) => { const f = asks.current[id]; if (f) { delete asks.current[id]; f(ok); } };

  const send = async (text) => {
    if (!text.trim() || busy || !sample) return;
    setBusy(true); setInput('');
    const id = Date.now();
    const prior = msgs.filter(m => m.text && !m.error).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })).slice(-8);
    while (prior.length && prior[0].role !== 'user') prior.shift();
    setMsgs(m => [...m, { role: 'user', text, id: id - 1 }, { role: 'agent', text: '', tools: [], id }]);
    const upd = (f) => setMsgs(m => m.map(x => (x.id === id ? f(x) : x)));
    let step = null;
    try {
      step = (await client.call('startStep', { as: 'tok_agent', message: text.slice(0, 120), via: 'agent' })).step;
      upd(x => ({ ...x, step }));
      const help = (await client.call('run', { as: 'tok_agent', line: 'help' })).text;
      const fresh = await client.call('overview');
      const input = [...prior, { role: 'user', content: `${agentPreamble(help, fresh)}\n\nThe person asks:\n${text}` }];
      const tool = {
        name: 'slop',
        description: 'Run one slop console command as tok_agent and return its output. Use stdin for the content of `write`. One command per call.',
        inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'e.g. `cat journal actor.js` or `sql blog "SELECT * FROM posts"`' }, stdin: { type: 'string', description: 'standard input, e.g. the whole file for `write`' } }, required: ['command'] },
        execute: async (inp) => {
          const tid = Math.random().toString(36).slice(2);
          const command = String((inp && inp.command) || '').trim(), stdin = inp && inp.stdin != null ? String(inp.stdin) : undefined;
          const t0 = performance.now();
          const set = (patch) => upd(x => ({ ...x, tools: x.tools.map(y => (y.id === tid ? { ...y, ...patch } : y)) }));
          upd(x => ({ ...x, tools: [...x.tools, { id: tid, command, stdin, status: 'run' }] }));
          const write = await client.call('isWrite', { line: command });
          if (write && modeRef.current === 'read') { set({ status: 'declined', result: 'Read-only: this command changes something, so it did not run.' }); return 'REFUSED: the person set the agent to read-only. Do not change anything; explain what you would change instead.'; }
          if (write && modeRef.current === 'ask') {
            set({ status: 'ask' });
            const ok = await new Promise(res => { asks.current[tid] = res; });
            if (!ok) { set({ status: 'declined', result: 'The person declined this step.' }); return 'DECLINED: the person declined this command. Ask them, or try another way.'; }
            set({ status: 'run' });
          }
          try {
            const r = await client.call('run', { as: 'tok_agent', line: command, input: stdin, via: 'agent' });
            const out = r.text.length > 8000 ? r.text.slice(0, 8000) + '\n…(cut at 8000 characters)' : r.text;
            set({ status: 'ok', result: out, ms: Math.round(performance.now() - t0) });
            return out;
          } catch (e) {
            const m = `${e.code}: ${e.message}${e.trace ? '\n' + e.trace.join('\n') : ''}`;
            set({ status: 'err', result: m, ms: Math.round(performance.now() - t0) });
            return 'ERROR ' + m;
          }
        },
      };
      abort.current = new AbortController();
      const r = await sample(input, { tools: [tool], modelTier: tier, cache: false, signal: abort.current.signal, onText: ({ text: tx }) => upd(x => ({ ...x, text: tx })) });
      upd(x => ({ ...x, text: r.text, done: true }));
    } catch (e) {
      upd(x => ({ ...x, error: e.code === 'rate_limited' ? 'Claude is rate limited right now. Try again in a minute.' : e.name === 'AbortError' ? 'Stopped.' : `${e.code || 'error'}: ${e.message || ''}`, done: true }));
    } finally {
      await client.call('endStep', { as: 'tok_agent' }).catch(() => {});
      setBusy(false); abort.current = null;
      setMsgs(m => { persistThread(m); return m; });
    }
  };
  const revert = async (m) => { try { const r = await client.call('verb', { as: 'usr_me', verb: 'revert', args: [m.step] }); setMsgs(ms => ms.map(x => (x.id === m.id ? { ...x, reverted: true, tools: x.tools.map(t => ({ ...t, reverted: true })) } : x))); toast(`Reverted ${m.step}: ${r.report.length} changes`); } catch (e) { toast(e.message, true); } };
  const stepOf = (m) => ov.steps.find(s => s.id === m.step);
  return (
    <div className="tabbody col agent-panel">
      <div className="agent-set">
        <span className="ctl-l">Mode</span><Seg sm value={mode} onChange={setMode} options={[['auto', 'Auto', 'Runs every command'], ['ask', 'Ask', 'You approve each command that changes something'], ['read', 'Read-only', 'Only commands that read']]} />
        <span className="ctl-l">Model</span><Seg sm value={tier} onChange={setTier} options={[['quick', 'Fast'], ['default', 'Balanced'], ['complex', 'Deep']]} />
        <span className="sp" />
        {threads.length > 1 && <select value={thread.id} onChange={e => openThread(e.target.value)} disabled={busy} aria-label="Threads">{threads.map(t => <option key={t.id} value={t.id}>{short(t.title || t.id, 40)}</option>)}{!threads.some(t => t.id === thread.id) && <option value={thread.id}>new thread</option>}</select>}
        <button className="btn sm" disabled={!msgs.length} onClick={download} title="Every message, command and result, as Markdown">Download</button>
        <button className="btn sm" disabled={busy || !msgs.length} onClick={newThread}>New thread</button>
      </div>
      {!sample && <div className="agent-off"><b>The agent is off here.</b>Claude is not available in this view, so the agent cannot run. The console runs the same commands.</div>}
      <div className="agent-log">
        {!msgs.length && <div className="agent-empty"><p>Ask for a change and the agent reads and edits stores through one tool, <b>slop</b>: the console's commands, run as <code>tok_agent</code>. Each request is a step you can revert.</p><div className="sugg">{SUGG.map(s => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div></div>}
        {msgs.map(m => m.role === 'user'
          ? <div key={m.id} className="msg user"><span className="who">You</span><div className="body">{m.text}</div></div>
          : <div key={m.id} className={'msg agent' + (m.error ? ' error' : '')}><span className="who">Agent{m.step ? ` · step ${m.step}` : ''}</span>
              {m.tools.map(t => <ToolStep key={t.id} t={t} onDecide={decide} />)}
              {m.text ? <Md text={m.text} /> : !m.done ? <p className="note">Thinking…</p> : null}
              {m.error && <p className="bad">{m.error}</p>}
              {m.done && m.step && (() => { const s = stepOf(m); const n = s ? s.commits.length : 0; return <p className="note">{n ? `${n} commit${n > 1 ? 's' : ''}: ${s.commits.map(c => `${c.store}@${c.rev}`).join(' ')}` : 'No commits.'}{n > 0 && !m.reverted && s.state !== 'reverted' ? <> · <button className="link" onClick={() => revert(m)}>revert this step</button></> : m.reverted || (s && s.state === 'reverted') ? ' · reverted' : ''}</p>; })()}
            </div>)}
        <div ref={logEnd} />
      </div>
      <div className="composer">
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} placeholder="Ask the agent: “add a tags column to journal”, “why can't Ana publish?”" aria-label="Message to the agent" disabled={!sample} />
        <div className="row"><span className="meta">Enter sends · Shift+Enter for a new line · {mode === 'auto' ? 'commands run as they come' : mode === 'ask' ? 'you approve each change' : 'read-only'}</span>
          {busy ? <button className="btn danger" onClick={() => abort.current && abort.current.abort()}>Stop</button> : <button className="btn primary" disabled={!input.trim() || !sample} onClick={() => send(input)}>Send</button>}</div>
      </div>
    </div>
  );
}
