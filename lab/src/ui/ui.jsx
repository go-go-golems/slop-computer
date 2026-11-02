// Shared hooks and small components for the lab's views.
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

export const Lab = createContext(null);
export const useLab = () => useContext(Lab);
export const Visible = createContext(true);

const ALL = ['commit', 'turn', 'stores', 'actors', 'access', 'mounts', 'steps', 'clock', 'faults', 'views', 'pagelog', 'room'];
// Re-run `fn` when deps change or when one of the kernel events arrives (throttled).
export function useK(fn, deps, events = ALL) {
  const { client, epoch } = useLab();
  const visible = useContext(Visible);
  const [state, set] = useState({ v: null, e: null, loading: true });
  const [tick, setTick] = useState(0);
  const evs = events.join(',');
  useEffect(() => {
    let t = null, pending = false;
    const off = client.on((names) => {
      if (!names.some(n => evs.includes(n))) return;
      if (t) { pending = true; return; }
      setTick(x => x + 1);
      t = setTimeout(() => { t = null; if (pending) { pending = false; setTick(x => x + 1); } }, 180);
    });
    return () => { off(); clearTimeout(t); };
  }, [client, evs]);
  useEffect(() => {
    if (!visible) return undefined;
    let live = true;
    Promise.resolve().then(fn).then(v => live && set({ v, e: null, loading: false }), e => live && set(s => ({ v: s.v, e, loading: false })));
    return () => { live = false; };
  }, [...deps, tick, epoch, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state.v, state.e, state.loading];
}

export function useLocal(key, init) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem('slop-lab.' + key); return s ? JSON.parse(s) : init; } catch { return init; } });
  const set = useCallback((x) => setV(prev => { const nv = typeof x === 'function' ? x(prev) : x; try { localStorage.setItem('slop-lab.' + key, JSON.stringify(nv)); } catch { /* none */ } return nv; }), [key]);
  return [v, set];
}

export const fmtTime = (ms) => { if (ms == null) return ''; const d = new Date(ms); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };
export const fmtDate = (ms) => { if (ms == null) return ''; const d = new Date(ms); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + fmtTime(ms); };
export function fmtDur(ms) { if (ms == null) return ''; const neg = ms < 0; ms = Math.abs(ms); const s = Math.round(ms / 1000); const out = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`; return neg ? `${out} ago` : out; }
export const short = (s, n = 80) => { s = typeof s === 'string' ? s : JSON.stringify(s); return s && s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function Json({ value, max = 400 }) {
  const s = JSON.stringify(value, null, 2);
  return <pre className="src json">{s && s.length > 20000 ? s.slice(0, 20000) + '\n…' : s}</pre>;
}

export function Table({ rows, cols, onRow, sel, rowClass, empty = 'None.' }) {
  if (!rows || !rows.length) return <p className="empty">{empty}</p>;
  cols = cols || Object.keys(rows[0]).map(k => ({ k, h: k }));
  return (
    <div className="tablewrap"><table className="rt">
      <thead><tr>{cols.map(c => <th key={c.k} className={c.num ? 'num' : ''}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.id || r.path || r.name || i} className={[onRow ? 'clickable' : '', sel != null && sel === (r.id ?? r.path ?? r.name) ? 'sel' : '', rowClass ? rowClass(r) : ''].join(' ')} onClick={onRow ? () => onRow(r) : undefined}>
          {cols.map(c => <td key={c.k} className={(c.num ? 'num ' : '') + (c.cls || '')}>{c.r ? c.r(r) : fmtCell(r[c.k])}</td>)}
        </tr>))}</tbody>
    </table></div>
  );
}
export function fmtCell(v) { if (v == null) return <span className="dim">null</span>; if (typeof v === 'object') return <code>{short(v, 90)}</code>; if (typeof v === 'string' && v.length > 120) return short(v, 120); return String(v); }

export function Trace({ lines }) {
  if (!lines || !lines.length) return null;
  return <ul className="trace-l">{lines.map((l, i) => <li key={i} className={l.startsWith('✗') ? 'bad' : l.startsWith('✓') ? 'okl' : l.startsWith('·') ? 'dim' : ''}>{l.replace(/^· /, '')}</li>)}</ul>;
}

export function Seg({ value, options, onChange, sm }) {
  return <div className={'seg' + (sm ? ' sm' : '')} role="group">{options.map(o => { const [v, l, t] = Array.isArray(o) ? o : [o, o]; return <button key={v} className={value === v ? 'on' : ''} aria-pressed={value === v} title={t} onClick={() => onChange(v)}>{l}</button>; })}</div>;
}

export function StorePick({ value, onChange, filter }) {
  const { ov } = useLab();
  const stores = (ov ? ov.stores : []).filter(s => !filter || filter(s));
  return <select value={value || ''} onChange={e => onChange(e.target.value)} aria-label="Store">{stores.map(s => <option key={s.id} value={s.id}>{s.id}{s.app ? ` · ${s.app}` : s.isApp ? ' · app' : ''}</option>)}</select>;
}

export function Err({ e }) { if (!e) return null; return <div className="errbox"><b>{e.code || 'error'}</b> {e.message}{e.trace ? <Trace lines={e.trace} /> : null}</div>; }

export function Menu({ label, children, right, className = 'btn', title }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!open) return; const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [open]);
  return <div className="rel" ref={ref}><button className={className} title={title} aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>{open && <div className={'menu' + (right ? ' right' : '')} onClick={(e) => { if (e.target.closest('button')) setOpen(false); }}>{children}</div>}</div>;
}

export function Empty({ children }) { return <div className="padded"><p className="empty">{children}</p></div>; }
export const levelOf = (s) => s;
