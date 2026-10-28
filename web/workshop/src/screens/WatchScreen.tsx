import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThreadsQuery, useVersionsQuery } from '../api/slopApi'
import type { Artifact } from '../api/types'
import { navigate, watchPath } from '../app/router'
import { toast } from '../app/store'
import { usePref, useRoutesUsing, useVersionBy } from '../app/hooks'
import { isAgent } from '../app/format'
import { Avatar, Empty, Tabs } from '../components/atoms'
import { PreviewStage, type Device } from '../components/organisms/PreviewStage'
import { RecordsPane, TokensEditor } from '../components/organisms/DataPanes'
import { CommentsPane, ConsolePane, VersionsPane, threadNumbers, type Pending } from '../components/organisms/WatchLeft'
import { FilesPane, Filmstrip, PageToolbar, VisitLine, DeviceSeg, recWord, usePreviewContext } from '../components/organisms/WatchRight'
import type { FromPreview, Pin } from '../preview/bridge-protocol'
import type { SiteTarget } from './SiteScreen'

type LTab = 'comments' | 'versions' | 'console'
type RTab = 'preview' | 'compare' | 'files' | 'records'

interface Props {
  a: Artifact
  n?: number
  onOpenSite: (t: SiteTarget) => void
  onAddRoute: (page: string) => void
}

// WatchScreen is one artifact: its versions, the comments on them, and the
// route that serves it (prototype app.js renderWatch).
export function WatchScreen({ a, n, onOpenSite, onAddRoute }: Props) {
  const { data: versions = [], isLoading } = useVersionsQuery(a.id)
  const { data: threads = [] } = useThreadsQuery({ artifact: a.id })
  const routes = useRoutesUsing(a.id)
  const by = useVersionBy()
  const [sideW, setSideW] = usePref('sideW', 380)
  const [device, setDevice] = usePref<Device>('device', window.innerWidth < 900 ? 'fit' : 'desktop')
  const [ltab, setLtab] = useState<LTab>('comments')
  const [rtab, setRtab] = useState<RTab>(a.kind === 'data' ? 'records' : 'preview')
  const [picking, setPicking] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [scroll, setScroll] = useState<{ id: string | null; seq: number }>({ id: null, seq: 0 })
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [showResolved, setShowResolved] = useState(false)
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [cmpLeft, setCmpLeft] = useState<number | null>(null)
  const [sample, setSample] = useState<string | null>(null)
  const [rec, setRec] = useState<string | null>(null)
  const [file, setFile] = useState('index.html')

  // A new artifact starts fresh.
  useEffect(() => {
    setRtab(a.kind === 'data' ? 'records' : 'preview')
    setPicking(false); setPending(null); setFocus(null); setSample(null); setRec(null); setCmpLeft(null); setFile('index.html')
  }, [a.id, a.kind])

  const v = (n && versions.find(x => x.n === n)) || versions[versions.length - 1]
  const prev = v ? versions[versions.indexOf(v) - 1] : undefined
  const ctx = usePreviewContext(routes, sample)
  const selectVersion = useCallback((x: number) => {
    const last = versions[versions.length - 1]?.n
    navigate(watchPath(a.id, x === last ? null : x))
  }, [a.id, versions])

  const nums = useMemo(() => threadNumbers(threads), [threads])
  const pins = useMemo<Pin[]>(() => threads.filter(t => t.anchor?.selector && (showResolved || !t.resolved))
    .map(t => ({ id: t.id, n: nums.get(t.id) ?? 0, selector: t.anchor!.selector!, fx: t.anchor!.fx, fy: t.anchor!.fy, resolved: t.resolved, title: t.comments[0]?.text ?? '' })), [threads, nums, showResolved])

  const focusThread = useCallback((id: string, scrollPage: boolean) => {
    setFocus(id)
    setLtab('comments')
    const t = threads.find(x => x.id === id)
    if (t?.resolved) setShowResolved(true)
    if (t?.anchor?.record && a.kind === 'data') setRec(t.anchor.record.split('/').pop()!.replace(/\.[^.]+$/, ''))
    if (scrollPage) setScroll(s => ({ id, seq: s.seq + 1 }))
  }, [threads, a.kind])

  const startPick = useCallback(() => {
    if (a.kind === 'data') {
      if (rec) { setPending({ record: recPath(rec), label: rec }); setLtab('comments') } else toast(`Select a ${recWord(a)} first.`)
      return
    }
    setRtab('preview')
    setPending(null)
    setLtab('comments')
    setPicking(p => !p)
  }, [a, rec, v]) // recPath reads v

  function recPath(id: string) {
    return Object.keys(v?.files ?? {}).find(p => p.split('/').pop()!.replace(/\.[^.]+$/, '') === id) ?? id
  }

  const onMessage = useCallback((m: FromPreview) => {
    if (m.type === 'pick') {
      setPicking(false)
      setPending({ selector: m.selector, fx: m.fx, fy: m.fy, text: m.text, tag: m.tag, styles: m.styles })
      setLtab('comments')
    } else if (m.type === 'pin') focusThread(m.id, false)
    else if (m.type === 'pins') setMissing(new Set(m.missing))
    else if (m.type === 'nav') { onOpenSite({ host: ctx.host, path: m.href, from: ctx.path }); toast(`Opened ${m.href} in Site.`) }
    else if (m.type === 'external') toast('Links to other sites open outside the Workshop: ' + m.href)
  }, [focusThread, onOpenSite, ctx.host, ctx.path])

  // Keys: C comments, Esc cancels.
  const keys = useRef({ startPick, picking, pending })
  keys.current = { startPick, picking, pending }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')
      if (e.key === 'Escape') {
        if (keys.current.picking) setPicking(false)
        else if (keys.current.pending && !typing) setPending(null)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal')) return
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); keys.current.startPick() }
    }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [])

  // The side pane's width is dragged on the gutter.
  const side = useRef<HTMLElement>(null)
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const g = e.currentTarget
    g.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing'); g.classList.add('drag')
    const x0 = e.clientX, w0 = side.current!.getBoundingClientRect().width
    let w = w0
    const move = (ev: PointerEvent) => { w = Math.max(260, Math.min(640, w0 + ev.clientX - x0)); side.current!.style.width = w + 'px' }
    const up = () => { document.body.classList.remove('resizing'); g.classList.remove('drag'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); setSideW(w) }
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up)
  }

  if (isLoading) return <div className="split"><section className="tile main"><Empty>Loading {a.id}…</Empty></section></div>
  if (!v) return <div className="split"><section className="tile main"><Empty>{`${a.id} has no versions yet. Push one: slop push ./folder -a ${a.id}`}</Empty></section></div>

  const open = threads.filter(t => !t.resolved).length
  const isData = a.kind === 'data'
  const rtabs: { key: RTab; label: string }[] = isData
    ? [{ key: 'records', label: a.type === 'tokens' ? 'Tokens' : a.type === 'post' ? 'Posts' : 'Records' }, { key: 'files', label: 'Files' }]
    : [{ key: 'preview', label: 'Preview' }, { key: 'compare', label: 'Compare' }, { key: 'files', label: 'Files' }]
  const tab = rtabs.some(t => t.key === rtab) ? rtab : rtabs[0].key
  const canPoint = isData ? !!rec && a.type !== 'tokens' : tab === 'preview'
  const pointLabel = isData ? (rec ? `Comment on ${rec}` : `Select a ${recWord(a)} to comment on it`) : tab === 'preview' ? 'Comment on the page' : 'Open Preview to comment'
  const left = cmpLeft ?? Math.max(1, v.n - 1)
  const openSite = (host: string, path: string) => onOpenSite({ host, path })
  // After a save the newest version is the one to look at.
  const saved = () => navigate(watchPath(a.id))

  let body
  if (tab === 'files') body = <FilesPane a={a} v={v} prev={prev} file={file} onFile={setFile} />
  else if (tab === 'records') body = a.type === 'tokens'
    ? <TokensEditor a={a} v={v} device={device} onSaved={saved} />
    : <RecordsPane a={a} v={v} rec={rec} device={device} onRec={setRec} onSaved={saved} onOpenSite={openSite} />
  else if (tab === 'compare') {
    const pane = (x: number) => {
      const xv = versions.find(q => q.n === x)
      return (
        <div key={x}>
          <div className="cmphead">{xv ? <Avatar name={by(xv)} agent={isAgent(xv.via)} /> : null}<b>{`v${x}`}</b><span className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{xv?.message}</span></div>
          <div className="cmpstage"><PreviewStage artifact={a.id} n={x} host={ctx.host} path={ctx.path} device={device} className="cmp-inner" /></div>
        </div>
      )
    }
    body = <div className="stage" style={{ padding: 12 }}><div className="cmp">{pane(left)}{pane(v.n)}</div></div>
  } else {
    body = <PreviewStage artifact={a.id} n={v.n} host={ctx.host} path={ctx.path} device={device} picking={picking} pins={pins} focus={focus}
      scrollTo={scroll.id} scrollSeq={scroll.seq} onMessage={onMessage} title={`Preview of ${a.id} v${v.n}`} />
  }

  return (
    <div className="split">
      <section className="tile side" id="wSide" ref={side} style={{ width: sideW }}>
        <div className="dstrip">
          <Tabs value={ltab} onChange={setLtab} tabs={[{ key: 'comments', label: 'Comments', count: open, bad: true }, { key: 'versions', label: 'Versions', count: versions.length }, { key: 'console', label: 'Console' }]} />
        </div>
        <div className="tilebody" id="wLeft">
          {ltab === 'versions' ? <VersionsPane a={a} versions={versions} current={v.n} routes={routes} onSelect={selectVersion} />
            : ltab === 'console' ? <ConsolePane />
              : <CommentsPane a={a} v={v} threads={threads} pending={pending} picking={picking} canPoint={canPoint} pointLabel={pointLabel}
                focus={focus} missing={tab === 'preview' ? missing : new Set()} showResolved={showResolved} replyOpen={replyOpen}
                onStartPick={startPick} onCancel={() => setPending(null)} onPosted={t => { setPending(null); setFocus(t.id) }}
                onFocus={id => focusThread(id, true)} onSeeVersion={selectVersion} onShowResolved={setShowResolved} onReplyOpen={setReplyOpen} />}
        </div>
      </section>
      <div className="gutter" role="separator" aria-orientation="vertical" aria-label="Resize" onPointerDown={drag} />
      <section className="tile main">
        <div className="dstrip"><Tabs value={tab} onChange={k => { setRtab(k); setPicking(false) }} tabs={rtabs} /></div>
        {isData
          ? <div className="toolbar" id="wTool"><div className="addr"><span>{a.type}</span><span className="ro">{a.type === 'tokens' ? 'tokens.json' : `v${v.n}`}</span></div>{tab === 'records' ? <DeviceSeg device={device} onChange={setDevice} /> : null}</div>
          : <PageToolbar a={a} versions={versions} v={v} ctx={ctx} rtab={tab} device={device} cmpLeft={left} onDevice={setDevice} onSample={setSample} onCmpLeft={setCmpLeft} onOpenSite={openSite} />}
        <VisitLine a={a} v={v} routes={routes} onAddRoute={() => onAddRoute(a.id)} />
        <div className="tilebody" id="wRight">{body}</div>
        <Filmstrip a={a} versions={versions} current={v.n} routes={routes} onSelect={selectVersion} />
      </section>
    </div>
  )
}
