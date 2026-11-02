// The lab shell: header bar, a dock of two tiles, and the context every view shares.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Lab, Visible, useK, useLocal, fmtTime, fmtDur, Menu } from './ui.jsx';
import { Dock, T, S, useLayout, normalize, tiles, replace, allViews } from './dock.jsx';
import { zip, STORE_README } from './persist.js';
import { StartView, SiteView, StoresView, DataView } from './views1.jsx';
import { CodeView, LogView, ActorView, TurnsView } from './views2.jsx';
import { AccessView, ConsoleView, AgentView } from './views3.jsx';

export const VIEWS = {
  start: { title: 'Start here', C: StartView },
  site: { title: 'Site', C: SiteView },
  stores: { title: 'Stores', C: StoresView },
  data: { title: 'Data', C: DataView },
  code: { title: 'Code', C: CodeView },
  log: { title: 'Log', C: LogView },
  actor: { title: 'Actor', C: ActorView },
  turns: { title: 'Turns', C: TurnsView },
  access: { title: 'Access', C: AccessView },
  console: { title: 'Console', C: ConsoleView },
  agent: { title: 'Agent', C: AgentView },
};
const ABOUTS = {
  start: 'what this is, and things to try', site: 'pages at an address, as anyone', stores: 'every store, its code and its owner',
  data: 'documents, tables and SQL in a store', code: 'an app\'s files, snapshots, publishing', log: 'commits, newest first, and steps',
  actor: 'actions, reactors and alarms', turns: 'statements, decisions and changes per turn', access: 'levels, grants, approvals, can()',
  console: 'the verbs, typed', agent: 'Claude, working through the same verbs',
};
const RELATED = { site: ['stores', 'data'], stores: ['site', 'data'], data: ['code', 'stores'], code: ['data', 'log'], log: ['data', 'actor'], actor: ['log', 'code'], turns: ['console', 'access'], console: ['turns', 'agent'], access: ['turns', 'console'], agent: ['console', 'turns'], start: ['site', 'stores'] };
export const LAYOUTS = {
  site: { name: 'The site beside its turns', glyph: '▌▐', tree: () => S('row', [T(['start', 'site', 'stores', 'data', 'code', 'log', 'actor']), T(['turns', 'console', 'access', 'agent'])], [0.58, 0.42]) },
  stack: { name: 'The site over its turns, code beside', glyph: '▚', tree: () => S('row', [T(['code', 'data', 'stores', 'log', 'actor', 'start']), S('col', [T(['site']), T(['turns', 'console', 'access', 'agent'])], [0.6, 0.4])], [0.45, 0.55]) },
  three: { name: 'Three columns: code, site, the agent', glyph: '▥', tree: () => S('row', [T(['code', 'data', 'log', 'actor']), T(['site', 'start', 'stores']), T(['agent', 'turns', 'console', 'access'])], [0.33, 0.37, 0.3]) },
  one: { name: 'Everything in one tile', glyph: '▢', tree: () => T(Object.keys(VIEWS), 'start') },
};

export function App(props) {
  const [epoch, setEpoch] = useState(0);
  return <Lab.Provider value={{ client: props.client, epoch }}><Shell {...props} epoch={epoch} setEpoch={setEpoch} /></Lab.Provider>;
}

function Shell({ client, persist, bootError, onReset, onImport, onExport, saveState, outer, epoch, setEpoch, saveFile }) {
  const [as, setAs] = useLocal('as', 'usr_me');
  const known = useMemo(() => new Set(Object.keys(VIEWS)), []);
  const [tree, setTree] = useLayout(LAYOUTS, known);
  const [store, setStore] = useLocal('store', 'blog');
  const [siteAddr, setSiteAddr] = useLocal('siteAddr', 'site.lab/');
  const [toasts, setToasts] = useState([]);
  const [consoleLines, setConsoleLines] = useState([]);
  const [agentPrompt, setAgentPrompt] = useState(null);
  const [turnSel, setTurnSel] = useState(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 640);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 640); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const [ov] = useK(() => client.call('overview'), [epoch], ['commit', 'turn', 'stores', 'actors', 'access', 'mounts', 'steps', 'clock', 'faults', 'views', 'pagelog']);

  const toast = useCallback((text, bad) => { const id = Math.random(); setToasts(t => [...t.slice(-3), { id, text, bad }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), bad ? 6000 : 3200); }, []);
  // Bring a view forward: activate it in its tile, or open it next to related views if it was closed.
  const focus = useCallback((view) => setTree(t => {
    const ts = tiles(t);
    const home = ts.find(x => x.views.includes(view));
    if (home) return home.active === view ? t : replace(t, home.id, (x) => ({ ...x, active: view }));
    const near = ts.find(x => (RELATED[view] || []).some(r => x.views.includes(r))) || ts[0];
    return normalize(replace(t, near.id, (x) => ({ ...x, views: [...x.views, view], active: view })), known, true);
  }), [setTree, known]);
  const runConsole = useCallback(async (line, opts = {}) => {
    const who = opts.as || as;
    if (!opts.quiet) focus('console');
    setConsoleLines(ls => [...ls, { kind: 'in', as: who, line }]);
    try {
      const r = await client.call('run', { as: who, line, input: opts.input, via: 'cli' });
      setConsoleLines(ls => [...ls, { kind: 'out', text: r.text }]);
      return r;
    } catch (e) {
      setConsoleLines(ls => [...ls, { kind: 'err', text: `${e.code}: ${e.message}`, trace: e.trace }]);
      return null;
    }
  }, [as, client, focus]);

  // Download one store: readable JSON, or its SQLite file in a .zip (the artifact frame saves .zip, not .sqlite).
  const downloadStore = useCallback(async (id, format) => {
    try {
      let ok;
      if (format === 'json') ok = await saveFile(`${id}.json`, JSON.stringify(await client.call('dumpStore', { id }), null, 2));
      else { const { bytes } = await client.call('storeImage', { id }); ok = await saveFile(`${id}-sqlite.zip`, await zip([{ name: `${id}.sqlite`, data: bytes }, { name: 'README.txt', data: STORE_README(id) }])); }
      if (ok) toast(`${id} downloaded as ${format === 'json' ? 'JSON' : 'a SQLite file in a zip'}`);
      return ok;
    } catch (e) { toast(e.message, true); return false; }
  }, [client, saveFile, toast]);
  const ctx = useMemo(() => ({ client, ov, epoch, as, setAs, store, setStore, focus, toast, siteAddr, setSiteAddr, runConsole, consoleLines, setConsoleLines, agentPrompt, setAgentPrompt, turnSel, setTurnSel, outer, persist, saveFile, downloadStore }),
    [client, ov, epoch, as, store, focus, toast, siteAddr, runConsole, consoleLines, agentPrompt, turnSel, outer, persist, saveFile, downloadStore]);

  const counts = { actor: ov && ov.stores.some(s => s.actor && (s.actor.state === 'broken' || s.actor.reactorErrors)) ? '!' : null };
  if (bootError) return <div className="boot-screen"><div><h1>The lab could not start</h1><p>{bootError}</p><p className="dim">The kernel runs SQLite and QuickJS as WebAssembly in a worker. This browser or frame refused one of them.</p></div></div>;
  if (!ov) return <div className="boot-screen"><div><h1>slop lab</h1><p className="dim">Starting the kernel: SQLite and QuickJS in a worker…</p></div></div>;

  const reset = async () => { await onReset(); setEpoch(e => e + 1); toast('A fresh world, seeded'); };
  const importWorld = async (file) => { try { await onImport(file); setEpoch(e => e + 1); toast('World imported'); } catch (e) { toast(e.message, true); } };
  const exportWorld = async () => { try { if (await onExport()) toast('World saved as a .zip of SQLite files'); } catch (e) { toast(e.message, true); } };

  return (
    <Lab.Provider value={ctx}>
      <div className="app">
        <Header ov={ov} as={as} setAs={setAs} saveState={saveState} setTree={setTree} onReset={reset} onImport={importWorld} onExport={exportWorld} />
        <Dock tree={narrow ? T(allViews(tree), tiles(tree)[0] && tiles(tree)[0].active) : tree} setTree={narrow ? () => {} : setTree} views={VIEWS} abouts={ABOUTS} counts={counts} mountKey={narrow ? 'narrow' : 'wide'} />
        <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>{t.text}</div>)}</div>
      </div>
    </Lab.Provider>
  );
}

function Header({ ov, as, setAs, saveState, setTree, onReset, onImport, onExport }) {
  const { client, focus, toast } = React.useContext(Lab);
  const me = ov.principals.find(p => p.id === as) || { id: as, name: as, kind: '?' };
  const fileRef = useRef(null);
  const [now, setNow] = useState(ov.now);
  const base = useRef({ at: performance.now(), now: ov.now });
  useEffect(() => { base.current = { at: performance.now(), now: ov.now }; setNow(ov.now); }, [ov.now]);
  useEffect(() => { const t = setInterval(() => { if (ov.running) setNow(base.current.now + (performance.now() - base.current.at) * ov.speed); }, 500); return () => clearInterval(t); }, [ov.running, ov.speed]);
  const clock = (args) => client.call('clockSet', args).then(() => {}, e => toast(e.message, true));
  const armed = ov.faults.crashNext || ov.faults.failNextCommit;
  const groups = [['user', 'People'], ['guest', 'Guests'], ['token', 'Tokens'], ['anon', 'Nobody signed in']];
  const kindLabel = { user: 'user', guest: 'guest', token: 'token', anon: 'anon', app: 'app' };
  return (
    <header className="bar">
      <div className="brand">slop <i>lab · v3 kernel</i></div>
      <div className="proj"><Menu className="projbtn" title="Who you are in the Site, Console, Data and Code views" label={<><span className="pcode">as {kindLabel[me.kind] || me.kind}</span><span className="ptitle">{me.name}</span><span className="caret">▾</span></>}>
        {groups.map(([k, label]) => { const ps = ov.principals.filter(p => p.kind === k); return ps.length ? <React.Fragment key={k}><div className="grp">{label}</div>{ps.map(p => <button key={p.id} className={p.id === as ? 'on' : ''} onClick={() => setAs(p.id)}><span className="code">{p.id}</span><span className="t">{p.name}</span><small>{p.kind === 'token' ? `acts for ${p.user_id}, at most ${p.max_level}` : p.kind === 'guest' ? 'invited guest: interact at most' : p.kind === 'anon' ? 'public visitor: view at most' : `role ${p.role}`}</small></button>)}</React.Fragment> : null; })}
      </Menu></div>
      <div className="runctl">
        <button className="ibtn" title={ov.running ? 'Pause the clock' : 'Run the clock'} onClick={() => clock({ running: !ov.running })}>{ov.running ? '❚❚' : '▶'}</button>
        <span className="clock" title="The virtual clock: alarms, sleeps and ctx.now follow it">{fmtTime(now)}{!ov.running && <em> paused</em>}</span>
        <div className="seg sm" role="group" aria-label="Advance the clock">{[['1m', 60e3], ['1h', 36e5], ['1d', 864e5]].map(([l, ms]) => <button key={l} title={`Advance ${l}: fires timers and alarms in order`} onClick={() => clock({ advance: ms })}>+{l}</button>)}</div>
        {ov.next && <span className="lbl dim" title="The next timer or alarm">next in {fmtDur(ov.next - now)}</span>}
      </div>
      <span className="sp" />
      {armed && <button className="pill bad" title="A fault is armed" onClick={() => client.call('run', { as: 'usr_me', line: 'fault clear' })}><b>fault</b><span>{ov.faults.crashNext ? `crash ${ov.faults.crashNext}` : `fail commit ${ov.faults.failNextCommit}`} · clear</span></button>}
      <button className="pill" onClick={() => focus('turns')} title="Turns since boot"><b>{ov.turnSeq}</b><span>turns</span></button>
      <span className={'pill' + (saveState.bad ? ' bad' : '') + (saveState.busy ? ' busy' : '')} title={saveState.title}><b>{saveState.label}</b><span>{saveState.sub}</span></span>
      <Menu className="btn" right label="World ▾">
        <button onClick={onExport}><span className="t">Export world</span><small>a .zip with one .sqlite file per store</small></button>
        <button onClick={() => fileRef.current.click()}><span className="t">Import world</span><small>replace this world with an exported .zip</small></button>
        <hr />
        <ResetItem onReset={onReset} />
      </Menu>
      <input ref={fileRef} type="file" accept=".zip,.slop,application/zip,application/octet-stream" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onImport(f); }} />
      <Menu className="btn laymenu" right label="▦ Layout">
        {Object.entries(LAYOUTS).map(([k, l]) => <button key={k} onClick={() => setTree(l.tree())}><span>{l.name}</span><span className="glyph">{l.glyph}</span></button>)}
        <p className="note">Drag a tab onto another strip to move it, onto a tile's edge to split, into its middle to join. Drag a gutter to resize.</p>
      </Menu>
    </header>
  );
}

function ResetItem({ onReset }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return <button onClick={(e) => { if (!armed) { e.stopPropagation(); setArmed(true); return; } onReset(); }} className={armed ? 'on' : ''}><span className="t">{armed ? 'Click again to reset' : 'Reset world'}</span><small>{armed ? 'everything since the seed is discarded' : 'back to the seed: two apps, three stores'}</small></button>;
}
