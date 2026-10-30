import { useEffect, useState } from 'react'
import { useAgentsQuery, useArtifactsQuery, useProjectsQuery, useThreadsQuery, useAppsQuery, useVersionsQuery } from '../../api/slopApi'
import type { Artifact } from '../../api/types'
import { boot, csrfToken } from '../../app/boot'
import { ago, cx, plural } from '../../app/format'
import { projectGroups } from '../../app/groups'
import { useVersionBy } from '../../app/hooks'
import { navigate, runPath, SCREEN_NAMES, SCREENS, watchPath, type Location, type ScreenName } from '../../app/router'
import { useAppSelector } from '../../app/store'
import { LinkButton } from '../atoms'
import { ArtifactDialog, inScope, ProjectDialog, ProjectPicker, useProjectScope } from './Projects'

const kindLabel = (a: Artifact) => (a.kind === 'data' ? a.type || 'data' : 'page')

async function signOut() {
  const r = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken() } })
  const out = r.ok ? await r.json().catch(() => ({})) : {}
  location.href = out.redirect ?? '/auth/login'
}

// TopBar: the artifact picker, the version pill, the screens, who listens,
// and who you are (prototype app.js drawBar).
export function TopBar({ loc, artifact, onScreen }: { loc: Location; artifact?: Artifact; onScreen: (s: ScreenName) => void }) {
  const [menu, setMenu] = useState<'art' | 'more' | 'apps' | null>(null)
  const [dialog, setDialog] = useState<'artifact' | 'project' | null>(null)
  const { data: agents = [] } = useAgentsQuery()
  const live = useAppSelector(s => s.ui.live)
  const me = boot().me.user
  const local = boot().config.mode === 'local'
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc) }
  }, [menu])
  const toggle = (m: 'art' | 'more' | 'apps') => (e: React.MouseEvent) => { e.stopPropagation(); setMenu(menu === m ? null : m) }
  return (
    <header className="bar" id="bar">
      <div className="brand">slop.computer<i>{'workshop'}{local ? <>{' · '}<b>local</b></> : null}</i></div>
      <div className="proj">
        <button type="button" className="projbtn" id="artBtn" aria-haspopup="true" onClick={toggle('art')}>
          <span className="pcode">{artifact ? kindLabel(artifact) : 'artifact'}</span>
          <span className="ptitle">{artifact?.id ?? 'Pick one'}</span>
          <span className="caret">▾</span>
        </button>
        {menu === 'art' ? <ArtifactMenu current={artifact} onPick={id => { setMenu(null); navigate(watchPath(id)) }} onDialog={d => { setMenu(null); setDialog(d) }} /> : null}
        {dialog === 'artifact' && artifact ? <ArtifactDialog a={artifact} onClose={() => setDialog(null)} /> : null}
        {dialog === 'project' ? <ProjectDialog onClose={() => setDialog(null)} /> : null}
      </div>
      {loc.screen === 'watch' && artifact ? <VersionPill a={artifact} n={loc.n} /> : null}
      <div className="seg" role="tablist" aria-label="Screens">
        {SCREENS.map(s => <button type="button" key={s} aria-pressed={loc.screen === s} onClick={() => onScreen(s)}>{SCREEN_NAMES[s]}</button>)}
      </div>
      <div className="proj">
        <AppsButton on={loc.screen === 'run'} onClick={toggle('apps')} />
        {menu === 'apps' ? <AppsMenu current={loc.target} onPick={t => { setMenu(null); navigate(runPath(t)) }} /> : null}
      </div>
      <span className="sp" />
      <span className="pill" id="agentPill" title={live ? 'Live: changes from others show up as they happen.' : 'Reconnecting to the event stream…'}>
        <span className={cx('live-dot', live && 'on')} />
        <b>{agents.length ? plural(agents.length, 'agent') : 'No agent'}</b>
        <span>{agents.length ? 'listening' : 'listening for comments'}</span>
      </span>
      <div className="proj">
        <button type="button" className="projbtn" aria-haspopup="true" onClick={toggle('more')} title="Signed in as">
          <span className="pcode">you</span><span className="ptitle">{me.name}</span><span className="caret">▾</span>
        </button>
        {menu === 'more' ? (
          <div className="menu right" role="menu" onClick={e => e.stopPropagation()}>
            {local ? <button type="button" className="act" onClick={signOut}><span className="t">Sign in as someone else</span><small style={{ gridColumn: 1 }}>Local mode: nicknames, no passwords.</small></button> : null}
            <a className="act" href="/help/agents"><span className="t">Connect your agent</span><small style={{ gridColumn: 1 }}>Log a coding agent in and work with it through pushes and comments.</small></a>
            <a className="act" href="/_/"><span className="t">Safe mode</span><small style={{ gridColumn: 1 }}>The fuse box: routes and tokens without the Workshop.</small></a>
            <button type="button" className="act" onClick={signOut}><span className="t">Sign out</span></button>
          </div>
        ) : null}
      </div>
    </header>
  )
}

function AppsButton({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
  const { data = [] } = useAppsQuery()
  const waiting = data.filter(a => (a.permissions?.length ?? 0) > 0 && a.approved?.version !== a.main).length
  return (
    <button type="button" className="projbtn" id="appsBtn" aria-haspopup="true" onClick={onClick} style={on ? { borderColor: 'var(--ink)' } : undefined}>
      <span className="ptitle">Apps</span>{waiting ? <span className="count bad" title="apps whose main asks for slop permissions not approved yet">{waiting}</span> : null}<span className="caret">▾</span>
    </button>
  )
}

// AppsMenu lists apps (pages that declare capabilities) and the targets
// that run them: the app itself, and each data artifact naming it.
function AppsMenu({ current, onPick }: { current?: string; onPick: (target: string) => void }) {
  const { data: apps = [] } = useAppsQuery()
  return (
    <div className="menu" role="menu" onClick={e => e.stopPropagation()}>
      {apps.map(a => {
        const unapproved = (a.permissions?.length ?? 0) > 0 && a.approved?.version !== a.main
        return [
          <div key={'g' + a.artifact} className="grp">{a.title}</div>,
          <button type="button" key={a.artifact} className={a.artifact === current ? 'on' : ''} role="menuitem" onClick={() => onPick(a.artifact)}>
            <span className="code">{'app'}</span><span className="t">{a.artifact}</span>
            <small>{a.error ? a.error : `v${a.main} · ${a.caps.join(' ')}${unapproved ? ' · slop not approved' : ''}`}</small>
          </button>,
          ...(a.targets ?? []).map(t => (
            <button type="button" key={a.artifact + '/' + t} className={t === current ? 'on' : ''} role="menuitem" onClick={() => onPick(t)}>
              <span className="code">{'on'}</span><span className="t">{t}</span><small>{`runs ${a.artifact}`}</small>
            </button>
          )),
        ]
      })}
      {!apps.length ? <p className="mnote">No app yet.</p> : null}
      <p className="mnote">An app is a page whose slop.json declares capabilities (db, room, user…). A data artifact with app set runs it against its own state.</p>
    </div>
  )
}

// ArtifactMenu lists the artifacts of the project scope, by project, and
// edits the current artifact or starts a project.
function ArtifactMenu({ current, onPick, onDialog }: { current?: Artifact; onPick: (id: string) => void; onDialog: (d: 'artifact' | 'project') => void }) {
  const { data: arts = [] } = useArtifactsQuery()
  const { data: projects = [] } = useProjectsQuery()
  const [scope, setScope] = useProjectScope()
  const groups = projectGroups(arts.filter(a => inScope(a, scope)), projects)
  return (
    <div className="menu" role="menu" onClick={e => e.stopPropagation()}>
      <div className="mhead"><span>Project</span><ProjectPicker id="menuProject" /></div>
      {groups.map(({ items, ...g }) => {
        return [
          <div key={'g' + g.id} className="grp">{g.name}</div>,
          ...items.map(a => (
            <button type="button" key={a.id} className={a.id === current?.id ? 'on' : ''} role="menuitem" onClick={() => onPick(a.id)}>
              <span className="code">{kindLabel(a)}</span><span className="t">{a.id}</span><small>{`v${a.main} · ${a.title}`}</small>
            </button>
          )),
        ]
      })}
      {!groups.length ? <p className="mnote">{'Nothing in this project yet. '}<LinkButton onClick={() => setScope(null)}>Show all projects</LinkButton></p> : null}
      <div className="grp" />
      {current ? <button type="button" className="act" role="menuitem" onClick={() => onDialog('artifact')}><span className="t">{`Title and project of ${current.id}…`}</span></button> : null}
      <button type="button" className="act" role="menuitem" onClick={() => onDialog('project')}><span className="t">New project…</span></button>
      <p className="mnote">A new artifact starts with its first push: slop push ./folder -a name, or Push a file on the Artifacts screen.</p>
    </div>
  )
}

function VersionPill({ a, n }: { a: Artifact; n?: number }) {
  const { data: versions = [] } = useVersionsQuery(a.id)
  const { data: threads = [] } = useThreadsQuery({ artifact: a.id })
  const by = useVersionBy()
  const v = (n && versions.find(x => x.n === n)) || versions[versions.length - 1]
  if (!v) return null
  const open = threads.filter(t => !t.resolved).length
  return (
    <span className="pill" id="verPill" title={`${by(v)} · ${ago(v.at)}`}>
      <b>{'v' + v.n}</b><span>{(v.n === a.main ? 'main' : 'of ' + versions.length) + (open ? ' · ' + plural(open, 'open thread') : '')}</span>
    </span>
  )
}

export function ToastHost() {
  const toasts = useAppSelector(s => s.ui.toasts)
  return <div className="toasts" id="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={cx('toast', t.bad && 'bad')}>{t.text}</div>)}</div>
}
