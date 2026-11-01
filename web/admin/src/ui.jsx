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

export function Table({ rows, cols, empty = 'Nothing here.', onRow, sel, rowKey = (r, i) => r.id || r.subject || r.name || i }) {
  if (!rows || !rows.length) return <p className="empty">{empty}</p>;
  return (
    <div className="tablewrap"><table className="rt">
      <thead><tr>{cols.map(c => <th key={c.h} className={c.h === '' ? 'r' : ''}>{c.h}</th>)}</tr></thead>
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
