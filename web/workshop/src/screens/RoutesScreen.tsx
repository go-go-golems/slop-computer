import { Fragment, useState } from 'react'
import {
  errorText, useArtifactsQuery, useRemoveRouteMutation, useRouteLogQuery, useRoutesQuery, useSetRouteMutation, useUndoRouteMutation, useVersionsQuery,
} from '../api/slopApi'
import type { Route, RouteView } from '../api/types'
import { boot } from '../app/boot'
import { ago, cx } from '../app/format'
import { useArtifact, useNames } from '../app/hooks'
import { navigate, watchPath } from '../app/router'
import { toast } from '../app/store'
import { Avatar, Button, Empty, Select, Seg, Tag } from '../components/atoms'
import { PreviewStage } from '../components/organisms/PreviewStage'
import type { SiteTarget } from './SiteScreen'

export interface AddingRoute { host?: string; path?: string; page?: string }

interface Props {
  host: string
  setHost: (h: string) => void
  adding: AddingRoute | null
  setAdding: (a: AddingRoute | null) => void
  onOpenSite: (t: SiteTarget) => void
}

const samplePath = (r: Route) => (r.path === '*' ? '/press' : r.path.replace(/:(\w+)/g, 'example'))

// RoutesScreen is the route table of a site host (prototype app.js renderRoutes).
export function RoutesScreen({ host, setHost, adding, setAdding, onOpenSite }: Props) {
  const { data: all = [] } = useRoutesQuery()
  const [sel, setSel] = useState<string | null>(null)
  const hosts = Array.from(new Set([...boot().config.siteHosts, ...all.map(r => r.host)]))
  const rows = all.filter(r => r.host === host).sort((x, y) => Number(x.path === '*') - Number(y.path === '*') || x.path.localeCompare(y.path))
  const selected = rows.find(r => r.path === sel) ?? rows[0]
  return (
    <div className="split">
      <section className="tile main">
        <div className="dstrip">
          <div className="dtabs" role="tablist">
            {hosts.map(h => (
              <button type="button" key={h} className={cx('dtab', h === host && 'on')} role="tab" onClick={() => { setHost(h); setAdding(null) }}>
                {h}<span className="count">{all.filter(r => r.host === h).length}</span>
              </button>
            ))}
          </div>
          <span className="sp" />
          <button type="button" className={cx('tabact', adding && 'on')} onClick={() => setAdding(adding ? null : {})}>+ Add route</button>
        </div>
        <div className="tilebody"><div className="scroll">
          {adding ? <AddRouteForm host={host} pre={adding} existing={rows} onDone={p => { setAdding(null); if (p) setSel(p) }} /> : null}
          <RouteTable rows={rows} selected={selected} onSelect={r => setSel(r.path)} />
          <p className="empty">The most specific route wins. * catches every path with no route of its own. A route either follows its page’s main version or is pinned to one; data bindings work the same way.</p>
        </div></div>
      </section>
      <div className="gutter" style={{ cursor: 'default' }} />
      <section className="tile side" style={{ width: 440 }}>
        {selected ? <RouteDetail key={selected.host + selected.path} r={selected} onOpenSite={onOpenSite} /> : <Empty>Select a route.</Empty>}
      </section>
    </div>
  )
}

function RouteTable({ rows, selected, onSelect }: { rows: RouteView[]; selected?: RouteView; onSelect: (r: RouteView) => void }) {
  const name = useNames()
  const { data: arts = [] } = useArtifactsQuery()
  return (
    <div className="tablewrap">
      <table className="rt">
        <thead><tr>{['Path', 'Page', 'Data', 'Points at', 'Access', 'Changed'].map(t => <th key={t}>{t}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => {
            const main = arts.find(a => a.id === r.page)?.main ?? 0
            const data = Object.entries(r.data ?? {}).filter(([k]) => k !== '$tokens')
            return (
              <tr key={r.path} className={cx('click', selected?.path === r.path && 'on')} onClick={() => onSelect(r)}>
                <td><code style={{ fontWeight: 700 }}>{r.path}</code></td>
                <td>{r.pageFrom ? <><code>{r.pageFrom}</code><div className="dim">{`else ${r.page}`}</div></> : r.page}</td>
                <td className="dim">
                  {data.length ? data.map(([k, b]) => <div key={k}><code>{b.artifact.startsWith('$') ? (b.artifact === '$site' ? 'site index' : b.artifact) : `${b.artifact}@${b.version ? 'v' + b.version : 'main'}`}</code></div>) : '–'}
                  {r.record ? <div><code style={{ color: 'var(--ink-2)' }}>{r.record}</code></div> : null}
                </td>
                <td>{r.pageFrom ? <code>main of each</code> : r.version ? <><code>{`v${r.version}`}</code>{' pinned '}{main > r.version ? <Tag tone="red">{`v${main} newer`}</Tag> : null}</> : <code>{`main → v${main}`}</code>}</td>
                <td className="dim">{r.live ? <Tag tone="ink">live</Tag> : null}{r.live ? ' ' : ''}{r.access}</td>
                <td className="dim">{`${name(r.changedBy)} · ${ago(r.changedAt)}`}</td>
              </tr>
            )
          })}
          {!rows.length ? <tr><td colSpan={6} className="dim">No routes on this host yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

function AddRouteForm({ host, pre, existing, onDone }: { host: string; pre: AddingRoute; existing: RouteView[]; onDone: (path?: string) => void }) {
  const { data: arts = [] } = useArtifactsQuery()
  const pages = arts.filter(a => a.kind === 'page')
  const [path, setPath] = useState(pre.path ?? '')
  const [page, setPage] = useState(pre.page ?? pages[0]?.id ?? '')
  const [pin, setPin] = useState('main')
  const [record, setRecord] = useState('')
  const [err, setErr] = useState('')
  const [setRoute] = useSetRouteMutation()
  const add = async () => {
    let p = path.trim()
    if (p && p !== '*' && !p.startsWith('/')) p = '/' + p
    if (!p) return setErr('A route needs a path, like /press.')
    if (!/^(\*|\/[A-Za-z0-9_\-./:*]*)$/.test(p)) return setErr('Paths use letters, digits, - _ . / and :params.')
    if (existing.some(r => r.path === p)) return setErr(`${p} already has a route. Select it in the table to change it.`)
    const a = arts.find(x => x.id === page)
    if (!a) return setErr('Pick a page.')
    try {
      await setRoute({ host, path: p, page, version: pin === 'pin' ? a.main : null, record: record.trim() || undefined, access: 'public', note: 'created' }).unwrap()
      toast(`${p} now serves ${page}.`)
      onDone(p)
    } catch (e) { setErr(errorText(e)) }
  }
  return (
    <div className="box" style={{ margin: 12 }}>
      <h4>{`New route on ${host}`}</h4>
      <div className="kv">
        <span>Path</span><input className="inp" id="nr-path" placeholder="/press" value={path} onChange={e => setPath(e.target.value)} />
        <span>Page</span><Select id="nr-page" aria-label="Page" value={page} onChange={setPage} options={pages.map(p => ({ value: p.id, label: `${p.id} · v${p.main}` }))} />
        <span>Points at</span><Select id="nr-pin" aria-label="Points at" value={pin} onChange={setPin} options={[{ value: 'main', label: 'Follow main' }, { value: 'pin', label: 'Pin the current main version' }]} />
        <span>Record</span><input className="inp" id="nr-rec" placeholder="only for paths with :params, e.g. posts/{slug}.md" value={record} onChange={e => setRecord(e.target.value)} />
      </div>
      <div className="row">
        <Button variant="primary" onClick={add}>Add route</Button>
        <Button onClick={() => onDone()}>Cancel</Button>
        <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)' }}>{err}</span>
      </div>
    </div>
  )
}

function RouteDetail({ r, onOpenSite }: { r: RouteView; onOpenSite: (t: SiteTarget) => void }) {
  const name = useNames()
  const { data: arts = [] } = useArtifactsQuery()
  const { data: versions = [] } = useVersionsQuery(r.page)
  const { data: log = [] } = useRouteLogQuery({ host: r.host, path: r.path })
  const [setRoute] = useSetRouteMutation()
  const [removeRoute] = useRemoveRouteMutation()
  const [undoRoute] = useUndoRouteMutation()
  const [confirm, setConfirm] = useState(false)
  const a = arts.find(x => x.id === r.page)
  const set = async (patch: Partial<Route>, note: string) => {
    try { await setRoute({ ...r, ...patch, note }).unwrap(); toast(`${r.path}: ${note}.`) } catch (e) { toast(errorText(e), true) }
  }
  const path = samplePath(r)
  const pages = arts.filter(x => x.kind === 'page')
  const binds = Object.entries(r.data ?? {})
  return (
    <div className="tilebody"><div className="scroll"><div className="det">
      <h3>{r.path}</h3>
      <p className="sub">{`${r.host} · ${r.pageFrom ? `${r.pageFrom}, else ${r.page}` : r.page} · changed by ${name(r.changedBy)} ${ago(r.changedAt)}`}</p>
      <div className="mini">{r.n ? <PreviewStage artifact={r.page} n={r.n} host={r.host} path={path} device="desktop" className="mini-stage" /> : null}</div>
      <div className="kv">
        {r.pageFrom ? <><span>Page from</span><span><code>{r.pageFrom}</code><span className="dim">{` · any page of ${a?.project ?? 'its project'} it names, at main`}</span></span></> : null}
        <span>{r.pageFrom ? 'Else page' : 'Page'}</span>
        <Select aria-label="Page" value={r.page} onChange={val => set({ page: val, version: null }, `page is now ${val}, following main`)} options={pages.map(p => ({ value: p.id, label: p.id }))} />
        {r.pageFrom ? null : <>
          <span>Points at</span>
          <Select aria-label="Version" value={r.version ? String(r.version) : 'main'}
            onChange={val => (val === 'main' ? set({ version: null }, 'follows main') : set({ version: +val }, `pinned v${val}`))}
            options={[{ value: 'main', label: `Follow main (now v${a?.main ?? '?'})` }, ...versions.slice().reverse().map(x => ({ value: String(x.n), label: `v${x.n} · ${x.message}` }))]} />
        </>}
        {binds.filter(([, b]) => b.artifact.startsWith('$')).map(([k, b]) => <Fragment key={k}><span>{`Data: ${k}`}</span><span className="dim">{b.artifact === '$site' ? 'the site index: every public URL on this host' : b.artifact}</span></Fragment>)}
        {binds.filter(([, b]) => !b.artifact.startsWith('$')).map(([k, b]) => <BindingSelect key={k} name={k} artifact={b.artifact} version={b.version}
          onChange={ver => set({ bindings: { ...(r.bindings ?? {}), [k]: { artifact: b.artifact, version: ver } } }, ver ? `${b.artifact} pinned v${ver}` : `${b.artifact} follows main`)} />)}
        {r.record ? <><span>Record</span><code>{r.record}</code></> : null}
        {r.pageFrom ? null : <>
          <span>Runs</span>
          <Seg small label="Runs" value={r.live ? 'live' : 'static'} onChange={x => {
            const live = x === 'live'
            if (live !== !!r.live) void set({ live, access: !live && r.access === 'signed-in' ? 'admins' : r.access }, live ? 'live: the site runs the app' : 'static')
          }} options={[['static', 'static page'], ['live', 'live app']]} />
        </>}
        <span>Access</span>
        <Seg small label="Access" value={r.access} onChange={x => { if (x !== r.access) void set({ access: x }, `access ${x}`) }}
          options={r.live ? [['public', 'anyone'], ['signed-in', 'signed in'], ['admins', 'admins']] : [['public', 'public'], ['admins', 'admins']]} />
      </div>
      <div className="row">
        <Button onClick={() => onOpenSite({ host: r.host, path })}>Open in Site</Button>
        <Button onClick={() => navigate(watchPath(r.page))}>{`Watch ${r.page}`}</Button>
        <span className="sp" />
        <Button variant="danger" onClick={() => setConfirm(true)}>Remove route</Button>
      </div>
      {confirm ? (
        <div className="box red">
          <span>{`Remove ${r.path}? Visitors get the * route instead. It stays in the history below.`}</span>
          <div className="row">
            <Button variant="danger" onClick={async () => { try { await removeRoute({ host: r.host, path: r.path }).unwrap(); toast(`${r.path} removed.`) } catch (e) { toast(errorText(e), true) } }}>Remove</Button>
            <Button onClick={() => setConfirm(false)}>Keep it</Button>
          </div>
        </div>
      ) : null}
      <div className="pane-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <h2>History</h2><span className="note">Every change is kept. Roll back by pointing again.</span><span className="sp" />
        {log.length > 1 ? <Button small onClick={async () => { try { await undoRoute({ host: r.host, path: r.path }).unwrap(); toast(`${r.path}: undone.`) } catch (e) { toast(errorText(e), true) } }}>Undo last change</Button> : null}
      </div>
      <div style={{ margin: '-14px -14px 0' }}>
        {log.map((l, i) => {
          const target = l.to ? l.to.version : null
          const can = !!l.to && i > 0 && target !== r.version && l.to.page === r.page
          return (
            <div key={l.id} className={cx('hrow', i === 0 && 'on')}>
              <Avatar name={name(l.by)} />
              <div className="ht" style={{ cursor: 'default' }}>
                <b>{l.note || (l.to ? (l.to.version ? `pinned v${l.to.version}` : 'follows main') : 'removed')}</b>
                <small>{`${name(l.by)} · ${l.via} · ${ago(l.at)}`}</small>
              </div>
              {can ? <Button small onClick={() => set({ version: target }, target ? `rolled back to v${target}` : 'rolled back to follow main')}>Roll back to this</Button> : null}
            </div>
          )
        })}
        {!log.length ? <Empty>No changes yet.</Empty> : null}
      </div>
    </div></div></div>
  )
}

function BindingSelect({ name, artifact, version, onChange }: { name: string; artifact: string; version: number | null; onChange: (v: number | null) => void }) {
  const { data: versions = [] } = useVersionsQuery(artifact)
  const main = useArtifact(artifact)?.main
  return <>
    <span>{name === '$tokens' ? 'Tokens' : `Data: ${name}`}</span>
    <Select aria-label={'Data ' + name} value={version ? String(version) : 'main'} onChange={val => onChange(val === 'main' ? null : +val)}
      options={[{ value: 'main', label: `${artifact} · follow main${main ? ` (v${main})` : ''}` }, ...versions.slice().reverse().map(x => ({ value: String(x.n), label: `${artifact} v${x.n} · ${x.message}` }))]} />
  </>
}
