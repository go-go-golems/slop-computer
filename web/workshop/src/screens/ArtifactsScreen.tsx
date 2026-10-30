import { useMemo, useState } from 'react'
import { errorText, useAppsQuery, useArtifactsQuery, useCreateArtifactMutation, useProjectsQuery, usePushMutation, useRecordsQuery, useThreadsQuery, useVersionsQuery } from '../api/slopApi'
import type { Artifact, Version } from '../api/types'
import { ago, isAgent, plural } from '../app/format'
import { useReaders, useRoutesUsing, useVersionBy } from '../app/hooks'
import { navigate, runPath, watchPath } from '../app/router'
import { toast } from '../app/store'
import { Button, Count, IconButton, Seg, Select, Tag } from '../components/atoms'
import { Thumb } from '../components/organisms/PreviewStage'
import { usePreviewContext } from '../components/organisms/WatchRight'

type Kind = 'all' | 'page' | 'data'

// ArtifactsScreen is every artifact by project (prototype app.js renderArtifacts).
export function ArtifactsScreen() {
  const { data: arts = [] } = useArtifactsQuery()
  const { data: projects = [] } = useProjectsQuery()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [pushing, setPushing] = useState(false)
  const [creating, setCreating] = useState(false)
  const groups = useMemo(() => {
    const ids = [...projects.map(p => p.id), null]
    return ids.map(id => ({
      id,
      project: projects.find(p => p.id === id),
      items: arts.filter(a => a.project === id && (kind === 'all' || a.kind === kind) && (!q.trim() || (a.id + ' ' + a.title).toLowerCase().includes(q.trim().toLowerCase()))),
    })).filter(g => g.items.length)
  }, [arts, projects, q, kind])
  return (
    <div className="split">
      <section className="tile main">
        <div className="toolbar">
          <input className="filter" type="search" placeholder="Find an artifact" aria-label="Find an artifact" value={q} onChange={e => setQ(e.target.value)} />
          <Seg label="Kind" value={kind} onChange={setKind} options={[['all', 'All'], ['page', 'Pages'], ['data', 'Data']]} />
          <span className="sp" />
          <Button onClick={() => setCreating(true)}>New with an app…</Button>
          <Button variant="primary" onClick={() => setPushing(true)}>Push a file…</Button>
        </div>
        <div className="tilebody"><div className="scroll" id="agrid">
          <div className="agrid">
            {groups.map(g => [
              <div key={'h' + g.id} className="grp-h"><b>{g.project?.name ?? 'No project'}</b><span>{plural(g.items.length, 'artifact') + (g.project?.brief ? ' · ' + g.project.brief : '')}</span></div>,
              ...g.items.map(a => <ArtifactCard key={a.id} a={a} />),
            ])}
          </div>
        </div></div>
      </section>
      {pushing ? <PushDialog onClose={() => setPushing(false)} /> : null}
      {creating ? <NewTargetDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}

function ArtifactCard({ a }: { a: Artifact }) {
  const using = useRoutesUsing(a.id)
  const readers = useReaders(a.id)
  const { data: threads = [] } = useThreadsQuery() // one request for all cards
  const routes = a.kind === 'data' ? readers : using
  const open = threads.filter(t => t.artifact === a.id && !t.resolved).length
  return (
    <button type="button" className="acard" onClick={() => navigate(watchPath(a.id))}>
      <div className="shot">{a.kind === 'data' ? <DataShot a={a} /> : a.main ? <PageShot a={a} /> : null}</div>
      <div className="ab">
        <div className="t"><b>{a.id}</b><Tag>{a.kind === 'data' ? a.type || 'data' : 'page'}</Tag>{open ? <Count n={open} bad title="open threads" /> : null}</div>
        <LatestLine a={a} />
        <span className="tags">{routes.length ? routes.slice(0, 3).map(r => <Tag key={r.host + r.path}>{r.path}</Tag>) : <Tag tone="red">{a.kind === 'data' ? 'read by no route' : 'not routed'}</Tag>}</span>
      </div>
    </button>
  )
}

function PageShot({ a }: { a: Artifact }) {
  const ctx = usePreviewContext(useRoutesUsing(a.id), null)
  return <Thumb artifact={a.id} n={a.main} host={ctx.host} path={ctx.path} />
}

function LatestLine({ a }: { a: Artifact }) {
  const { data: versions = [] } = useVersionsQuery(a.id)
  const by = useVersionBy()
  const v: Version | undefined = versions[versions.length - 1]
  if (!v) return <small>{`v${a.latest}`}</small>
  return <><small>{`v${v.n} · ${ago(v.at)}${isAgent(v.via) ? ' · ' + by(v) : ''}`}</small><small>{v.message}</small></>
}

function DataShot({ a }: { a: Artifact }) {
  const { data: recs = [] } = useRecordsQuery({ id: a.id, n: a.main }, { skip: !a.main || a.type === 'tokens' })
  return (
    <div className="dsum">
      <b>{a.type === 'tokens' ? 'tokens.json' : plural(recs.length, a.type === 'post' ? 'post' : 'record')}</b>
      {recs.slice().sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? ''))).slice(0, 5).map(r => <span key={r.path}>{(r.date ? r.date + '  ' : '') + (r.title ?? r.id)}</span>)}
    </div>
  )
}

// PushDialog pushes files picked or pasted in the browser as a new version
// (or a new artifact). Files not chosen are kept from the current version.
function PushDialog({ onClose }: { onClose: () => void }) {
  const { data: arts = [] } = useArtifactsQuery()
  const { data: projects = [] } = useProjectsQuery()
  const [target, setTarget] = useState(arts[0]?.id ?? '__new')
  const [newId, setNewId] = useState('')
  const [kind, setKind] = useState('page')
  const [project, setProject] = useState(projects[0]?.id ?? '')
  const [files, setFiles] = useState<FileList | null>(null)
  const [paste, setPaste] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const isNew = target === '__new'
  const a = arts.find(x => x.id === target)
  const { data: versions = [] } = useVersionsQuery(target, { skip: isNew })
  const [push, { isLoading }] = usePushMutation()
  const isPage = isNew ? kind === 'page' : a?.kind === 'page'
  const id = isNew ? newId.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') : target

  const doPush = async () => {
    setErr('')
    if (!id) return setErr('Give the new artifact a name.')
    if (isNew && arts.some(x => x.id === id)) return setErr(`${id} exists already. Pick it in the list to push a new version.`)
    const out: Record<string, string> = {}
    const list = Array.from(files ?? [])
    const dir = kind === 'post' ? 'posts/' : kind === 'records' ? 'records/' : ''
    const htmlCount = list.filter(f => /\.html?$/i.test(f.name)).length
    for (const f of list) {
      let name = f.name
      if (isPage && /\.html?$/i.test(name) && htmlCount === 1) name = 'index.html'
      out[(isNew && !isPage ? dir : '') + name] = await f.text()
    }
    if (paste.trim() && isPage) out['index.html'] = paste
    if (!Object.keys(out).length) return setErr('Choose a file, or paste a page.')
    if (isPage && isNew && !out['index.html']) return setErr('A new page needs an index.html.')
    const base = versions[versions.length - 1]
    const keep = base ? Object.fromEntries(Object.entries(base.files).filter(([p]) => !out[p]).map(([p, f]) => [p, f.sha256])) : {}
    const message = msg.trim() || (isNew ? 'First version' : Object.keys(out).join(', '))
    try {
      const res = await push({
        id, files: out, keep, message, base: a?.main || undefined, manifest: base?.manifest,
        create: isNew ? { title: id, kind: isPage ? 'page' : 'data', type: isPage ? undefined : kind, project: project || null } : undefined,
      }).unwrap()
      toast(res.unchanged ? `${id}: nothing changed.` : `Pushed ${id} v${res.version.n}.`)
      onClose()
      navigate(watchPath(id))
    } catch (e) { setErr(errorText(e)) }
  }

  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-label="Push a version">
        <header><h2>Push a version</h2><IconButton aria-label="Close" onClick={onClose}>×</IconButton></header>
        <div className="form">
          <div className="kv"><span>Artifact</span>
            <Select id="pushTarget" aria-label="Artifact" value={target} onChange={setTarget}
              options={[...arts.map(x => ({ value: x.id, label: `${x.id} · ${x.kind === 'data' ? x.type || 'data' : 'page'} · v${x.main}` })), { value: '__new', label: 'A new artifact…' }]} />
          </div>
          {isNew ? (
            <div className="kv">
              <span>Name</span><input className="inp" id="pushNew" placeholder="name, e.g. colophon" value={newId} onChange={e => setNewId(e.target.value)} />
              <span>Kind</span><Select id="pushKind" aria-label="Kind" value={kind} onChange={setKind} options={[{ value: 'page', label: 'Page: HTML, CSS, JS' }, { value: 'post', label: 'Data: Markdown posts' }, { value: 'records', label: 'Data: JSON records' }]} />
              <span>Project</span><Select id="pushProj" aria-label="Project" value={project} onChange={setProject} options={[...projects.map(p => ({ value: p.id, label: p.name })), { value: '', label: 'No project' }]} />
            </div>
          ) : null}
          <label>Files: .html .css .js for a page, .md or .json for data<input type="file" id="pushFiles" multiple accept=".html,.htm,.css,.js,.md,.json,.csv,.txt,.svg" onChange={e => setFiles(e.target.files)} /></label>
          {isPage ? <textarea className="inp" id="pushPaste" rows={6} placeholder="Or paste a whole HTML page here" style={{ font: '400 11px/1.5 var(--code)' }} value={paste} onChange={e => setPaste(e.target.value)} /> : null}
          <label>Message<input className="inp" id="pushMsg" placeholder="What changed" value={msg} onChange={e => setMsg(e.target.value)} /></label>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>From a terminal this is</span>
          <code style={{ wordBreak: 'break-all' }}>{`slop push ./${id || 'folder'} -a ${id || 'name'} -m "${msg || '…'}"`}</code>
          <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}>{err}</span>
        </div>
        <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading} onClick={doPush}>Push</Button></footer>
      </div>
    </div>
  )
}

// NewTargetDialog creates a data artifact that an app runs: a Blocks
// workspace, a Pinup design. Its state lives in its own db; the app's
// version and rules come from the app.
function NewTargetDialog({ onClose }: { onClose: () => void }) {
  const { data: apps = [] } = useAppsQuery()
  const { data: projects = [] } = useProjectsQuery()
  const [app, setApp] = useState(apps[0]?.artifact ?? '')
  const [name, setName] = useState('')
  const [project, setProject] = useState(projects[0]?.id ?? '')
  const [err, setErr] = useState('')
  const [create, { isLoading }] = useCreateArtifactMutation()
  const id = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
  const go = async () => {
    setErr('')
    if (!app) return setErr('Pick an app.')
    if (!id) return setErr('Give it a name.')
    try {
      await create({ id, title: name.trim() || id, kind: 'data', app, project: project || null }).unwrap()
      toast(`${id} runs ${app}.`)
      onClose()
      navigate(runPath(id))
    } catch (e) { setErr(errorText(e)) }
  }
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-label="New with an app">
        <header><h2>New with an app</h2><IconButton aria-label="Close" onClick={onClose}>×</IconButton></header>
        <div className="form">
          <div className="kv">
            <span>App</span><Select id="newApp" aria-label="App" value={app} onChange={setApp} options={apps.map(a => ({ value: a.artifact, label: `${a.title} · ${a.artifact} v${a.main}` }))} />
            <span>Name</span><input className="inp" id="newName" placeholder="e.g. ws-team" value={name} onChange={e => setName(e.target.value)} />
            <span>Project</span><Select id="newProj" aria-label="Project" value={project} onChange={setProject} options={[...projects.map(p => ({ value: p.id, label: p.name })), { value: '', label: 'No project' }]} />
          </div>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>A data artifact with its own documents, room and assets, opened with the app at /run/{id || 'name'}.</span>
          <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}>{err}</span>
        </div>
        <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading || !apps.length} onClick={go}>Create</Button></footer>
      </div>
    </div>
  )
}
