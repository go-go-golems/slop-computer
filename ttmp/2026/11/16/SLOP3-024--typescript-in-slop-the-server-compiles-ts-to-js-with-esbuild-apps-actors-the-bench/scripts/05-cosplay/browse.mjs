#!/usr/bin/env node
// browse.mjs — a small web server for browsing persona review rounds.
//
//   node browse.mjs <rounds dir> [--port 18600]
//
// <rounds dir> holds one directory per round (r1, r2, …), each with one
// directory per persona, as run.sh and benchdrive (BENCHDRIVE_RECORD) leave
// them:
//
//   <round>/round.json                 {model, thinking, bench, notes, started}
//   <round>/<persona>/diary.md         the persona's diary (STRUGGLE: lines, ## Verdict)
//   <round>/<persona>/session/*.jsonl  pi's session: thinking, messages, tool calls and results
//   <round>/<persona>/steps.jsonl      benchdrive's record: one line per command
//   <round>/<persona>/shots/<n>.jpg    the bench after command n
//   <round>/<persona>/*.png            screenshots the persona took itself
//
// Pages: / (rounds), /r/<round>/ (its personas), /r/<round>/<persona>
// (timeline, diary, shots). No dependencies; read-only; serves files only
// from under <rounds dir>.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const args = process.argv.slice(2)
const ROOT = path.resolve(args.find(a => !a.startsWith('--')) || '.')
const PORT = Number((args[args.indexOf('--port') + 1] || '').match(/^\d+$/) ? args[args.indexOf('--port') + 1] : 18600)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const readLines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] } }
const dirs = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() } catch { return [] } }
const files = (d, re) => { try { return fs.readdirSync(d).filter(f => re.test(f)).sort() } catch { return [] } }
const fmtT = t => (t ? new Date(t).toISOString().slice(11, 19) : '')
const SAFE = /^[A-Za-z0-9_.-]+$/

// ---- markdown: enough for the diaries (headings, lists, bold, code, quotes)
function md(text) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
  const out = []
  let list = false, code = false, buf = []
  const flush = () => { if (buf.length) { out.push('<p>' + buf.map(inline).join('<br>') + '</p>'); buf = [] } }
  for (const line of String(text).split('\n')) {
    if (/^```/.test(line)) { flush(); if (list) { out.push('</ul>'); list = false } out.push(code ? '</pre>' : '<pre>'); code = !code; continue }
    if (code) { out.push(esc(line)); continue }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (h) { flush(); if (list) { out.push('</ul>'); list = false } out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`) }
    else if (li) { flush(); if (!list) { out.push('<ul>'); list = true } out.push('<li>' + inline(li[1]) + '</li>') }
    else if (/^STRUGGLE:/.test(line.trim())) { flush(); out.push('<p class="struggle">' + inline(line.trim()) + '</p>') }
    else if (!line.trim()) { flush(); if (list) { out.push('</ul>'); list = false } }
    else { if (list) { out.push('</ul>'); list = false } buf.push(line) }
  }
  flush(); if (list) out.push('</ul>'); if (code) out.push('</pre>')
  return out.join('\n').replace(/<p>([^<]*?)STRUGGLE:/g, '<p>$1<span class="struggle">STRUGGLE:</span>')
}

// ---- a persona's material
function persona(round, name) {
  const dir = path.join(ROOT, round, name)
  const diary = (() => { try { return fs.readFileSync(path.join(dir, 'diary.md'), 'utf8') } catch { return '' } })()
  const struggles = diary.split('\n').map(l => l.match(/STRUGGLE:\s*(.*)$/)).filter(Boolean).map(m => m[1])
  const verdict = (diary.split(/^## Verdict\s*$/m)[1] || '').trim()
  const session = files(path.join(dir, 'session'), /\.jsonl$/).flatMap(f => readLines(path.join(dir, 'session', f)))
  const steps = readLines(path.join(dir, 'steps.jsonl'))
  const own = files(dir, /\.(png|jpe?g)$/i)
  const exit = (() => { try { return (fs.readFileSync(path.join(ROOT, round, 'done.log'), 'utf8').match(new RegExp('^' + name + ' exited (\\d+) at (\\S+)', 'm')) || []).slice(1) } catch { return [] } })()
  return { dir, diary, struggles, verdict, session, steps, own, exit }
}

// ---- pages
const CSS = `
:root{--bg:#fbfaf7;--ink:#1d1d1b;--mute:#6b6a64;--line:#e4e1d8;--card:#fff;--acc:#2f5d9e;--bad:#b3261e;--good:#2e7d32;--think:#f3f0e8;--code:#f4f2ec}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--ink:#e9e7e1;--mute:#9b998f;--line:#33322d;--card:#1f1e1b;--acc:#8fb2e8;--bad:#ff8a80;--good:#81c784;--think:#24231f;--code:#26251f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
header h1{font-size:18px;margin:0}main{padding:16px 20px;max-width:1500px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card h3{margin:0 0 6px;font-size:16px}.mute{color:var(--mute);font-size:13px}
.struggle{color:var(--bad)}.ok{color:var(--good)}
.tabs{display:flex;gap:6px;margin:6px 0 14px}.tabs a{padding:4px 10px;border:1px solid var(--line);border-radius:999px}.tabs a.on{background:var(--acc);color:var(--bg);border-color:var(--acc)}
.ev{border-left:3px solid var(--line);padding:6px 0 6px 12px;margin:0 0 10px}
.ev.user{border-color:var(--acc)}.ev.assistant{border-color:var(--ink)}.ev.tool{border-color:var(--mute)}.ev.err{border-color:var(--bad)}
.ev .who{font-size:12px;color:var(--mute);font-family:ui-monospace,monospace}
details.think{background:var(--think);border-radius:6px;padding:4px 8px;margin:4px 0}details.think summary{cursor:pointer;color:var(--mute);font-size:13px}
pre{background:var(--code);padding:8px 10px;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12.5px/1.45 ui-monospace,monospace;margin:4px 0;max-height:520px}
.cmd{font:13px ui-monospace,monospace;background:var(--code);padding:3px 8px;border-radius:5px;display:inline-block}
.step{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:12px;align-items:start;margin:4px 0 6px}
@media (max-width:900px){.step{grid-template-columns:1fr}}
img.shot{width:100%;border:1px solid var(--line);border-radius:6px;cursor:zoom-in}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}.gallery figure{margin:0}.gallery figcaption{font-size:12px;color:var(--mute);font-family:ui-monospace,monospace}
.diary h2{font-size:17px;margin:22px 0 4px;border-top:1px solid var(--line);padding-top:12px}.diary h3{font-size:15px}
#zoom{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:9;cursor:zoom-out}#zoom img{max-width:96vw;max-height:94vh}
`
const page = (title, crumbs, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><h1>${esc(title)}</h1><span class="mute">${crumbs}</span></header><main>${body}</main>
<div id="zoom" onclick="this.style.display='none'"><img alt=""></div>
<script>document.addEventListener('click',e=>{const i=e.target.closest('img.shot');if(!i)return;const z=document.getElementById('zoom');z.querySelector('img').src=i.src;z.style.display='flex'})</script></body></html>`

function roundsPage() {
  const rounds = dirs(ROOT).filter(r => SAFE.test(r))
  const body = rounds.map(r => {
    const meta = readJSON(path.join(ROOT, r, 'round.json')) || {}
    const ps = dirs(path.join(ROOT, r)).filter(n => SAFE.test(n)).map(n => ({ n, ...persona(r, n) }))
    return `<div class="card"><h3><a href="/r/${r}/">${esc(r)}</a></h3>
      <div class="mute">${esc([meta.model, meta.thinking && 'thinking ' + meta.thinking, meta.bench && 'bench agent ' + meta.bench, meta.started].filter(Boolean).join(' · '))}</div>
      ${meta.notes ? `<p>${esc(meta.notes)}</p>` : ''}
      <ul>${ps.map(p => `<li><a href="/r/${r}/${p.n}">${esc(p.n)}</a> <span class="mute">${p.steps.length || p.session.filter(e => e.message && e.message.role === 'toolResult').length} commands · </span><span class="struggle">${p.struggles.length} struggles</span></li>`).join('')}</ul></div>`
  }).join('')
  return page('Persona reviews of the bench', esc(ROOT), `<div class="cards">${body || '<p>No rounds yet.</p>'}</div>`)
}

function roundPage(r) {
  const meta = readJSON(path.join(ROOT, r, 'round.json')) || {}
  const ps = dirs(path.join(ROOT, r)).filter(n => SAFE.test(n)).map(n => ({ n, ...persona(r, n) }))
  const body = `<p class="mute">${esc(JSON.stringify(meta))}</p><div class="cards">${ps.map(p => {
    const last = [...p.steps].reverse().find(s => s.shot)
    return `<div class="card"><h3><a href="/r/${r}/${p.n}">${esc(p.n)}</a> <span class="mute">${p.exit.length ? 'exited ' + esc(p.exit[0]) + ' at ' + esc(p.exit[1]) : 'running or not started'}</span></h3>
      ${last ? `<a href="/r/${r}/${p.n}?tab=shots"><img class="shot" src="/f/${r}/${p.n}/${last.shot}" alt="the bench after the last command"></a>` : ''}
      ${p.verdict ? `<details open><summary><b>Verdict</b></summary><div class="diary">${md(p.verdict)}</div></details>` : ''}
      <details><summary class="struggle">${p.struggles.length} struggles</summary><ul>${p.struggles.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details></div>`
  }).join('')}</div>`
  return page('Round ' + r, `<a href="/">all rounds</a>`, body)
}

function personaPage(r, n, tab) {
  const p = persona(r, n)
  const base = `/r/${r}/${n}`
  const tabs = ['timeline', 'diary', 'shots'].map(t => `<a class="${t === tab ? 'on' : ''}" href="${base}?tab=${t}">${t}</a>`).join('')
  let body = ''
  if (tab === 'diary') body = `<div class="diary">${md(p.diary) || '<p class="mute">No diary.</p>'}</div>`
  else if (tab === 'shots') {
    const shots = p.steps.filter(s => s.shot).map(s => ({ src: s.shot, cap: '#' + s.n + ' ' + fmtT(s.t) + ' ' + s.cmd + ' ' + (s.args || []).join(' ').slice(0, 80) }))
      .concat(p.own.map(f => ({ src: f, cap: 'taken by the persona: ' + f })))
    body = `<div class="gallery">${shots.map(s => `<figure><img class="shot" loading="lazy" src="/f/${r}/${n}/${esc(s.src)}" alt=""><figcaption>${esc(s.cap)}</figcaption></figure>`).join('') || '<p class="mute">No screenshots.</p>'}</div>`
  } else body = timeline(p, r, n)
  return page(n + ' · ' + r, `<a href="/">all rounds</a> / <a href="/r/${r}/">${esc(r)}</a> · ${p.struggles.length} struggles`, `<div class="tabs">${tabs}</div>${body}`)
}

// The pi session, with each benchdrive command's recorded step (and its
// screenshot) after the tool result it belongs to (the first step at or
// after the call, before the result).
function timeline(p, r, n) {
  const steps = [...p.steps]
  const out = []
  const calls = new Map()
  for (const e of p.session) {
    if (e.type === 'model_change') { out.push(`<div class="mute">model ${esc(e.provider + '/' + e.modelId)}</div>`); continue }
    if (e.type === 'thinking_level_change') { out.push(`<div class="mute">thinking ${esc(e.thinkingLevel)}</div>`); continue }
    const m = e.message
    if (!m) continue
    const t = fmtT(e.timestamp)
    if (m.role === 'system') continue
    const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }]
    if (m.role === 'user') { out.push(`<div class="ev user"><div class="who">${t} the runner</div>${md(parts.map(c => c.text || '').join('\n'))}</div>`); continue }
    if (m.role === 'assistant') {
      const html = parts.map(c => {
        if (c.type === 'thinking') return `<details class="think"><summary>thinking</summary><pre>${esc(c.thinking)}</pre></details>`
        if (c.type === 'text') return c.text.trim() ? `<div>${md(c.text)}</div>` : ''
        if (c.type === 'toolCall') {
          const a = typeof c.arguments === 'string' ? (() => { try { return JSON.parse(c.arguments) } catch { return { raw: c.arguments } } })() : (c.arguments || {})
          calls.set(c.id, { name: c.name, a, t: e.timestamp })
          if (c.name === 'bash') return `<div><span class="cmd">$ ${esc(a.command)}</span></div>`
          if (c.name === 'write' || c.name === 'edit') return `<div class="mute">${esc(c.name)} ${esc(a.path || '')}${/diary\.md$/.test(a.path || '') ? ' (the diary)' : ''}</div>`
          return `<div><span class="cmd">${esc(c.name)} ${esc(JSON.stringify(a).slice(0, 200))}</span></div>`
        }
        return ''
      }).join('')
      if (html.trim()) out.push(`<div class="ev assistant"><div class="who">${t} ${esc(m.model || 'persona')}</div>${html}</div>`)
      continue
    }
    if (m.role === 'toolResult') {
      const call = calls.get(m.toolCallId) || {}
      const text = parts.map(c => c.text || '').join('\n')
      const isBench = call.name === 'bash' && /\bbenchdrive\b/.test((call.a || {}).command || '')
      const end = Date.parse(e.timestamp), start = Date.parse(call.t || e.timestamp)
      const mine = []
      while (steps.length && Date.parse(steps[0].t) <= end + 2000 && Date.parse(steps[0].t) >= start - 2000) mine.push(steps.shift())
      if (call.name === 'write' || call.name === 'edit') { if (m.isError) out.push(`<div class="ev err"><pre>${esc(text)}</pre></div>`); continue }
      const shots = mine.filter(s => s.shot).map(s => `<img class="shot" loading="lazy" src="/f/${r}/${n}/${esc(s.shot)}" alt="the bench after ${esc(s.cmd)}">`).join('')
      const res = `<details ${text.length < 1500 || isBench ? 'open' : ''}><summary class="mute">${t} result${m.isError ? ' (error)' : ''} · ${text.length} chars</summary><pre>${esc(text)}</pre></details>`
      out.push(`<div class="ev tool ${m.isError ? 'err' : ''}">${shots ? `<div class="step"><div>${res}</div><div>${shots}</div></div>` : res}</div>`)
    }
  }
  for (const s of steps) out.push(`<div class="ev tool"><div class="who">${fmtT(s.t)} step ${s.n} (not matched to a call)</div><span class="cmd">${esc(s.cmd + ' ' + (s.args || []).join(' '))}</span><pre>${esc(s.out)}</pre>${s.shot ? `<img class="shot" loading="lazy" src="/f/${r}/${n}/${esc(s.shot)}" alt="">` : ''}</div>`)
  return out.join('\n') || '<p class="mute">No session.</p>'
}

// ---- the server
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8', '.json': 'application/json' }
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, body, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'content-type': type }); res.end(body) }
  try {
    const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (!seg.length) return send(200, roundsPage())
    if (seg[0] === 'r' && seg.length === 2 && SAFE.test(seg[1])) return send(200, roundPage(seg[1]))
    if (seg[0] === 'r' && seg.length === 3 && SAFE.test(seg[1]) && SAFE.test(seg[2])) return send(200, personaPage(seg[1], seg[2], u.searchParams.get('tab') || 'timeline'))
    if (seg[0] === 'f' && seg.length >= 3 && seg.slice(1).every(s => SAFE.test(s))) {
      const f = path.join(ROOT, ...seg.slice(1))
      if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(404, 'not found', 'text/plain')
      res.writeHead(200, { 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'max-age=60' })
      return fs.createReadStream(f).pipe(res)
    }
    send(404, 'not found', 'text/plain')
  } catch (e) { send(500, esc(e && e.stack || e), 'text/plain') }
}).listen(PORT, '127.0.0.1', () => console.log(`browse: http://127.0.0.1:${PORT}/  (rounds in ${ROOT})`))
