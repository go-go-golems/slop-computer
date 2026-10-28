import { useMemo } from 'react'
import { errorText, useFileQuery, useRecordsQuery, useSetRouteMutation } from '../../api/slopApi'
import type { Artifact, RouteView, Version } from '../../api/types'
import { toast } from '../../app/store'
import { navigate, toolPath } from '../../app/router'
import { cx, kb, plural } from '../../app/format'
import { shortHost, useReaders, useVersionBy } from '../../app/hooks'
import { Button, Field, Seg, Select } from '../atoms'
import { FilmFrame } from '../molecules'
import { Thumb, type Device } from './PreviewStage'

// PreviewContext is where a page is previewed: the route that serves it, and
// for routes with :params a concrete path built from a sample record.
export interface PreviewContext { route: RouteView | null; host?: string; path?: string; samples: string[]; sample?: string }

// usePreviewContext ports the prototype's render.js previewContext().
export function usePreviewContext(routes: RouteView[], sample: string | null): PreviewContext {
  const r = routes.find(x => x.path !== '*') ?? routes[0] ?? null
  const hasParams = !!r && /[:*]/.test(r.path) && r.path !== '*'
  const data = r && hasParams ? Object.entries(r.data ?? {}).find(([k]) => k !== '$tokens')?.[1] : undefined
  const { data: recs } = useRecordsQuery(data ? { id: data.artifact, n: data.n } : { id: '', n: 0 }, { skip: !data })
  return useMemo(() => {
    if (!r) return { route: null, samples: [] }
    if (r.path === '*') return { route: r, host: r.host, path: '/press', samples: [] }
    if (!hasParams) return { route: r, host: r.host, path: r.path, samples: [] }
    let samples: string[] = []
    if (r.record && recs) {
      const prefix = r.record.slice(0, r.record.indexOf('{'))
      samples = recs.filter(x => x.path.startsWith(prefix)).sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? ''))).map(x => x.id)
    }
    const pick = sample && samples.includes(sample) ? sample : samples[0] ?? 'example'
    return { route: r, host: r.host, path: r.path.replace(/:(\w+)/g, () => pick), samples, sample: pick }
  }, [r, hasParams, recs, sample])
}

export function DeviceSeg({ device, onChange }: { device: Device; onChange: (d: Device) => void }) {
  return <Seg label="Width" value={device} onChange={onChange} options={[['fit', 'Fit'], ['desktop', 'Desktop'], ['phone', 'Phone']]} />
}

export function PageToolbar(p: {
  a: Artifact; versions: Version[]; v: Version; ctx: PreviewContext; rtab: string; device: Device; cmpLeft: number
  onDevice: (d: Device) => void; onSample: (s: string) => void; onCmpLeft: (n: number) => void; onOpenSite: (host: string, path: string) => void
}) {
  const { ctx } = p
  return (
    <div className="toolbar" id="wTool">
      <div className="addr">
        <span>{ctx.host ?? 'not routed'}</span>
        <span className="ro">{ctx.route ? (ctx.route.path === '*' ? '* (any path with no route)' : ctx.route.path) : ''}</span>
        {ctx.samples.length ? <>
          <span>·</span>
          <Select aria-label="Which record" style={{ border: 0, background: 'transparent', height: 26, font: '400 12px var(--code)', color: 'var(--ink)' }}
            value={ctx.sample ?? ''} onChange={p.onSample} options={ctx.samples.map(s => ({ value: s, label: s }))} />
        </> : null}
      </div>
      {p.rtab !== 'files' ? <DeviceSeg device={p.device} onChange={p.onDevice} /> : null}
      {p.rtab === 'compare' ? (
        <Field label="Left">
          <Select aria-label="Compare with" value={String(p.cmpLeft)} onChange={x => p.onCmpLeft(+x)} options={p.versions.map(x => ({ value: String(x.n), label: `v${x.n}` }))} />
        </Field>
      ) : null}
      {ctx.route && ctx.host && ctx.path ? <Button onClick={() => p.onOpenSite(ctx.host!, ctx.path!)}>Open in Site</Button> : null}
      {p.v.manifest && 'tool' in p.v.manifest ? <Button onClick={() => navigate(toolPath(p.a.id, p.v.n))}>Open as tool</Button> : null}
    </div>
  )
}

// VisitLine says what visitors get, and offers to point a route at the
// version being looked at.
export function VisitLine({ a, v, routes, onAddRoute }: { a: Artifact; v: Version; routes: RouteView[]; onAddRoute: () => void }) {
  const [setRoute] = useSetRouteMutation()
  const readers = useReaders(a.id)
  if (a.kind === 'data') {
    if (!readers.length) return <div className="visit calm"><span className="muted">No page reads this data yet.</span></div>
    const follow = readers.filter(r => Object.values(r.data).some(b => b.artifact === a.id && b.version == null))
    return (
      <div className={cx('visit', v.n === a.main && 'calm')}>
        <span><b>{plural(readers.length, 'route')}</b>{' read '}<code>{a.id}</code>{follow.length === readers.length ? ` and follow main, so v${a.main} is live.` : '.'}</span>
        {v.n !== a.main ? <span className="muted">{`You are looking at v${v.n}, not what visitors see.`}</span> : null}
      </div>
    )
  }
  if (!routes.length) {
    return <div className="visit"><span><b>Not routed.</b> No address serves this page yet.</span><Button small onClick={onAddRoute}>Add a route…</Button></div>
  }
  const r = routes.find(x => x.path !== '*') ?? routes[0]
  const label = shortHost(r.host) + r.path
  const point = async () => {
    try {
      await setRoute({ ...r, version: v.n, note: `pinned v${v.n}` }).unwrap()
      toast(`${r.path} now serves v${v.n}${r.version ? ` (was v${r.version}). Roll back on Routes.` : '.'}`)
    } catch (e) { toast(errorText(e), true) }
  }
  return (
    <div className={cx('visit', v.n === r.n && 'calm')} id="wVisit">
      {r.version ? <span><code>{label}</code>{' serves '}<b>{`v${r.n}`}</b>, pinned.</span> : <span><code>{label}</code>{' follows main: '}<b>{`v${r.n}`}</b> is live.</span>}
      {v.n === r.n ? <span className="muted">This is what visitors see.</span> : <>
        <span className="muted">{`You are looking at v${v.n}.`}</span>
        <Button small variant="primary" onClick={point}>{`Point ${label} at v${v.n}`}</Button>
      </>}
      {routes.length > 1 ? <span className="muted">{`+ ${plural(routes.length - 1, 'other route')}`}</span> : null}
    </div>
  )
}

export function Filmstrip({ a, versions, current, routes, ctx, onSelect }: { a: Artifact; versions: Version[]; current: number; routes: RouteView[]; ctx: PreviewContext; onSelect: (n: number) => void }) {
  const by = useVersionBy()
  return (
    <div className="film" id="wFilm">
      <span className="lbl" aria-hidden="true">VERSIONS</span>
      {versions.map((x, i) => {
        const prev = versions[i - 1]
        const flags = routes.filter(r => r.n === x.n).map(r => (r.path === '*' ? '*' : r.path))
        if (x.n === a.main) flags.push('main')
        return (
          <FilmFrame key={x.n} v={x} on={x.n === current} by={by(x)} flags={flags} onSelect={() => onSelect(x.n)}>
            {a.kind === 'data' ? <DataSummary a={a} v={x} prev={prev} /> : <Thumb artifact={a.id} n={x.n} width={132} host={ctx.host} path={ctx.path} />}
          </FilmFrame>
        )
      })}
    </div>
  )
}

function DataSummary({ a, v, prev }: { a: Artifact; v: Version; prev?: Version }) {
  const files = Object.keys(v.files).filter(f => f !== 'slop.json')
  const add = prev ? files.filter(f => !prev.files[f]).length : files.length
  const chg = prev ? files.filter(f => prev.files[f] && prev.files[f].sha256 !== v.files[f].sha256).length : 0
  const gone = prev ? Object.keys(prev.files).filter(f => !v.files[f]).length : 0
  return (
    <div className="dsum">
      {a.type === 'tokens' ? <b>tokens</b> : <b>{files.length}</b>}
      <span>{a.type === 'tokens' ? 'colours and type' : plural(files.length, recWord(a))}</span>
      <span>{prev ? [add ? `+${add} new` : '', chg ? `${chg} changed` : '', gone ? `${gone} removed` : ''].filter(Boolean).join(' · ') || 'no change' : 'first version'}</span>
    </div>
  )
}

export const recWord = (a: Artifact) => (a.type === 'post' ? 'post' : 'record')

// FilesPane lists a version's files and shows one, with the lines changed
// since the previous version.
export function FilesPane({ a, v, prev, file, onFile }: { a: Artifact; v: Version; prev?: Version; file: string; onFile: (f: string) => void }) {
  const names = Object.keys(v.files).sort((x, y) => (x === 'index.html' ? -1 : y === 'index.html' ? 1 : x.localeCompare(y)))
  const cur = v.files[file] ? file : names[0]
  const changed = !!prev && !!prev.files[cur] && prev.files[cur].sha256 !== v.files[cur]?.sha256
  const text = useFileQuery({ id: a.id, n: v.n, path: cur }, { skip: !cur })
  const before = useFileQuery({ id: a.id, n: prev?.n ?? 0, path: cur }, { skip: !changed })
  const diff = useMemo(() => {
    if (!changed || text.data == null || before.data == null) return null
    const a1 = before.data.split('\n'), b1 = text.data.split('\n'), sa = new Set(a1), sb = new Set(b1)
    return { added: b1.filter(l => !sa.has(l)), removed: a1.filter(l => !sb.has(l)) }
  }, [changed, text.data, before.data])
  const body = text.data ?? ''
  return (
    <>
      <div className="pane-head"><h2>{`v${v.n} · ${plural(names.length, 'file')}`}</h2><span className="note">A version is a file tree. Files that did not change are shared, by hash.</span></div>
      <div className="files" style={{ flex: 'none', maxHeight: '38%', overflow: 'auto', borderBottom: '1px solid var(--hair)' }}>
        {names.map(f => {
          const p = prev?.files[f]
          return (
            <button type="button" key={f} className={cx('frow', f === cur && 'on')} onClick={() => onFile(f)}>
              <code>{f}</code><span>{kb(v.files[f].size)}</span><span>{v.files[f].sha256.slice(0, 8)}</span>
              <span>{!prev ? 'first version' : !p ? 'new' : p.sha256 === v.files[f].sha256 ? `same as v${prev.n}` : 'changed'}</span>
            </button>
          )
        })}
        {prev ? Object.keys(prev.files).filter(f => !v.files[f]).map(f => (
          <div key={f} className="frow"><code style={{ textDecoration: 'line-through', color: 'var(--ink-2)' }}>{f}</code><span /><span /><span>removed</span></div>
        )) : null}
      </div>
      {diff ? (
        <pre className="diff" aria-label={`Changes since v${prev!.n}`}>
          {diff.removed.slice(0, 40).map((l, i) => <div key={'r' + i} className="dr">{l.slice(0, 400)}</div>)}
          {diff.added.slice(0, 60).map((l, i) => <div key={'a' + i} className="da">{l.slice(0, 400)}</div>)}
          {diff.added.length + diff.removed.length > 100 ? <div className="muted">{`… ${diff.added.length + diff.removed.length - 100} more changed lines`}</div> : null}
        </pre>
      ) : null}
      <div className="scroll"><pre className="src">{body.length > 60000 ? body.slice(0, 60000) + '\n…' : body}</pre></div>
    </>
  )
}

