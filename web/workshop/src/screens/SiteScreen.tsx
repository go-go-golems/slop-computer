import { useCallback, useState } from 'react'
import { useResolveQuery } from '../api/slopApi'
import { boot } from '../app/boot'
import { navigate, watchPath } from '../app/router'
import { toast } from '../app/store'
import { usePref } from '../app/hooks'
import { Button, Empty, IconButton } from '../components/atoms'
import { PreviewStage, type Device } from '../components/organisms/PreviewStage'
import { DeviceSeg } from '../components/organisms/WatchRight'
import type { FromPreview } from '../preview/bridge-protocol'

// SiteTarget asks the Site screen to open a path; a relative path is
// resolved against `from`.
export interface SiteTarget { host?: string; path: string; from?: string }

export interface SiteState { host: string; path: string; back: string[]; fwd: string[] }

export function resolvePath(path: string, from: string): string {
  if (path.startsWith('/')) return path
  try { return new URL(path, 'http://x' + from).pathname } catch { return '/' }
}

// go moves a site state to a new path, keeping history.
export function siteGo(s: SiteState, t: SiteTarget): SiteState {
  const host = t.host ?? s.host
  const path = resolvePath(t.path, t.from ?? s.path)
  if (host !== s.host) return { host, path, back: [], fwd: [] }
  if (path === s.path) return s
  return { host, path, back: [...s.back, s.path], fwd: [] }
}

// SiteScreen browses a site host as a visitor would, through the route table
// (prototype app.js renderSite).
export function SiteScreen({ site, setSite, onAddRoute }: { site: SiteState; setSite: (s: SiteState) => void; onAddRoute: (host: string, path: string) => void }) {
  const [device, setDevice] = usePref<Device>('device', 'desktop')
  const [addr, setAddr] = useState(site.path)
  const [reload, setReload] = useState(0)
  const { data: res, isFetching } = useResolveQuery({ host: site.host, path: site.path })
  const go = useCallback((t: SiteTarget) => { const next = siteGo(site, t); setSite(next); setAddr(next.path) }, [site, setSite])
  const onMessage = useCallback((m: FromPreview) => {
    if (m.type === 'nav') go({ path: m.href })
    else if (m.type === 'external') toast('Links to other sites open outside the Workshop: ' + m.href)
  }, [go])
  const hosts = boot().config.siteHosts

  let visit, body
  if (!res) {
    visit = <div className="visit"><span><b>No route</b>{` matches ${site.path} on ${site.host}, and there is no * route.`}</span></div>
    body = isFetching ? null : <Empty>A visitor would get the server’s plain 404.</Empty>
  } else {
    const r = res.resolution
    const served = r.page ?? r.route.page
    const binds = Object.entries(res.bindings).filter(([k]) => k !== '$tokens')
    visit = (
      <div className={r.fallback || r.missing ? 'visit' : 'visit calm'} id="siteVisit">
        <span>
          {r.fallback ? <b>No route of its own. </b> : null}
          {r.missing ? <b>{`${r.route.pageFrom} names no page here (404). `}</b> : null}
          <code>{r.route.path}</code>{' → '}<b>{`${served} v${res.n}`}</b>{r.route.version ? ' (pinned)' : ' (main)'}
          {r.route.pageFrom && !r.missing ? <span className="muted">{` · from ${r.route.pageFrom}`}</span> : null}
          {binds.map(([k, b]) => <span key={k} className="muted">{` · ${k} = ${b.artifact} v${b.n}${b.version ? ' pinned' : ''}`}</span>)}
          {r.record ? <><span className="muted"> · record </span><code>{r.record}</code></> : null}
          {res.bindings.$tokens ? <span className="muted">{` · tokens v${res.bindings.$tokens.n}`}</span> : null}
        </span>
        {r.fallback ? <Button small onClick={() => onAddRoute(site.host, site.path)}>{`Add a route for ${site.path}…`}</Button> : null}
      </div>
    )
    body = res.n ? <PreviewStage key={reload} artifact={served} n={res.n} host={site.host} path={site.path} device={device} onMessage={onMessage} title={site.host + site.path} />
      : <Empty>{`${served} has no version to serve yet.`}</Empty>
  }

  return (
    <div className="split">
      <section className="tile main">
        <div className="toolbar">
          <IconButton aria-label="Back" disabled={!site.back.length} onClick={() => { const back = site.back.slice(); const p = back.pop()!; setSite({ ...site, path: p, back, fwd: [...site.fwd, site.path] }); setAddr(p) }}>←</IconButton>
          <IconButton aria-label="Forward" disabled={!site.fwd.length} onClick={() => { const fwd = site.fwd.slice(); const p = fwd.pop()!; setSite({ ...site, path: p, fwd, back: [...site.back, site.path] }); setAddr(p) }}>→</IconButton>
          <IconButton aria-label="Reload" onClick={() => setReload(x => x + 1)}>↻</IconButton>
          <div className="addr">
            <select aria-label="Host" value={site.host} onChange={e => { setSite({ host: e.target.value, path: '/', back: [], fwd: [] }); setAddr('/') }}>
              {hosts.map(h => <option key={h} value={h}>{'http://' + h}</option>)}
            </select>
            <input id="siteAddr" value={addr} aria-label="Path" spellCheck={false} onChange={e => setAddr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go({ path: addr.trim() || '/' }) }} />
          </div>
          <Button onClick={() => go({ path: addr.trim() || '/' })}>Go</Button>
          <DeviceSeg device={device} onChange={setDevice} />
          <Button id="siteWatch" disabled={!res} onClick={() => res && navigate(watchPath(res.resolution.page ?? res.resolution.route.page, res.resolution.route.version ? res.n : null))}>Watch this page</Button>
          <a className="btn" href={`${location.protocol}//${site.host}${site.path}`} target="_blank" rel="noreferrer">Open the site ↗</a>
        </div>
        {visit}
        <div className="tilebody" id="siteBody">{body}</div>
      </section>
    </div>
  )
}
