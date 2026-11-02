// Small shared pieces, after the lab's ui.jsx (Table, Trace, Seg, Err).
import React, { useCallback, useEffect, useState } from 'react';
import { call, onChange } from './api.js';

// useVerb runs a verb, again when deps change or reload() is called.
export function useVerb(verb, args, deps = []) {
  const [state, set] = useState({ v: null, e: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!verb) { set({ v: null, e: null, loading: false }); return undefined; }
    let live = true;
    call(verb, args).then(v => live && set({ v, e: null, loading: false }), e => live && set(s => ({ ...s, e, loading: false })));
    return () => { live = false; };
  }, [verb, tick, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => onChange(reload), [reload]);
  return [state.v, state.e, reload, state.loading];
}

// useAct wraps an action: it runs, reports failure, then reloads.
export function useAct(onDone, toast) {
  return useCallback(async (verb, args, ok) => {
    try {
      const r = await call(verb, args);
      if (ok) toast(ok);
      onDone && onDone();
      return r;
    } catch (e) {
      toast(`${e.code}: ${e.message}`, true);
      return undefined;
    }
  }, [onDone, toast]);
}

export const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};
export const fmtNum = (n) => (n == null ? '∞' : Number(n).toLocaleString());

export function Table({ rows, cols, empty = 'Nothing here.', onRow, sel, rowKey = (r, i) => r.id || r.subject || r.name || i, sort, onSort }) {
  if (!rows || !rows.length) return <p className="empty">{empty}</p>;
  const head = (c) => {
    if (!c.sort || !onSort) return c.h;
    const on = sort && sort.by === c.h;
    return (
      <button type="button" className={'sorth' + (on ? ' on' : '')} onClick={() => onSort(c.h)} aria-label={`Sort by ${c.h}`}>
        {c.h}<span className="sortmark" aria-hidden="true">{on ? (sort.desc ? '↓' : '↑') : ''}</span>
      </button>
    );
  };
  return (
    <div className="tablewrap"><table className="rt">
      <thead><tr>{cols.map(c => <th key={c.h} className={c.h === '' ? 'r' : ''} aria-sort={sort && sort.by === c.h ? (sort.desc ? 'descending' : 'ascending') : undefined}>{head(c)}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={rowKey(r, i)} className={(onRow ? 'clickable ' : '') + (sel != null && sel === rowKey(r, i) ? 'sel' : '')} onClick={onRow ? () => onRow(r) : undefined}>
          {cols.map(c => <td key={c.h} className={(c.cls || '') + (c.h === '' ? ' r' : '')}>{c.r ? c.r(r) : String(r[c.k] ?? '')}</td>)}
        </tr>))}</tbody>
    </table></div>
  );
}

export function Trace({ lines }) {
  if (!lines || !lines.length) return null;
  return <ul className="trace-l">{lines.map((l, i) => <li key={i} className={l.includes(' < ') ? 'bad' : ''}>{l}</li>)}</ul>;
}

export function Err({ e }) {
  if (!e) return null;
  return <div className="errbox"><b>{e.code || 'error'}</b> {e.message}{e.trace ? <Trace lines={e.trace} /> : null}</div>;
}

export function Seg({ value, options, onChange }) {
  return <div className="seg" role="group">{options.map(([v, l]) => (
    <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>))}</div>;
}

// Section is one surface: a toolbar line and a body.
export function Section({ title, tools, children }) {
  return (
    <section className="surface">
      <div className="toolbar"><h2 className="stitle">{title}</h2><span className="sp" />{tools}</div>
      <div className="sbody">{children}</div>
    </section>
  );
}

// Field is a labelled control in a form row.
export function Field({ label, children }) {
  return <label className="field"><span className="lbl">{label}</span>{children}</label>;
}

// useHashParams keeps a view's state in the hash after its name
// (#stores?q=weft&p=2&sel=weft): a view can be linked, and survives a
// reload. set(patch) merges; an empty value removes the key.
export function useHashParams() {
  const read = () => {
    const i = location.hash.indexOf('?');
    return Object.fromEntries(new URLSearchParams(i < 0 ? '' : location.hash.slice(i + 1)));
  };
  const [params, setParams] = useState(read);
  useEffect(() => { const f = () => setParams(read()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const set = useCallback((patch) => {
    const next = { ...read(), ...patch };
    Object.keys(next).forEach(k => { if (next[k] === '' || next[k] == null) delete next[k]; });
    const name = location.hash.slice(1).split('?')[0];
    const q = new URLSearchParams(next).toString();
    history.replaceState(null, '', '#' + name + (q ? '?' + q : ''));
    setParams(next);
  }, []);
  return [params, set];
}

const PAGE_SIZES = [25, 50, 100];

// Browse is a table for long lists: a search box, filters, sortable
// columns and pages, with its state in the hash (useHashParams).
//   text(r)   the text a row is searched by
//   filters   [[key, label, test(r)]], the first one shows everything
//   cols      Table columns; a column with sort: r => value sorts
//   defaultSort, defaultDesc   the order before anyone picks one
export function Browse({ rows, cols, text, filters, rowKey = r => r.id, sel, onRow, empty, noun = 'items', defaultSort, defaultDesc }) {
  const [p, set] = useHashParams();
  const q = p.q || '';
  const filter = filters && (filters.find(f => f[0] === p.f) || filters[0]);
  const sort = { by: p.s || defaultSort || '', desc: p.d ? p.d === '1' : !p.s && !!defaultDesc };
  const size = PAGE_SIZES.includes(Number(p.n)) ? Number(p.n) : PAGE_SIZES[0];
  const all = rows || [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = all.filter(r => (!filter || filter[2](r)) && (!words.length || words.every(w => text(r).toLowerCase().includes(w))));
  const col = cols.find(c => c.h === sort.by && c.sort);
  if (col) {
    shown = shown.slice().sort((a, b) => {
      const x = col.sort(a), y = col.sort(b);
      const c = (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }))
        || String(rowKey(a)).localeCompare(String(rowKey(b)), undefined, { numeric: true });
      return sort.desc ? -c : c;
    });
  }
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const page = Math.min(Math.max(1, Number(p.p) || 1), pages);
  const from = (page - 1) * size;
  const onSort = (h) => set({ s: h, d: sort.by === h ? (sort.desc ? '0' : '1') : '', p: '' });
  return (
    <div className="browse">
      <div className="browsebar">
        <input className="inp" type="search" placeholder={`Search ${noun}`} value={q} aria-label={`Search ${noun}`}
          onChange={ev => set({ q: ev.target.value, p: '' })} />
        {filters && <Seg value={filter[0]} onChange={f => set({ f: f === filters[0][0] ? '' : f, p: '' })}
          options={filters.map(([k, label]) => [k, `${label} ${all.filter(filters.find(x => x[0] === k)[2]).length}`])} />}
        <span className="sp" />
        <span className="dim">{shown.length === all.length ? `${all.length} ${noun}` : `${shown.length} of ${all.length} ${noun}`}</span>
      </div>
      <Table rows={shown.slice(from, from + size)} cols={cols} rowKey={rowKey} sel={sel} onRow={onRow}
        empty={all.length ? `No ${noun} match.` : empty} sort={sort} onSort={onSort} />
      {shown.length > PAGE_SIZES[0] && (
        <div className="pager">
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => set({ p: String(page - 1) })} aria-label="Previous page">‹</button>
          <span className="dim">{from + 1}–{Math.min(from + size, shown.length)} of {shown.length}</span>
          <button type="button" className="btn sm" disabled={page >= pages} onClick={() => set({ p: String(page + 1) })} aria-label="Next page">›</button>
          <select className="inp sm" value={size} aria-label="Rows per page" onChange={ev => set({ n: ev.target.value === '25' ? '' : ev.target.value, p: '' })}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// Kv is a definition list of [label, value] pairs (empty values are left out).
export function Kv({ items }) {
  const shown = items.filter(([, v]) => v !== '' && v != null && v !== false);
  return <dl className="kv">{shown.map(([k, v]) => [<dt key={k + 't'}>{k}</dt>, <dd key={k + 'd'}>{v}</dd>])}</dl>;
}
