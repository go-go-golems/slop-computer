import { useEffect, useState } from 'react'
import { useAgentsQuery, useArtifactsQuery, useProjectsQuery, useThreadsQuery, useToolsQuery, useVersionsQuery } from '../../api/slopApi'
import type { Artifact } from '../../api/types'
import { boot, csrfToken } from '../../app/boot'
import { ago, cx, plural } from '../../app/format'
import { useVersionBy } from '../../app/hooks'
import { navigate, SCREEN_NAMES, SCREENS, toolPath, watchPath, type Location, type ScreenName } from '../../app/router'
import { useAppSelector } from '../../app/store'

const kindLabel = (a: Artifact) => (a.kind === 'data' ? a.type || 'data' : 'page')

async function signOut() {
  const r = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken() } })
  const out = r.ok ? await r.json().catch(() => ({})) : {}
  location.href = out.redirect ?? '/auth/login'
}

// TopBar: the artifact picker, the version pill, the screens, who listens,
// and who you are (prototype app.js drawBar).
export function TopBar({ loc, artifact, onScreen }: { loc: Location; artifact?: Artifact; onScreen: (s: ScreenName) => void }) {
  const [menu, setMenu] = useState<'art' | 'more' | 'tools' | null>(null)
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
  const toggle = (m: 'art' | 'more' | 'tools') => (e: React.MouseEvent) => { e.stopPropagation(); setMenu(menu === m ? null : m) }
  return (
    <header className="bar" id="bar">
      <div className="brand">slop.computer<i>{'workshop'}{local ? <>{' · '}<b>local</b></> : null}</i></div>
      <div className="proj">
        <button type="button" className="projbtn" id="artBtn" aria-haspopup="true" onClick={toggle('art')}>
          <span className="pcode">{artifact ? kindLabel(artifact) : 'artifact'}</span>
          <span className="ptitle">{artifact?.id ?? 'Pick one'}</span>
          <span className="caret">▾</span>
        </button>
        {menu === 'art' ? <ArtifactMenu current={artifact?.id} onPick={id => { setMenu(null); navigate(watchPath(id)) }} /> : null}
      </div>
      {loc.screen === 'watch' && artifact ? <VersionPill a={artifact} n={loc.n} /> : null}
      <div className="seg" role="tablist" aria-label="Screens">
        {SCREENS.map(s => <button type="button" key={s} aria-pressed={loc.screen === s} onClick={() => onScreen(s)}>{SCREEN_NAMES[s]}</button>)}
      </div>
      <div className="proj">
        <ToolsButton on={loc.screen === 'tools'} onClick={toggle('tools')} />
        {menu === 'tools' ? <ToolsMenu current={loc.tool} onPick={(id, n) => { setMenu(null); navigate(toolPath(id, n)) }} /> : null}
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
            <a className="act" href="/help/agents" style={{ color: 'inherit', textDecoration: 'none' }}><span className="t">Connect your agent</span><small style={{ gridColumn: 1 }}>Log a coding agent in and work with it through pushes and comments.</small></a>
            <a className="act" href="/_/" style={{ color: 'inherit', textDecoration: 'none' }}><span className="t">Safe mode</span><small style={{ gridColumn: 1 }}>The fuse box: routes and tokens without the Workshop.</small></a>
            <button type="button" className="act" onClick={signOut}><span className="t">Sign out</span></button>
          </div>
        ) : null}
      </div>
    </header>
  )
}

function ToolsButton({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
  const { data } = useToolsQuery()
  const waiting = (data?.tools ?? []).filter(t => t.latest.n > (t.enabled?.version ?? 0) && !t.latest.error).length
  return (
    <button type="button" className="projbtn" id="toolsBtn" aria-haspopup="true" onClick={onClick} style={on ? { borderColor: 'var(--ink)' } : undefined}>
      <span className="ptitle">Tools</span>{waiting ? <span className="count bad" title="new or updated tools">{waiting}</span> : null}<span className="caret">▾</span>
    </button>
  )
}

// ToolsMenu lists enabled tools, and tools waiting to be tried or enabled.
function ToolsMenu({ current, onPick }: { current?: string; onPick: (id: string, tryN?: number) => void }) {
  const { data } = useToolsQuery()
  const tools = data?.tools ?? []
  const enabled = tools.filter(t => t.enabled)
  const waiting = tools.filter(t => t.latest.n > (t.enabled?.version ?? 0))
  return (
    <div className="menu" role="menu" onClick={e => e.stopPropagation()}>
      <div className="grp">Tools</div>
      {enabled.map(t => (
        <button type="button" key={t.artifact} className={t.artifact === current ? 'on' : ''} role="menuitem" onClick={() => onPick(t.artifact)}>
          <span className="code">{t.enabled!.icon || 'tool'}</span><span className="t">{t.enabled!.title}</span><small>{`v${t.enabled!.version} · ${t.enabled!.permissions.join(' ')}`}</small>
        </button>
      ))}
      {!enabled.length ? <p className="mnote">No tool is enabled yet.</p> : null}
      {waiting.length ? <div className="grp">New and updated</div> : null}
      {waiting.map(t => (
        <button type="button" key={'w' + t.artifact} role="menuitem" onClick={() => onPick(t.artifact, t.latest.error ? undefined : t.latest.n)}>
          <span className="code">{t.enabled ? 'update' : 'new'}</span><span className="t">{`${t.artifact} v${t.latest.n}`}</span>
          <small>{t.latest.error ? t.latest.error : t.enabled ? `v${t.enabled.version} is enabled${t.latest.newPermissions.length ? ' · asks for ' + t.latest.newPermissions.join(' ') : ''}` : 'not enabled · try it'}</small>
        </button>
      ))}
      <p className="mnote">A tool is a page whose slop.json has a "tool" section. It runs here with only the permissions an admin approved.</p>
    </div>
  )
}

function ArtifactMenu({ current, onPick }: { current?: string; onPick: (id: string) => void }) {
  const { data: arts = [] } = useArtifactsQuery()
  const { data: projects = [] } = useProjectsQuery()
  const groups = [...projects.map(p => ({ id: p.id as string | null, name: p.name })), { id: null, name: 'No project' }]
  return (
    <div className="menu" role="menu" onClick={e => e.stopPropagation()}>
      {groups.map(g => {
        const items = arts.filter(a => a.project === g.id)
        if (!items.length) return null
        return [
          <div key={'g' + g.id} className="grp">{g.name}</div>,
          ...items.map(a => (
            <button type="button" key={a.id} className={a.id === current ? 'on' : ''} role="menuitem" onClick={() => onPick(a.id)}>
              <span className="code">{kindLabel(a)}</span><span className="t">{a.id}</span><small>{`v${a.main} · ${a.title}`}</small>
            </button>
          )),
        ]
      })}
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
