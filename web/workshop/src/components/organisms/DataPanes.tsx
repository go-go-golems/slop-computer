import { useEffect, useMemo, useState } from 'react'
import { errorText, useFileQuery, usePushMutation, useRecordsQuery, useRoutesQuery, useThreadsQuery } from '../../api/slopApi'
import type { Artifact, Rec, Version } from '../../api/types'
import { boot } from '../../app/boot'
import { toast } from '../../app/store'
import { cx, plural } from '../../app/format'
import { useReaders } from '../../app/hooks'
import { Button, Count, Empty } from '../atoms'
import { PreviewStage, type Device } from './PreviewStage'
import { recWord } from './WatchRight'

// keepTree is a version's tree as path → sha256, without the manifest.
const keepTree = (v: Version, drop?: string) =>
  Object.fromEntries(Object.entries(v.files).filter(([p]) => p !== drop && p !== 'slop.json').map(([p, f]) => [p, f.sha256]))

const mainMoved = (e: unknown) => (e as { data?: { error?: { code?: string } } })?.data?.error?.code === 'main_moved'

interface RecordsProps {
  a: Artifact
  v: Version
  rec: string | null
  device: Device
  onRec: (id: string | null) => void
  onSaved: (n: number) => void
  onOpenSite: (host: string, path: string) => void
}

// RecordsPane lists a data artifact's records, edits one, and shows the
// selected record through the artifact's viewer page.
export function RecordsPane(p: RecordsProps) {
  const { a, v } = p
  const { data: recs = [] } = useRecordsQuery({ id: a.id, n: v.n })
  const { data: threads = [] } = useThreadsQuery({ artifact: a.id })
  const [editing, setEditing] = useState<{ id?: string; isNew?: boolean } | null>(null)
  const sorted = useMemo(() => recs.slice().sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? '')) || String(x.title ?? x.id).localeCompare(String(y.title ?? y.id))), [recs])
  const selected = p.rec && sorted.some(r => r.id === p.rec) ? p.rec : sorted[0]?.id ?? null
  useEffect(() => { if (selected !== p.rec) p.onRec(selected) }, [selected]) // keep the selection valid
  useEffect(() => setEditing(null), [a.id, v.n])
  const open = threads.filter(t => !t.resolved && t.anchor?.record)
  const cols: [string, string][] = a.type === 'post' ? [['title', 'Title'], ['date', 'Date'], ['tags', 'Tags']] : [['no', 'No'], ['title', 'Title'], ['kind', 'Kind'], ['date', 'Date']]
  const cell = (r: Rec, k: string) => {
    const x = r[k]
    if (Array.isArray(x)) return x.join(', ')
    if (k === 'no' && x != null) return String(x).padStart(3, '0')
    return x == null ? '' : String(x)
  }
  return (
    <div className="dsplit">
      <div className="dlist">
        {editing ? <RecordForm a={a} v={v} recs={sorted} editing={editing} onDone={(n, id) => { setEditing(null); if (n) { p.onRec(id ?? null); p.onSaved(n) } }} /> : <>
          <div className="pane-head">
            <h2>{plural(sorted.length, recWord(a))}</h2><span className="note">{`v${v.n}`}</span><span className="sp" />
            <Button small onClick={() => setEditing({ isNew: true })}>{a.type === 'post' ? 'New post' : 'New record'}</Button>
            {selected ? <Button small onClick={() => setEditing({ id: selected })}>Edit</Button> : null}
          </div>
          <div className="scroll">
            <table className="rt">
              <thead><tr>{cols.map(([, l]) => <th key={l}>{l}</th>)}<th /></tr></thead>
              <tbody>
                {sorted.map(r => {
                  const n = open.filter(t => t.anchor!.record === r.path).length
                  return (
                    <tr key={r.path} className={cx('click', r.id === selected && 'on')} onClick={() => p.onRec(r.id)}>
                      {cols.map(([k]) => <td key={k} className={k === 'title' ? '' : 'dim'}>{cell(r, k)}</td>)}
                      <td>{n ? <Count n={n} bad /> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>}
      </div>
      <div className="dright"><ViewerPreview a={a} rec={selected} device={p.device} onOpenSite={p.onOpenSite} /></div>
    </div>
  )
}

// ViewerPreview shows a record through the page that displays one record
// (the artifact's viewer), at the path its route gives that record.
function ViewerPreview({ a, rec, device, onOpenSite }: { a: Artifact; rec: string | null; device: Device; onOpenSite: (host: string, path: string) => void }) {
  const { data: routes = [] } = useRoutesQuery()
  const viewer = a.viewer
  const r = routes.find(x => x.page === viewer && /:\w+/.test(x.path))
  if (!viewer || !rec) return <Empty>{viewer ? `Select a ${recWord(a)}.` : `No viewer page is set for ${a.id}.`}</Empty>
  if (!r) return <Empty>{`${viewer} is not routed at a path with a :param yet.`}</Empty>
  const path = r.path.replace(/:(\w+)/g, () => rec)
  return <>
    <div className="pane-head"><h2>{`Through ${viewer}`}</h2><span className="note">{r.host + path}</span><span className="sp" /><Button small onClick={() => onOpenSite(r.host, path)}>Open in Site</Button></div>
    <PreviewStage artifact={viewer} n={r.n} host={r.host} path={path} device={device} />
    <p className="empty" style={{ flex: 'none' }}>{`Shows what the route serves: ${a.id} at the version the route reads.`}</p>
  </>
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function RecordForm({ a, v, recs, editing, onDone }: { a: Artifact; v: Version; recs: Rec[]; editing: { id?: string; isNew?: boolean }; onDone: (n?: number, id?: string) => void }) {
  const r = editing.isNew ? undefined : recs.find(x => x.id === editing.id)
  const [push, { isLoading }] = usePushMutation()
  const me = boot().me.user.name
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    title: r?.title ?? '', date: String(r?.date ?? today), tags: (r?.tags ?? []).join(', '), summary: String(r?.summary ?? ''),
    body: r?.body?.trim() ?? 'Write the post in Markdown.',
    id: r?.id ?? 'new-record',
    json: r ? JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['id', 'path', 'html', 'body'].includes(k))), null, 2)
      : JSON.stringify({ no: recs.length + 1, title: 'New experiment', kind: 'Toy', date: today, tags: ['toy'], summary: 'One sentence about it.', by: me }, null, 2),
  })
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    let path: string, text: string, message: string, id: string
    if (a.type === 'post') {
      if (!f.title.trim()) return setErr('A post needs a title.')
      id = r?.id ?? (slugify(f.title) || 'post')
      path = r?.path ?? `posts/${id}.md`
      const tags = f.tags.split(',').map(s => s.trim()).filter(Boolean)
      text = `---\ntitle: ${f.title.trim()}\ndate: ${f.date}\ntags: [${tags.join(', ')}]\nauthor: ${String(r?.author ?? me)}\nsummary: ${f.summary.trim()}\n---\n${f.body.trim()}\n`
      message = r ? `Edit “${f.title.trim()}”` : `New post: “${f.title.trim()}”`
    } else {
      let obj: unknown
      try { obj = JSON.parse(f.json) } catch (x) { return setErr('That is not valid JSON: ' + (x as Error).message) }
      id = slugify(f.id)
      if (!id) return setErr('Give the record a file name.')
      const dir = (Object.keys(v.files).find(p => p.includes('/')) ?? 'records/x').split('/')[0]
      path = r?.path ?? `${dir}/${id}.json`
      text = JSON.stringify(obj, null, 2) + '\n'
      message = r ? `Edit ${id}` : `New record: ${id}`
    }
    if (!r && v.files[path]) return setErr(`${path} exists already.`)
    try {
      const out = await push({ id: a.id, files: { [path]: text }, keep: keepTree(v, path), manifest: v.manifest, base: v.n, message }).unwrap()
      toast(`${a.id} v${out.version.n}: ${r ? 'updated' : 'added'}. Routes that follow main show it now.`)
      onDone(out.version.n, id)
    } catch (e) {
      setErr(mainMoved(e) ? `${a.id} has a newer version than v${v.n}. Open the newest version and edit there.` : errorText(e))
    }
  }
  return (
    <div className="scroll">
      <div className="pane-head"><h2>{editing.isNew ? (a.type === 'post' ? 'New post' : 'New record') : 'Edit ' + (r?.id ?? '')}</h2></div>
      <form className="form" onSubmit={e => { e.preventDefault(); void save() }}>
        {a.type === 'post' ? <>
          <label>Title<input className="inp" value={f.title} onChange={set('title')} required /></label>
          <label>Date<input className="inp" type="date" value={f.date} onChange={set('date')} /></label>
          <label>Tags, comma separated<input className="inp" value={f.tags} onChange={set('tags')} /></label>
          <label>Summary<input className="inp" value={f.summary} onChange={set('summary')} /></label>
          <label>Body · Markdown<textarea className="inp body" value={f.body} onChange={set('body')} /></label>
        </> : <>
          <label>File name<input className="inp" value={f.id} onChange={set('id')} disabled={!!r} /></label>
          <label>Record · JSON<textarea className="inp body" value={f.json} onChange={set('json')} aria-label="Record as JSON" /></label>
        </>}
        {err ? <span className="muted" style={{ color: 'var(--accent)' }}>{err}</span> : null}
        <div className="row">
          <Button variant="primary" type="submit" disabled={isLoading}>{`Save as v${a.latest + 1}`}</Button>
          <Button onClick={() => onDone()}>Cancel</Button>
        </div>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Saving makes a new version of the whole collection. Only this file changes; the others are shared.</span>
      </form>
    </div>
  )
}

interface DesignTokens { colors: Record<string, string>; [k: string]: unknown }

// TokensEditor edits tokens.json's colours and shows a page that reads them.
export function TokensEditor({ a, v, device, onSaved }: { a: Artifact; v: Version; device: Device; onSaved: (n: number) => void }) {
  const { data: raw } = useFileQuery({ id: a.id, n: v.n, path: 'tokens.json' }, { skip: !v.files['tokens.json'] })
  const saved = useMemo<DesignTokens>(() => { try { return { colors: {}, ...JSON.parse(raw ?? '{}') } } catch { return { colors: {} } } }, [raw])
  const [draft, setDraft] = useState<DesignTokens | null>(null)
  useEffect(() => setDraft(null), [a.id, v.n])
  const [push, { isLoading }] = usePushMutation()
  const readers = useReaders(a.id)
  const t = draft ?? saved
  const changed = draft != null && JSON.stringify(draft) !== JSON.stringify(saved)
  const setColor = (k: string, val: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(val)) return
    setDraft({ ...t, colors: { ...t.colors, [k]: val } })
  }
  const save = async () => {
    const message = 'Colours: ' + Object.keys(t.colors).filter(k => t.colors[k] !== saved.colors[k]).map(k => `${k} ${t.colors[k]}`).join(', ')
    try {
      const out = await push({ id: a.id, files: { 'tokens.json': JSON.stringify(t, null, 2) + '\n' }, keep: keepTree(v, 'tokens.json'), manifest: v.manifest, base: v.n, message }).unwrap()
      toast(`${a.id} v${out.version.n}: every page that reads the tokens has the new colours.`)
      setDraft(null)
      onSaved(out.version.n)
    } catch (e) {
      toast(mainMoved(e) ? `${a.id} has a newer version than v${v.n}.` : errorText(e), true)
    }
  }
  const page = readers.find(r => !/[:*]/.test(r.path)) ?? readers[0]
  return (
    <div className="dsplit">
      <div className="dlist">
        <div className="pane-head">
          <h2>Colours</h2><span className="note">{`tokens.json · v${v.n}`}</span><span className="sp" />
          {changed ? <Button small variant="primary" disabled={isLoading} onClick={save}>Save as new version</Button> : null}
          {changed ? <Button small onClick={() => setDraft(null)}>Discard</Button> : null}
        </div>
        <div className="scroll">
          <div className="swatches">
            {Object.entries(t.colors).map(([k, val]) => (
              <div className="swatch" key={k}>
                <input type="color" value={val} aria-label={k} onChange={e => setColor(k, e.target.value)} />
                <b>{'--' + k}</b>
                <input type="text" defaultValue={val} key={val} aria-label={k + ' hex'} onBlur={e => setColor(k, e.target.value.trim())} />
              </div>
            ))}
          </div>
          <p className="empty">{changed ? 'Not saved. Save to see the colours on the page.' : `Pick a colour, then save: that makes a new version of ${a.id}.`}</p>
        </div>
      </div>
      <div className="dright">
        {page ? <>
          <div className="pane-head"><h2>{`Through ${page.page}`}</h2><span className="note">{page.host + page.path}</span></div>
          <PreviewStage artifact={page.page} n={page.n} host={page.host} path={page.path.includes(':') ? undefined : page.path} device={device} />
        </> : <Empty>No page reads these tokens yet.</Empty>}
      </div>
    </div>
  )
}
