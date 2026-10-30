import { useState } from 'react'
import { errorText, useArtifactsQuery, useProjectsQuery, usePutProjectMutation, useUpdateArtifactMutation } from '../../api/slopApi'
import type { Artifact, Project } from '../../api/types'
import { toast, useAppDispatch, useAppSelector } from '../../app/store'
import { projectPicked } from '../../app/ui'
import { Button, IconButton, Select } from '../atoms'

// useProjectScope is the project the artifact lists show, shared by the
// artifact menu and the Artifacts screen and kept per browser: null is
// every project, '' the artifacts in none.
export function useProjectScope(): [string | null, (p: string | null) => void] {
  const scope = useAppSelector(s => s.ui.project)
  const dispatch = useAppDispatch()
  return [scope, p => dispatch(projectPicked(p))]
}

export const inScope = (a: Artifact, scope: string | null) => scope == null || (a.project ?? '') === scope

const ALL = '*' // not a valid project id, so it cannot collide with one

// ProjectPicker chooses the project scope; each option counts its artifacts.
export function ProjectPicker({ id }: { id: string }) {
  const [scope, setScope] = useProjectScope()
  const { data: projects = [] } = useProjectsQuery()
  const { data: arts = [] } = useArtifactsQuery()
  const n = (p: string) => arts.filter(a => (a.project ?? '') === p).length
  return (
    <Select id={id} aria-label="Project" value={scope ?? ALL} onChange={v => setScope(v === ALL ? null : v)}
      options={[
        { value: ALL, label: `All projects · ${arts.length}` },
        ...projects.map(p => ({ value: p.id, label: `${p.name} · ${n(p.id)}` })),
        { value: '', label: `No project · ${n('')}` },
      ]} />
  )
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// ProjectDialog creates a project, or renames one and edits its brief. A new
// project becomes the scope, so the lists show where its artifacts will go.
export function ProjectDialog({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved?: (p: Project) => void }) {
  const { data: projects = [] } = useProjectsQuery()
  const [, setScope] = useProjectScope()
  const [name, setName] = useState(project?.name ?? '')
  const [id, setId] = useState<string | null>(project?.id ?? null) // null: follows the name
  const [brief, setBrief] = useState(project?.brief ?? '')
  const [err, setErr] = useState('')
  const [put, { isLoading }] = usePutProjectMutation()
  const pid = id ?? slug(name)
  const save = async () => {
    setErr('')
    if (!name.trim()) return setErr('Give the project a name.')
    if (!pid) return setErr('Give the project an id: lowercase letters, digits and -.')
    if (!project && projects.some(p => p.id === pid)) return setErr(`There is a project ${pid} already.`)
    try {
      const p = await put({ id: pid, name: name.trim(), brief: brief.trim() }).unwrap()
      toast(project ? `${p.name}: saved.` : `Project ${p.name} created.`)
      if (!project && !onSaved) setScope(p.id)
      onSaved?.(p)
      onClose()
    } catch (e) { setErr(errorText(e)) }
  }
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-label={project ? 'Edit project' : 'New project'}>
        <header><h2>{project ? `Project ${project.id}` : 'New project'}</h2><IconButton aria-label="Close" onClick={onClose}>×</IconButton></header>
        <form className="form" onSubmit={e => { e.preventDefault(); void save() }}>
          <div className="kv">
            <span>Name</span><input className="inp" id="projName" placeholder="e.g. The lab" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <span>Id</span><input className="inp" id="projId" value={pid} disabled={!!project} onChange={e => setId(slug(e.target.value))} />
          </div>
          <label>Brief: what every agent working on this project reads<textarea className="inp" id="projBrief" rows={4} value={brief} onChange={e => setBrief(e.target.value)} /></label>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>From a terminal this is</span>
          <code style={{ wordBreak: 'break-all' }}>{`slop projects put ${pid || 'id'} --name "${name.trim() || '…'}"`}</code>
          <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}>{err}</span>
          <button type="submit" hidden />
        </form>
        <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading} onClick={save}>{project ? 'Save' : 'Create'}</Button></footer>
      </div>
    </div>
  )
}

const NEW = '*new'

// ArtifactDialog changes an artifact's title, its project and, for data,
// the page that shows one record (its viewer). Versions are not touched.
export function ArtifactDialog({ a, onClose }: { a: Artifact; onClose: () => void }) {
  const { data: projects = [] } = useProjectsQuery()
  const { data: arts = [] } = useArtifactsQuery()
  const [title, setTitle] = useState(a.title)
  const [project, setProject] = useState(a.project ?? '')
  const [viewer, setViewer] = useState(a.viewer ?? '')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [update, { isLoading }] = useUpdateArtifactMutation()
  const pages = arts.filter(x => x.kind === 'page')
  const save = async () => {
    setErr('')
    if (!title.trim()) return setErr('Give it a title.')
    const patch: { title?: string; project?: string | null; viewer?: string } = {}
    if (title.trim() !== a.title) patch.title = title.trim()
    if (project !== (a.project ?? '')) patch.project = project || null
    if (a.kind === 'data' && viewer !== (a.viewer ?? '')) patch.viewer = viewer
    if (!Object.keys(patch).length) return onClose()
    try {
      await update({ id: a.id, ...patch }).unwrap()
      const to = projects.find(p => p.id === project)?.name ?? 'no project'
      toast('project' in patch ? `${a.id} moved to ${to}.` : `${a.id}: saved.`)
      onClose()
    } catch (e) { setErr(errorText(e)) }
  }
  if (creating) return <ProjectDialog onClose={() => setCreating(false)} onSaved={p => setProject(p.id)} />
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-label={`Edit ${a.id}`}>
        <header><h2>{a.id}</h2><IconButton aria-label="Close" onClick={onClose}>×</IconButton></header>
        <form className="form" onSubmit={e => { e.preventDefault(); void save() }}>
          <div className="kv">
            <span>Title</span><input className="inp" id="artTitle" value={title} onChange={e => setTitle(e.target.value)} />
            <span>Project</span><Select id="artProject" aria-label="Project" value={project} onChange={v => v === NEW ? setCreating(true) : setProject(v)}
              options={[...projects.map(p => ({ value: p.id, label: p.name })), { value: '', label: 'No project' }, { value: NEW, label: 'A new project…' }]} />
            {a.kind === 'data' ? <>
              <span>Viewer</span><Select id="artViewer" aria-label="Viewer page" value={viewer} onChange={setViewer}
                options={[{ value: '', label: 'None' }, ...pages.map(p => ({ value: p.id, label: `${p.id} · ${p.title}` }))]} />
            </> : null}
          </div>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {a.kind === 'data' ? 'The viewer is the page that shows one record; the Workshop previews records through it. ' : ''}
            The project decides whose agents hear its comments and where it is listed; routes and versions stay as they are.
          </span>
          <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}>{err}</span>
          <button type="submit" hidden />
        </form>
        <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading} onClick={save}>Save</Button></footer>
      </div>
    </div>
  )
}
