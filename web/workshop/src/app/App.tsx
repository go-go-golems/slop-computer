import { useCallback, useEffect, useState } from 'react'
import { useArtifactsQuery } from '../api/slopApi'
import { TopBar, ToastHost } from '../components/organisms/TopBar'
import { AdminScreen } from '../screens/AdminScreen'
import { ArtifactsScreen } from '../screens/ArtifactsScreen'
import { RoutesScreen, type AddingRoute } from '../screens/RoutesScreen'
import { SiteScreen, siteGo, type SiteState, type SiteTarget } from '../screens/SiteScreen'
import { WatchScreen } from '../screens/WatchScreen'
import { ToolScreen } from '../screens/ToolScreen'
import { Empty } from '../components/atoms'
import { boot } from './boot'
import { siteHost, usePref } from './hooks'
import { navigate, useLocation, watchPath, type ScreenName } from './router'

export function App() {
  const loc = useLocation()
  const { data: arts, isLoading } = useArtifactsQuery()
  const [lastArtifact, setLastArtifact] = usePref<string | null>('artifact', null)
  // Screen state that outlives a screen: where Site is, which host Routes shows.
  const [site, setSite] = useState<SiteState>({ host: siteHost(), path: '/', back: [], fwd: [] })
  const [routesHost, setRoutesHost] = useState(siteHost())
  const [adding, setAdding] = useState<AddingRoute | null>(null)

  const fallback = arts?.find(a => a.id === lastArtifact) ?? arts?.find(a => a.kind === 'page') ?? arts?.[0]
  const artifact = loc.artifact ? arts?.find(a => a.id === loc.artifact) : fallback
  useEffect(() => { if (loc.artifact && artifact) setLastArtifact(artifact.id) }, [loc.artifact, artifact, setLastArtifact])
  useEffect(() => {
    if (loc.screen === 'watch' && !loc.artifact && fallback) navigate(watchPath(fallback.id), true)
  }, [loc.screen, loc.artifact, fallback])

  const openSite = useCallback((t: SiteTarget) => { setSite(s => siteGo(s, t)); navigate('/site') }, [])
  const addRoute = useCallback((pre: AddingRoute) => { if (pre.host) setRoutesHost(pre.host); setAdding(pre); navigate('/routes') }, [])
  const screen = (s: ScreenName) => navigate(s === 'watch' && artifact ? watchPath(artifact.id) : '/' + s)

  let body
  if (isLoading) body = <div className="boot">Loading…</div>
  else if (loc.screen === 'routes') body = <RoutesScreen host={routesHost} setHost={setRoutesHost} adding={adding} setAdding={setAdding} onOpenSite={openSite} />
  else if (loc.screen === 'artifacts') body = <ArtifactsScreen />
  else if (loc.screen === 'site') body = <SiteScreen site={site} setSite={setSite} onAddRoute={(host, path) => addRoute({ host, path })} />
  else if (loc.screen === 'admin') body = <AdminScreen />
  else if (loc.screen === 'tools' && loc.tool) body = <ToolScreen key={loc.tool} id={loc.tool} tryN={Number(loc.query.get('try')) || undefined} />
  else if (!artifact) body = <div className="split"><section className="tile main"><Empty>{loc.artifact ? `There is no artifact called ${loc.artifact}.` : <>No artifacts yet. Push one with <code>slop push ./folder -a name</code>, or <a href="/help/agents">connect your coding agent</a>.</>}</Empty></section></div>
  else body = <WatchScreen key={artifact.id} a={artifact} n={loc.n} onOpenSite={openSite} onAddRoute={page => addRoute({ page })} />

  return (
    <>
      <div id="app">
        <TopBar loc={loc} artifact={artifact} onScreen={screen} />
        <main id="work">{body}</main>
      </div>
      <ToastHost />
    </>
  )
}

// PendingScreen is all a signed-in person without the admin role sees.
export function PendingScreen() {
  const u = boot().me.user
  return (
    <div className="boot">
      <div style={{ maxWidth: 420, lineHeight: 1.6 }}>
        <h2 style={{ color: 'var(--ink)' }}>{`Hello ${u.name}.`}</h2>
        <p>{u.role === 'disabled' ? 'This account is disabled.' : 'An admin has to let you in before you can see anything here.'}</p>
        <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value={boot().me.csrfToken ?? ''} /><button className="btn" type="submit">Sign out</button></form>
      </div>
    </div>
  )
}
