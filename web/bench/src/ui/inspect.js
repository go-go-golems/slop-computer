// ui/inspect.js — the Inspector (the selected element: its source, box,
// computed styles and the CSS rules that match it, editable in place) and
// Layers (the DOM outline of the selected frame).
//
// Editing a declaration writes the stylesheet in the viewed workspace
// (lib/css.js finds the rule); the frames show it once the edit commits.
//
// Public API: INSPECTOR, LAYERS (views).
import { App } from './app.js';
import { Dock } from './dock.js';
import { clear, h, toast } from '../lib/dom.js';
import { cssSet, findRule } from '../lib/css.js';
import { debounce, lineOf } from '../lib/util.js';

export const INSPECTOR = {
  title: 'Inspector', sub: 'styles',
  make() {
    const body = h('div.scroll'), el = h('div', body)
    let seq = 0
    async function paint() {
      const s = App.sel, my = ++seq
      clear(body)
      if (!s) { body.appendChild(h('p.empty', 'Select an element on the canvas (Select mode, click). Its source, box and matching CSS show here, and you can edit them.')); return }
      const fh = App.hostByFid(s.fid)
      const [file, line] = (s.src || ':').split(':')
      body.appendChild(h('div.block', h('header', h('h3', s.tag + (s.id ? '#' + s.id : '') + (s.cls ? '.' + s.cls.split(' ').join('.') : '')), h('span.sp'), h('span.tag' + (s.ws !== 'draft' ? '.ws' : ''), s.ws === 'draft' ? 'draft' : 'proposal')),
        h('dl.kv', h('dt', 'Source'), h('dd', s.src ? h('button.link', { on: { click: () => App.reveal(file, +line) } }, s.src) : '—'), h('dt', 'Page'), h('dd', s.route), s.text ? [h('dt', 'Text'), h('dd', '“' + s.text.slice(0, 120) + '”')] : null, h('dt', 'Selector'), h('dd.mono', s.selector)),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          h('button.btn.sm', { on: { click: () => App.askAgent('About the ' + s.tag + ' at ' + s.src + ' on ' + s.route + ': ') } }, 'Ask agent about this'),
          s.leaf ? h('span.note', 'double-click it on the canvas to edit the text') : null)))
      if (!fh) return
      let r; try { r = await fh.call('inspect', [{ src: s.src }]) } catch (e) { try { r = await fh.call('inspect', [s.selector]) } catch (e2) { body.appendChild(h('p.empty', 'The element is gone from the page (' + e2.message + ').')); return } }
      if (my !== seq) return
      const c = r.computed
      body.appendChild(h('div.block', h('header', h('h3', 'Box'), h('span.sub', r.rect.w + ' × ' + r.rect.h + ' at ' + r.rect.x + ', ' + r.rect.y)),
        h('dl.kv', ['display', 'position', 'margin', 'padding', 'gap', 'font-size', 'font-family', 'color', 'background-color'].map(p => [h('dt', p), h('dd.mono', c[p])]))))
      const rules = h('div.block', h('header', h('h3', 'Rules'), h('span.sub', 'last wins · edits write to the file')))
      for (const rule of [...r.rules].reverse()) {
        const text = App.P.read(rule.file, App.ws) || '', blk = rule.inline ? null : findRule(text, rule.selector), ln = blk ? lineOf(text, blk.selStart) : null
        const box = h('div', { style: { border: '1px solid var(--rule)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } }, h('b.mono', rule.selector), rule.media ? h('span.note', '@media ' + rule.media) : null, h('span.sp'),
            h('button.link.note', { on: { click: () => App.reveal(rule.file, ln || 1) } }, rule.file + (ln ? ':' + ln : ''))))
        for (const [p, v, imp] of rule.decls) {
          const inp = h('input.txt.mono', { value: v + (imp ? ' !important' : ''), style: { flex: 1, padding: '1px 4px', fontSize: '11.5px' }, disabled: !blk,
            on: { change: () => edit(rule, p, inp.value.trim() || null) , keydown: e => { if (e.key === 'Enter') inp.blur() } } })
          box.appendChild(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('span.mono', { style: { minWidth: '110px', color: 'var(--ink-2)', fontSize: '11.5px' } }, p), inp))
        }
        if (blk) {
          const add = h('input.txt.mono', { placeholder: '+ property: value', style: { padding: '1px 4px', fontSize: '11.5px' }, on: { keydown: e => { if (e.key !== 'Enter') return; const m = /^\s*([\w-]+)\s*:\s*(.+?);?\s*$/.exec(add.value); if (m) edit(rule, m[1], m[2]); else toast('Write it as property: value') } } })
          box.appendChild(add)
        }
        rules.appendChild(box)
      }
      if (!r.rules.length) rules.appendChild(h('p.note', 'No project CSS rules match this element.'))
      body.appendChild(rules)
    }
    function edit(rule, prop, value) {
      const P = App.P, text = P.read(rule.file, App.ws); if (text == null) return
      const next = cssSet(text, rule.selector, prop, value)
      if (next == null) return toast('Could not find "' + rule.selector + '" in ' + rule.file)
      P.write(rule.file, next, App.ws)
      setTimeout(paint, 450)
    }
    App.ev.on('sel', () => { if (Dock.visible('inspector')) paint() })
    App.ev.on('project', paint)
    return { el, show: paint }
  }
}

// ---------- layers: the DOM outline of the selected frame ----------
export const LAYERS = {
  title: 'Layers', sub: 'DOM outline',
  make() {
    const tree = h('div.layers'), head = h('div.toolbar'), el = h('div', head, tree)
    let seq = 0
    async function paint() {
      const my = ++seq; clear(head); clear(tree)
      const fh = App.sel ? App.hostByFid(App.sel.fid) : App.firstHost()
      if (!fh) { tree.appendChild(h('p.empty', 'No frame yet.')); return }
      head.append(h('span.lbl', 'Frame'), h('b', fh.route), h('span.note', fh.w + 'px' + (fh.ws !== 'draft' ? ' · proposal' : '')), h('span.sp'), h('button.btn.sm', { on: { click: paint } }, 'Refresh'))
      let nodes; try { nodes = await fh.call('outline', [500]) } catch (e) { tree.appendChild(h('p.empty', e.message)); return }
      if (my !== seq) return
      for (const n of nodes) tree.appendChild(h('button' + (App.sel && n.src && n.src === App.sel.src ? '.on' : ''), {
        style: { paddingLeft: 10 + n.d * 12 + 'px' }, title: n.src,
        on: { click: async () => { try { const info = await fh.call('select', [n.src ? { src: n.src } : n.tag]); if (info) App.select({ ...info, fid: fh.fid, route: fh.route, ws: fh.ws }) } catch (e) { toast(e.message) } } }
      }, h('span', n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '')), n.text ? h('span.note', '“' + n.text + '”') : null, h('span.sp'), h('span.src', n.src)))
    }
    const later = debounce(() => { if (Dock.visible('layers')) paint() }, 300)
    App.ev.on('sel', later); App.ev.on('frameready', later); App.ev.on('project', later)
    return { el, show: paint }
  }
}
