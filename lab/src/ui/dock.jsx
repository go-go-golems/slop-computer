// The dock, as the Kiln workbench defines it: a layout tree of splits and tiles. Drag a tab onto
// another strip to move it, onto a tile's outer 22% to split that tile, or into its middle to add
// it as a tab. Gutters resize (each side keeps at least 6%). × closes a view; + and the empty-tile
// picker reopen it. Views render once, into hosts that move between tiles, so they keep their state.
import React, { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Visible, useLocal } from './ui.jsx';

let seq = 0;
const nid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
export const T = (views, active) => ({ t: 'tile', id: nid('t'), views, active: active || views[0] || null });
export const S = (dir, kids, sizes) => ({ t: 'split', id: nid('s'), dir, kids, sizes: sizes || kids.map(() => 1 / kids.length) });

// Drop unknown and duplicate views, one-child splits, and (on load) empty tiles; merge same-direction splits.
export function normalize(node, known, keepEmpty = false, seen = new Set()) {
  if (!node) return null;
  if (node.t === 'tile') {
    const views = (node.views || []).filter(v => known.has(v) && !seen.has(v));
    views.forEach(v => seen.add(v));
    if (!views.length && !keepEmpty) return null;
    return { ...node, id: node.id || nid('t'), views, active: views.includes(node.active) ? node.active : views[0] || null };
  }
  const kids = [], sizes = [];
  const total = (node.sizes || []).reduce((a, b) => a + b, 0) || 1;
  (node.kids || []).forEach((k, i) => {
    const n = normalize(k, known, keepEmpty, seen); if (!n) return;
    const sz = ((node.sizes && node.sizes[i]) || 1 / node.kids.length) / total;
    if (n.t === 'split' && n.dir === node.dir) n.kids.forEach((kk, j) => { kids.push(kk); sizes.push(n.sizes[j] * sz); });
    else { kids.push(n); sizes.push(sz); }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { ...node, id: node.id || nid('s'), kids, sizes: sizes.map(x => x / sum) };
}
const tiles = (n, out = []) => { if (!n) return out; if (n.t === 'tile') out.push(n); else n.kids.forEach(k => tiles(k, out)); return out; };
export const allViews = (n) => tiles(n).flatMap(t => t.views);
const mapTiles = (n, f) => (n.t === 'tile' ? f(n) : { ...n, kids: n.kids.map(k => mapTiles(k, f)) });
const replace = (n, id, f) => (n.id === id ? f(n) : n.t === 'split' ? { ...n, kids: n.kids.map(k => replace(k, id, f)) } : n);
function removeView(tree, v, keepEmptyId) {
  const t = mapTiles(tree, (x) => (x.views.includes(v) ? { ...x, views: x.views.filter(y => y !== v), active: x.active === v ? x.views.filter(y => y !== v)[Math.max(0, x.views.indexOf(v) - 1)] || null : x.active } : x));
  return t;
}
function prune(tree, known, keep) { // remove empty tiles except `keep`
  const strip = (n) => { if (n.t === 'tile') return n.views.length || n.id === keep ? n : null; const kids = [], sizes = []; n.kids.forEach((k, i) => { const m = strip(k); if (m) { kids.push(m); sizes.push(n.sizes[i]); } }); return kids.length ? { ...n, kids, sizes } : null; };
  return normalize(strip(tree) || T([]), known, true);
}
export function moveView(tree, v, target, known) {
  const src = tiles(tree).find(t => t.views.includes(v));
  if (!src) return tree;
  if (target.kind === 'tabs') {
    if (target.tile === src.id) { const views = src.views.filter(x => x !== v); const at = Math.min(target.index - (src.views.indexOf(v) < target.index ? 1 : 0), views.length); views.splice(at, 0, v); return replace(tree, src.id, (x) => ({ ...x, views, active: v })); }
    let t = removeView(tree, v);
    t = replace(t, target.tile, (x) => { const views = [...x.views]; views.splice(Math.min(target.index, views.length), 0, v); return { ...x, views, active: v }; });
    return prune(t, known, target.tile);
  }
  if (target.kind === 'join') {
    if (target.tile === src.id) return tree;
    let t = removeView(tree, v);
    t = replace(t, target.tile, (x) => ({ ...x, views: [...x.views, v], active: v }));
    return prune(t, known, target.tile);
  }
  if (target.kind === 'split') {
    if (target.tile === src.id && src.views.length === 1) return tree;
    let t = removeView(tree, v);
    const fresh = T([v]);
    const dir = target.side === 'left' || target.side === 'right' ? 'row' : 'col';
    t = replace(t, target.tile, (x) => S(dir, target.side === 'left' || target.side === 'top' ? [fresh, x] : [x, fresh], [0.5, 0.5]));
    return prune(t, known, null);
  }
  return tree;
}

// ---------------------------------------------------------------- the component
export function Dock({ tree, setTree, views, abouts, counts, mountKey }) {
  const known = new Set(Object.keys(views));
  const hosts = useRef({}), bodies = useRef({});
  const [mounted, setMounted] = useState(() => new Set(tiles(tree).map(t => t.active).filter(Boolean)));
  const [drag, setDrag] = useState(null); // {view, x, y, target, hint}
  const hostFor = (v) => { if (!hosts.current[v]) { const d = document.createElement('div'); d.className = 'viewhost'; d.dataset.view = v; hosts.current[v] = d; } return hosts.current[v]; };
  const inLayout = new Set(allViews(tree));
  const active = new Set(tiles(tree).map(t => t.active).filter(Boolean));
  useEffect(() => { const add = [...active].filter(v => !mounted.has(v)); const drop = [...mounted].filter(v => !inLayout.has(v)); if (add.length || drop.length) setMounted(m => { const n = new Set(m); add.forEach(v => n.add(v)); drop.forEach(v => n.delete(v)); return n; }); });
  // Put each view's host into its tile's body; only the active one shows. Moving a host between tiles is a DOM move, not a remount.
  useLayoutEffect(() => {
    for (const [v, h] of Object.entries(hosts.current)) if (!inLayout.has(v) && h.parentNode) h.remove();
    for (const t of tiles(tree)) {
      const body = bodies.current[t.id]; if (!body) continue;
      for (const v of t.views) { if (!mounted.has(v)) continue; const h = hostFor(v); if (h.parentNode !== body) body.appendChild(h); h.hidden = v !== t.active; }
    }
  });

  const open = (tileId, v) => setTree(t => normalize(replace(removeView(t, v), tileId, (x) => ({ ...x, views: [...x.views, v], active: v })), known, true));
  const close = (v) => setTree(t => normalize(removeView(t, v), known, true));
  const activate = (tileId, v) => setTree(t => replace(t, tileId, (x) => ({ ...x, active: v })));

  // ---- dragging a tab
  const startDrag = (e, v, tileId) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY, el = e.currentTarget;
    let started = false, target = null;
    const find = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      const strip = hit && hit.closest('.dstrip');
      const tileEl = hit && hit.closest('.tile[data-tile]');
      if (strip && tileEl) {
        const id = tileEl.dataset.tile; const tabs = [...strip.querySelectorAll('.dtab')];
        let index = tabs.length, mx = null;
        for (let i = 0; i < tabs.length; i++) { const r = tabs[i].getBoundingClientRect(); if (x < r.left + r.width / 2) { index = i; mx = r.left; break; } }
        if (mx == null) { const r = tabs.length ? tabs[tabs.length - 1].getBoundingClientRect() : strip.getBoundingClientRect(); mx = tabs.length ? r.right : r.left + 4; }
        const sr = strip.getBoundingClientRect();
        return { kind: 'tabs', tile: id, index, label: id === tileId ? 'move here' : 'move here', hint: { marker: true, left: mx - 1, top: sr.top + 6, width: 2, height: sr.height - 12 } };
      }
      if (tileEl) {
        const id = tileEl.dataset.tile; const r = tileEl.getBoundingClientRect();
        const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
        const edges = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]].sort((a, b) => a[1] - b[1]);
        const [side, d] = edges[0];
        const src = tiles(tree).find(t => t.id === id);
        const alone = id === tileId && src && src.views.length === 1;
        if (d < 0.22 && !alone) {
          const h = side === 'left' ? { left: r.left, top: r.top, width: r.width / 2, height: r.height } : side === 'right' ? { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height } : side === 'top' ? { left: r.left, top: r.top, width: r.width, height: r.height / 2 } : { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 };
          return { kind: 'split', tile: id, side, label: `split ${side}`, hint: h };
        }
        if (id === tileId) return { kind: 'none', label: 'drop on another tile' };
        return { kind: 'join', tile: id, label: 'add as a tab', hint: { left: r.left, top: r.top, width: r.width, height: r.height } };
      }
      return { kind: 'none', label: 'drop on a tile' };
    };
    const move = (ev) => {
      if (!started) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return; started = true; document.body.classList.add('dragging-view'); try { el.setPointerCapture(e.pointerId); } catch { /* fine */ } }
      target = find(ev.clientX, ev.clientY);
      setDrag({ view: v, x: ev.clientX, y: ev.clientY, target });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', esc);
      document.body.classList.remove('dragging-view'); setDrag(null);
      if (!started) { activate(tileId, v); return; }
      if (target && target.kind !== 'none') setTree(t => moveView(t, v, target, known));
    };
    const esc = (ev) => { if (ev.key === 'Escape') { target = null; started = true; up(); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', esc);
  };

  const closed = Object.keys(views).filter(v => !inLayout.has(v));
  const render = (n) => {
    if (n.t === 'tile') return <TileView key={n.id} node={n} views={views} abouts={abouts} counts={counts} closed={closed} bodyRef={(el) => { bodies.current[n.id] = el; }} onTabDown={startDrag} onClose={close} onOpen={open} onActivate={activate} drag={drag} />;
    return (
      <div className={'dsplit ' + n.dir} key={n.id}>
        {n.kids.map((k, i) => <Fragment key={k.id}>
          {i > 0 && <Gutter split={n} index={i} setTree={setTree} />}
          <div className="dcell" style={{ flex: `${n.sizes[i]} 1 0` }}>{render(k)}</div>
        </Fragment>)}
      </div>
    );
  };
  return (
    <div className="dock" key={mountKey}>
      {render(tree)}
      {[...mounted].filter(v => views[v]).map(v => { const C = views[v].C; return createPortal(<Visible.Provider value={active.has(v)}><C visible={active.has(v)} /></Visible.Provider>, hostFor(v), v); })}
      {drag && drag.target && drag.target.hint && <div className={'drop-hint' + (drag.target.hint.marker ? ' marker' : '')} style={{ left: drag.target.hint.left, top: drag.target.hint.top, width: drag.target.hint.width, height: drag.target.hint.height }}>{!drag.target.hint.marker && <span>{drag.target.label}</span>}</div>}
      {drag && <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }}>{views[drag.view].title} <small>{drag.target ? drag.target.label : ''}</small></div>}
    </div>
  );
}

function TileView({ node, views, abouts, counts, closed, bodyRef, onTabDown, onClose, onOpen, onActivate, drag }) {
  const [plus, setPlus] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!plus) return undefined; const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setPlus(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [plus]);
  return (
    <section className={'tile' + (drag ? ' dragging' : '')} data-tile={node.id}>
      <div className="dstrip">
        <div className="dtabs" role="tablist">
          {node.views.map(v => <div key={v} className={'dtab' + (v === node.active ? ' on' : '') + (drag && drag.view === v ? ' lifted' : '')}>
            <button className="lbl" role="tab" aria-selected={v === node.active} onPointerDown={(e) => onTabDown(e, v, node.id)} onClick={(e) => { if (e.detail === 0) onActivate(node.id, v); }} title={`${views[v].title}: drag to move, onto an edge to split`}>{views[v].title}{counts[v] ? <span className="count bad">{counts[v]}</span> : null}</button>
            <button className="x" aria-label={`Close ${views[v].title}`} onClick={() => onClose(v)}>×</button>
          </div>)}
        </div>
        <div className="rel" ref={ref}>
          <button className="tabact plus" title="Open a view in this tile" aria-expanded={plus} onClick={() => setPlus(!plus)}>+</button>
          {plus && <div className="menu right">{closed.length ? closed.map(v => <button key={v} onClick={() => { setPlus(false); onOpen(node.id, v); }}><span className="t">{views[v].title}</span><small>{abouts[v]}</small></button>) : <p className="note">Every view is open. Drag a tab here to move it.</p>}</div>}
        </div>
      </div>
      <div className="tilebody" ref={bodyRef}>
        {!node.views.length && <div className="picker"><p className="lead">An empty tile. Open a view:</p><div className="pgrid">{closed.map(v => <button key={v} onClick={() => onOpen(node.id, v)}><b>{views[v].title}</b><small>{abouts[v]}</small></button>)}</div>{!closed.length && <p className="lead">Every view is open. Drag a tab here to move it.</p>}</div>}
      </div>
    </section>
  );
}

function Gutter({ split, index, setTree }) {
  const resize = (sizes) => setTree(t => replace(t, split.id, (x) => ({ ...x, sizes })));
  const set = (p) => {
    const a = split.sizes.slice(0, index - 1).reduce((x, y) => x + y, 0);
    const pair = split.sizes[index - 1] + split.sizes[index];
    const left = Math.min(pair - 0.06, Math.max(0.06, p - a));
    const sizes = [...split.sizes]; sizes[index - 1] = left; sizes[index] = pair - left; resize(sizes);
  };
  const onDown = (e) => {
    e.preventDefault();
    const box = e.currentTarget.parentElement.getBoundingClientRect();
    const row = split.dir === 'row';
    document.body.classList.add(row ? 'resizing-x' : 'resizing-y');
    const move = (ev) => set(row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height);
    const up = () => { document.body.classList.remove('resizing-x', 'resizing-y'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const key = (e) => {
    const d = (split.dir === 'row' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 })[e.key];
    if (!d) return; e.preventDefault();
    const a = split.sizes.slice(0, index).reduce((x, y) => x + y, 0);
    set(a + d * 0.03);
  };
  return <div className={'gutter ' + split.dir} role="separator" aria-orientation={split.dir === 'row' ? 'vertical' : 'horizontal'} tabIndex={0} onPointerDown={onDown} onKeyDown={key} />;
}

// The layout lives in this browser; unknown views and empty tiles are dropped when it loads.
export function useLayout(presets, known) {
  const [stored, setStored] = useLocal('layout.tree.v1', null);
  const [tree, setTree] = useState(() => normalize(stored, known) || presets.site.tree());
  useEffect(() => { setStored(tree); }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
  return [tree, setTree];
}
export { tiles, replace };
