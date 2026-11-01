// The surfaces of guide §14: one table per surface, actions next to the row
// they change.
import React, { useMemo, useState } from 'react';
import { Err, Field, Section, Seg, Table, Trace, fmtDate, fmtNum, useAct, useVerb } from './ui.jsx';

// --- Activity: the platform log ------------------------------------------------

export function Activity() {
  const [rows, e, reload] = useVerb('log.system', { limit: 300 });
  const [users] = useVerb('people.ls', {});
  const [q, setQ] = useState('');
  // Show people by name: ids stay in the log, names are for reading.
  const names = useMemo(() => Object.fromEntries((users || []).map(p => [p.id, p.name || p.email])), [users]);
  const readable = (s) => String(s).replace(/usr_[0-9a-f]+/g, id => names[id] || id);
  const shown = useMemo(() => (rows || []).filter(r => !q || readable(`${r.principal} ${r.via} ${r.summary}`).toLowerCase().includes(q.toLowerCase())), [rows, q, names]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Section title="Activity" tools={<>
      <input className="inp" placeholder="Filter by store, person or token" value={q} onChange={ev => setQ(ev.target.value)} aria-label="Filter" />
      <button className="btn" onClick={reload}>Refresh</button></>}>
      <Err e={e} />
      <Table rows={shown} rowKey={r => r.rev} empty="No activity yet." cols={[
        { h: 'When', r: r => <span className="dim">{fmtDate(r.at)}</span> },
        { h: 'Who', r: r => <span title={r.principal}>{readable(r.principal)}</span> },
        { h: 'Via', k: 'via', cls: 'dim' },
        { h: 'What', r: r => <span title={r.summary}>{readable(r.summary)}</span> },
      ]} />
    </Section>
  );
}

// --- People: roles, comps, tokens -------------------------------------------------

export function People({ toast }) {
  const [kind, setKind] = useState('user');
  const [people, e, reload] = useVerb('people.ls', { kind }, [kind]);
  const [comps, , reloadComps] = useVerb('sub.ls', {});
  const act = useAct(() => { reload(); reloadComps(); }, toast);
  const [until, setUntil] = useState('30d');
  const now = Date.now();
  const compOf = (id) => (comps || []).find(c => c.person === id && !c.revokedAt && c.until > now);
  return (
    <Section title="People" tools={<>
      <Seg value={kind} onChange={setKind} options={[['user', 'Users'], ['guest', 'Guests']]} />
      {kind === 'user' && <Field label="Comp for"><input className="inp sm" value={until} onChange={ev => setUntil(ev.target.value)} aria-label="Comp duration" /></Field>}
      <button className="btn" onClick={reload}>Refresh</button></>}>
      <Err e={e} />
      <Table rows={people} empty={kind === 'user' ? 'No users yet.' : 'No guests.'} cols={kind === 'user' ? [
        { h: 'Person', r: p => <><b>{p.name}</b> <span className="dim">{p.email}</span></> },
        { h: 'Role', r: p => <span className={p.role === 'pending' || p.role === 'disabled' ? 'bad' : ''}>{p.role}</span> },
        { h: 'Subscriber', r: p => { const c = compOf(p.id); return c ? <span>comp until {new Date(c.until).toLocaleDateString()} <button className="btn sm" onClick={() => act('sub.revoke', { id: c.id }, 'Comp revoked')}>Revoke</button></span> : <span className="dim">—</span>; } },
        { h: 'Last seen', r: p => <span className="dim">{fmtDate(p.lastSeenAt)}</span> },
        { h: '', r: p => <span className="acts">
          {p.role === 'pending' && <button className="btn primary sm" onClick={() => act('people.role', { id: p.id, role: 'member' }, `${p.name} let in`)}>Let in</button>}
          {p.role === 'member' && !compOf(p.id) && <button className="btn sm" onClick={() => act('sub.grant', { person: p.id, until, note: 'back office' }, `Comp for ${p.name}`)}>Grant comp</button>}
          {p.role === 'member' && <button className="btn sm" onClick={() => act('people.role', { id: p.id, role: 'admin' }, `${p.name} is an admin`)}>Make admin</button>}
          {p.role !== 'disabled' && p.role !== 'admin' && <button className="btn danger sm" onClick={() => act('people.role', { id: p.id, role: 'disabled' }, `${p.name} disabled`)}>Disable</button>}
          {p.role === 'disabled' && <button className="btn sm" onClick={() => act('people.role', { id: p.id, role: 'member' }, `${p.name} enabled`)}>Enable</button>}
        </span> },
      ] : [
        { h: 'Guest', k: 'id', cls: 'mono' },
        { h: 'Since', r: p => <span className="dim">{fmtDate(p.createdAt)}</span> },
        { h: 'Last seen', r: p => <span className="dim">{fmtDate(p.lastSeenAt)}</span> },
      ]} />
    </Section>
  );
}

// --- LLM: audience defaults, per-person rows, usage -------------------------------------

export function LLM({ toast }) {
  const [rows, e, reload] = useVerb('llm.ls', {});
  const act = useAct(reload, toast);
  const [subject, setSubject] = useState('@subscriber');
  const [on, setOn] = useState('on');
  const [budget, setBudget] = useState('2000000');
  const save = () => act('llm.set', { subject, value: on, ...(budget.trim() ? { budget: Number(budget) } : {}) }, `LLM for ${subject} saved`);
  return (
    <Section title="LLM" tools={<button className="btn" onClick={reload}>Refresh</button>}>
      <Err e={e} />
      <form className="formrow" onSubmit={ev => { ev.preventDefault(); save(); }}>
        <Field label="Who"><input className="inp" list="aud" value={subject} onChange={ev => setSubject(ev.target.value)} aria-label="Subject" /></Field>
        <datalist id="aud">{['@guest', '@member', '@subscriber', '@admin'].map(a => <option key={a} value={a} />)}</datalist>
        <Field label="Access"><Seg value={on} onChange={setOn} options={[['on', 'On'], ['off', 'Off']]} /></Field>
        <Field label="Tokens a month (empty: no limit)"><input className="inp sm" value={budget} onChange={ev => setBudget(ev.target.value)} aria-label="Budget" /></Field>
        <button className="btn primary" type="submit">Set</button>
      </form>
      <Table rows={rows} rowKey={r => r.subject} cols={[
        { h: 'Who', r: r => <b className="mono">{r.subject}</b> },
        { h: 'Access', r: r => (r.allowed ? 'on' : <span className="dim">off</span>) },
        { h: 'Budget / month', r: r => fmtNum(r.budget) },
        { h: 'Changed', r: r => <span className="dim">{fmtDate(r.changedAt)} {r.changedBy}</span> },
        { h: '', r: r => <span className="acts">
          {!r.subject.startsWith('@') && <button className="btn sm" onClick={() => act('llm.reset', { person: r.subject }, 'Usage reset')}>Reset usage</button>}
          {!r.subject.startsWith('@') && <button className="btn sm" onClick={() => act('llm.rm', { subject: r.subject }, 'Removed')}>Remove</button>}
        </span> },
      ]} />
      <Usage />
    </Section>
  );
}

function Usage() {
  const [who, setWho] = useState('');
  const [asked, setAsked] = useState('');
  const [u, e] = useVerb(asked ? 'llm.usage' : null, { person: asked }, [asked]);
  return (
    <div className="sub">
      <form className="formrow" onSubmit={ev => { ev.preventDefault(); setAsked(who.trim()); }}>
        <Field label="Usage of"><input className="inp" placeholder="usr_… or an email" value={who} onChange={ev => setWho(ev.target.value)} aria-label="Person" /></Field>
        <button className="btn" type="submit">Show</button>
      </form>
      <Err e={e} />
      {u && <dl className="kv narrow"><dt>audience</dt><dd>{u.audience}</dd><dt>access</dt><dd>{u.llm.allowed ? 'on' : 'off'}</dd>
        <dt>used this month</dt><dd>{fmtNum(u.llm.used)}</dd><dt>remaining</dt><dd>{fmtNum(u.llm.remaining)}</dd><dt>decided by</dt><dd>{u.llm.source || '—'}</dd></dl>}
    </div>
  );
}

// --- Apps: status, the policy matrix, secrets ----------------------------------------------

export function Apps({ toast }) {
  const [apps, e, reload] = useVerb('app.ls', {});
  const [sel, setSel] = useState('');
  return (
    <Section title="Apps" tools={<button className="btn" onClick={reload}>Refresh</button>}>
      <Err e={e} />
      <div className="split">
        <div className="list">
          <Table rows={apps} rowKey={a => a.app} sel={sel} onRow={a => setSel(a.app)} empty="No apps pushed yet." cols={[
            { h: 'App', r: a => <b>{a.app}</b> },
            { h: 'Title', r: a => a.title || '' },
            { h: 'Version', k: 'n' },
            { h: 'Kind', r: a => (a.live ? 'live' : 'static') },
          ]} />
        </div>
        <div className="detail">{sel ? <AppDetail app={sel} toast={toast} /> : <p className="empty">Pick an app.</p>}</div>
      </div>
    </Section>
  );
}

function AppDetail({ app, toast }) {
  const [st, e, reloadSt] = useVerb('app.status', { store: app }, [app]);
  const [pol, pe, reloadPol] = useVerb('policy.ls', { app }, [app]);
  const [secrets, , reloadSec] = useVerb('secret.ls', { app }, [app]);
  const act = useAct(() => { reloadSt(); reloadPol(); reloadSec(); }, toast);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const cells = pol?.cells || [];
  const caps = pol?.declared || [];
  const auds = ['guest', 'member', 'subscriber', 'admin'];
  const cell = (c, a) => cells.find(x => x.capability === c && x.audience === a);
  return (
    <div>
      <Err e={e || pe} />
      {st && <dl className="kv narrow"><dt>version</dt><dd>{st.n}</dd><dt>status</dt><dd className={st.broken ? 'bad' : ''}>{st.broken ? 'broken: ' + st.broken : 'running'}</dd></dl>}
      <div className="formrow"><button className="btn" onClick={() => act('app.restart', { store: app }, 'Restarted')}>Restart</button></div>
      <h3>Policy</h3>
      {caps.length === 0 ? <p className="empty">This app declares no policy capability.</p> : (
        <table className="rt matrixt"><thead><tr><th>capability</th>{auds.map(a => <th key={a}>{a}</th>)}</tr></thead>
          <tbody>{caps.map(c => <tr key={c}><td><b>{c}</b></td>{auds.map(a => { const x = cell(c, a); return (
            <td key={a}><button type="button" className={'cellbtn' + (x?.allowed ? ' on' : '')} aria-pressed={!!x?.allowed} aria-label={`${c} for ${a}`}
              onClick={() => act('policy.set', { app, capability: c, audience: '@' + a, value: x?.allowed ? 'off' : 'on' }, `${c} for ${a}: ${x?.allowed ? 'off' : 'on'}`)}>{x?.allowed ? 'on' : '–'}</button></td>); })}</tr>)}</tbody></table>)}
      <h3>Secrets</h3>
      <Table rows={secrets} rowKey={s => s.name} empty="No secrets." cols={[
        { h: 'Name', r: s => <b className="mono">{s.name}</b> },
        { h: 'Changed', r: s => <span className="dim">{fmtDate(s.changedAt)}</span> },
        { h: '', r: s => <button className="btn sm" onClick={() => act('secret.rm', { app, name: s.name }, 'Removed')}>Remove</button> },
      ]} />
      <form className="formrow" onSubmit={ev => { ev.preventDefault(); act('secret.set', { app, name, value }, `${name} set`).then(() => { setName(''); setValue(''); }); }}>
        <Field label="Name"><input className="inp sm" value={name} onChange={ev => setName(ev.target.value)} aria-label="Secret name" /></Field>
        <Field label="Value"><input className="inp" type="password" value={value} onChange={ev => setValue(ev.target.value)} aria-label="Secret value" /></Field>
        <button className="btn" type="submit" disabled={!name || !value}>Set secret</button>
      </form>
    </div>
  );
}

// --- Stores: grants and links ----------------------------------------------------------

export function Stores({ toast }) {
  const [stores, e, reload] = useVerb('store.ls', { all: true });
  const [sel, setSel] = useState('');
  return (
    <Section title="Stores" tools={<button className="btn" onClick={reload}>Refresh</button>}>
      <Err e={e} />
      <div className="split">
        <div className="list">
          <Table rows={stores} rowKey={s => s.id} sel={sel} onRow={s => setSel(s.id)} cols={[
            { h: 'Store', r: s => <b>{s.id}</b> },
            { h: 'App', r: s => s.app || <span className="dim">—</span> },
            { h: 'Type', r: s => s.type || '' },
            { h: 'Owner', r: s => <span className="dim mono">{s.owner}</span> },
          ]} />
        </div>
        <div className="detail">{sel ? <StoreAccess store={sel} toast={toast} /> : <p className="empty">Pick a store.</p>}</div>
      </div>
    </Section>
  );
}

function StoreAccess({ store, toast }) {
  const [grants, e, reloadG] = useVerb('grant.ls', { store }, [store]);
  const [links, , reloadL] = useVerb('link.ls', { store }, [store]);
  const act = useAct(() => { reloadG(); reloadL(); }, toast);
  const [subject, setSubject] = useState('@member');
  const [level, setLevel] = useState('view');
  const [made, setMade] = useState(null);
  return (
    <div>
      <Err e={e} />
      <h3>Grants</h3>
      <Table rows={grants} rowKey={g => g.subject + g.via} empty="No grants." cols={[
        { h: 'Subject', r: g => <b className="mono">{g.subject}</b> },
        { h: 'Level', k: 'level' },
        { h: 'Via', r: g => <span className="dim">{g.via}</span> },
        { h: '', r: g => <button className="btn sm" onClick={() => act('grant.rm', { store, subject: g.subject, via: g.via }, 'Revoked')}>Revoke</button> },
      ]} />
      <form className="formrow" onSubmit={ev => { ev.preventDefault(); act('grant.set', { store, subject, level }, `${subject} ${level}`); }}>
        <Field label="Subject"><input className="inp" list="subs" value={subject} onChange={ev => setSubject(ev.target.value)} aria-label="Grant subject" /></Field>
        <datalist id="subs">{['@guest', '@member', '@subscriber'].map(a => <option key={a} value={a} />)}</datalist>
        <Field label="Level"><Seg value={level} onChange={setLevel} options={[['view', 'View'], ['interact', 'Interact'], ['admin', 'Admin']]} /></Field>
        <button className="btn primary" type="submit">Grant</button>
      </form>
      <h3>Links</h3>
      <Table rows={(links || []).filter(l => !l.revokedAt)} rowKey={l => l.id} empty="No links." cols={[
        { h: 'Link', r: l => <span className="mono">{l.id}</span> },
        { h: 'Level', k: 'level' },
        { h: 'Uses', k: 'uses' },
        { h: 'Expires', r: l => <span className="dim">{l.expiresAt ? fmtDate(l.expiresAt) : 'never'}</span> },
        { h: '', r: l => <button className="btn sm" onClick={() => act('link.rm', { id: l.id }, 'Link revoked')}>Revoke</button> },
      ]} />
      <div className="formrow">
        <button className="btn" onClick={async () => { const r = await act('link.new', { store, level: 'view', days: 30 }); if (r) setMade(r.token); }}>New view link (30 days)</button>
        {made && <code className="made">?k={made}</code>}
      </div>
    </div>
  );
}

// --- Sites: hosts and mounts -------------------------------------------------------------

export function Sites({ toast, hosts }) {
  const [mounts, e, reload] = useVerb('mount.ls', {});
  const act = useAct(reload, toast);
  const [host, setHost] = useState(hosts.live[0] || '');
  const [path, setPath] = useState('/');
  const [store, setStore] = useState('');
  const all = [...hosts.live.map(h => [h, 'live']), ...hosts.static.map(h => [h, 'static'])];
  return (
    <Section title="Sites" tools={<button className="btn" onClick={reload}>Refresh</button>}>
      <Err e={e} />
      <form className="formrow" onSubmit={ev => { ev.preventDefault(); act('mount.set', { host, path, store }, `Mounted ${store} at ${host}${path}`); }}>
        <Field label="Host"><select className="inp" value={host} onChange={ev => setHost(ev.target.value)} aria-label="Host">{all.map(([h, k]) => <option key={h} value={h}>{h} · {k}</option>)}</select></Field>
        <Field label="Path"><input className="inp sm" value={path} onChange={ev => setPath(ev.target.value)} aria-label="Path" /></Field>
        <Field label="Store"><input className="inp sm" value={store} onChange={ev => setStore(ev.target.value)} aria-label="Store" /></Field>
        <button className="btn primary" type="submit" disabled={!store}>Mount</button>
      </form>
      <Table rows={mounts} rowKey={r => r.mount.host + r.mount.path} empty="Nothing is mounted." cols={[
        { h: 'Address', r: r => <a href={r.url} target="_blank" rel="noreferrer">{r.mount.host}{r.mount.path}</a> },
        { h: 'Kind', r: r => <span className="dim">{r.kind}</span> },
        { h: 'Store', r: ({ mount: m }) => m.store || <span className="dim">:{m.storeParam}{m.type ? ` (${m.type})` : ''}</span> },
        { h: 'Creates', r: r => r.mount.createApp || '' },
        { h: 'Changed', r: r => <span className="dim">{fmtDate(r.mount.changedAt)}</span> },
        { h: '', r: ({ mount: m }) => <span className="acts">
          <button className="btn sm" onClick={() => act('mount.rm', { host: m.host, path: m.path }, 'Removed')}>Remove</button>
          <button className="btn sm" onClick={() => act('mount.undo', { host: m.host, path: m.path }, 'Undone')}>Undo</button></span> },
      ]} />
    </Section>
  );
}

// --- Explain: can() with its trace --------------------------------------------------------

export function Explain() {
  const [store, setStore] = useState('');
  const [subject, setSubject] = useState('anonymous');
  const [level, setLevel] = useState('view');
  const [path, setPath] = useState('');
  const [op, setOp] = useState('read');
  const [ask, setAsk] = useState(null);
  const [out, e] = useVerb(ask ? 'explain.can' : null, ask || {}, [JSON.stringify(ask)]);
  return (
    <Section title="Explain">
      <form className="formrow" onSubmit={ev => { ev.preventDefault(); setAsk({ store, subject, level, ...(path ? { path, op } : {}) }); }}>
        <Field label="Store"><input className="inp sm" value={store} onChange={ev => setStore(ev.target.value)} aria-label="Store" /></Field>
        <Field label="Who"><input className="inp" value={subject} onChange={ev => setSubject(ev.target.value)} aria-label="Who" /></Field>
        <Field label="Level"><Seg value={level} onChange={setLevel} options={[['view', 'View'], ['interact', 'Interact'], ['admin', 'Admin'], ['owner', 'Owner']]} /></Field>
        <Field label="Document path (optional)"><input className="inp sm" value={path} onChange={ev => setPath(ev.target.value)} aria-label="Path" /></Field>
        {path && <Field label="Op"><Seg value={op} onChange={setOp} options={[['read', 'Read'], ['write', 'Write']]} /></Field>}
        <button className="btn primary" type="submit" disabled={!store}>Explain</button>
      </form>
      <Err e={e} />
      {out && <div className="answer"><p className={out.ok ? 'ok' : 'bad'}>{out.ok ? '✓ allowed' : `✗ ${out.code}`} — level <b>{out.level}</b>, needs <b>{out.need}</b>, audience <b>{out.audience}</b></p><Trace lines={out.trace} /></div>}
    </Section>
  );
}
