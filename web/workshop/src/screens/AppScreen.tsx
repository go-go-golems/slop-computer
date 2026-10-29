import { useEffect, useRef, useState } from 'react'
import {
  errorText, useAppsQuery, useApproveAppMutation, useArtifactsQuery, useCloseViewMutation, useConsentViewMutation,
  useCreateThreadMutation, useOpenViewMutation, useRenewViewMutation,
} from '../api/slopApi'
import type { AppInfo, ViewInfo } from '../api/types'
import { isSandboxOrigin } from '../app/boot'
import { navigate, runPath, watchPath } from '../app/router'
import { toast } from '../app/store'
import { Button, Empty, IconButton, Tag } from '../components/atoms'

// Renew the view's secret well before its hour is up.
const RENEW_MS = 45 * 60 * 1000

// What the page asks the shell for; each answer carries the same id.
type Ask =
  | { kind: 'consent'; id: string; names: string[] }
  | { kind: 'download'; id: string; filename: string; data: Blob }
  | { kind: 'compose'; id: string; anchor: unknown; text: string }
  | { kind: 'permissions'; id: string }

// AppScreen runs an app against a target: the view is opened here with the
// session, its secret goes to the frame by postMessage (never in a URL),
// and the frame's requests for consent, downloads and the composer are
// answered by the Workshop's own dialogs, which the page cannot fake.
export function AppScreen({ target, version, args }: { target: string; version?: number; args: Record<string, string> }) {
  const { data: arts } = useArtifactsQuery()
  const { data: apps } = useAppsQuery()
  const t = arts?.find(a => a.id === target)
  const appId = t ? t.app || t.id : undefined
  const app = apps?.find(a => a.artifact === appId)
  const [view, setView] = useState<ViewInfo | null>(null)
  const [problem, setProblem] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [approving, setApproving] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const viewRef = useRef<ViewInfo | null>(null)
  const [openView] = useOpenViewMutation()
  const [renewView] = useRenewViewMutation()
  const [closeView] = useCloseViewMutation()
  const [consentView] = useConsentViewMutation()
  const [createThread] = useCreateThreadMutation()

  useEffect(() => {
    if (!t) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const post = (m: Record<string, unknown>) => {
      const v = viewRef.current
      if (v) frame.current?.contentWindow?.postMessage({ ...m, slop: 1 }, v.origin)
    }
    const give = () => {
      const v = viewRef.current
      if (v) post({ type: 'view', view: v.view, secret: v.secret, expiresAt: v.expiresAt })
    }
    const open = async () => {
      try {
        const v = await openView({ target, version }).unwrap()
        if (cancelled) { closeView(v.view); return }
        viewRef.current = v
        setView(v)
        setProblem('')
      } catch (e) { setProblem(errorText(e)) }
    }
    // Renew the secret; a view the server forgot (a restart) is reopened.
    const renew = async () => {
      const v = viewRef.current
      if (!v) return
      try {
        const r = await renewView(v.view).unwrap()
        viewRef.current = { ...v, ...r }
      } catch {
        try {
          const nv = await openView({ target, version: v.version }).unwrap()
          viewRef.current = { ...nv, url: v.url } // keep the frame where it is
        } catch (e) { setProblem(errorText(e)); return }
      }
      give()
    }
    const on = (e: MessageEvent) => {
      const v = viewRef.current
      if (!v || !frame.current || e.source !== frame.current.contentWindow || e.origin !== v.origin || !isSandboxOrigin(e.origin)) return
      const m = e.data as { slop?: number; type?: string; id?: string; [k: string]: unknown } | null
      if (!m || m.slop !== 1) return
      switch (m.type) {
        case 'hello': give(); return
        case 'renew': void renew(); return
        case 'consent': setAsk({ kind: 'consent', id: String(m.id), names: (m.names as string[]) ?? [] }); return
        case 'download':
          if (m.data instanceof Blob) setAsk({ kind: 'download', id: String(m.id), filename: String(m.filename), data: m.data })
          else post({ id: m.id, status: 'declined' })
          return
        case 'compose': setAsk({ kind: 'compose', id: String(m.id), anchor: m.anchor, text: String(m.text ?? '') }); return
        case 'permissions': setAsk({ kind: 'permissions', id: String(m.id) }); return
        case 'navigate':
          if (typeof m.target === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(m.target)) navigate(runPath(m.target))
          return
        case 'args': {
          // The app chose what it shows; keep it in the Workshop's URL.
          const q = new URLSearchParams()
          if (version) q.set('v', String(version))
          for (const [k, val] of Object.entries((m.args as Record<string, unknown>) ?? {})) if (typeof val === 'string' && val && k !== 'v') q.set(k, val)
          const s = q.toString()
          history.replaceState(history.state, '', location.pathname + (s ? '?' + s : ''))
        }
      }
    }
    window.addEventListener('message', on)
    void open()
    timer = setInterval(renew, RENEW_MS)
    return () => {
      cancelled = true
      window.removeEventListener('message', on)
      clearInterval(timer)
      if (viewRef.current) closeView(viewRef.current.view)
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, version, !!t])

  const answer = (m: Record<string, unknown>) => {
    const v = viewRef.current
    if (v) frame.current?.contentWindow?.postMessage({ ...m, slop: 1 }, v.origin)
    setAsk(null)
  }

  if (!arts) return <div className="boot">Loading…</div>
  if (!t) return <div className="split"><section className="tile main"><Empty>{`There is no artifact called ${target}.`}</Empty></section></div>
  const hash = new URLSearchParams(args).toString()
  return (
    <div className="split">
      <section className="tile main">
        <div className="toolbar">
          <div className="addr label"><span>app</span><span className="ro">{app?.title || appId}</span></div>
          {t.id !== appId ? <Tag>{`on ${t.id}`}</Tag> : null}
          {view ? <Tag tone="ink">{`v${view.version} · ${view.level}`}</Tag> : null}
          {view?.asks?.length ? <Tag tone="red">{`slop not approved for v${view.version}`}</Tag> : null}
          <span className="sp" />
          {view?.asks?.length && app ? <Button variant="primary" onClick={() => setApproving(true)}>{`Approve v${view.version}…`}</Button> : null}
          {app && view && app.main > view.version ? <Button onClick={() => navigate(runPath(target))}>{`Open v${app.main}`}</Button> : null}
          <Button onClick={() => navigate(watchPath(appId!, view?.version))}>Watch the code</Button>
        </div>
        <div className="tilebody">
          <div className="stage" style={{ padding: 0 }}>
            {view ? <iframe ref={frame} key={view.url} src={view.url + (hash ? '#' + hash : '')} title={`${appId} on ${t.id}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              allow="clipboard-read; clipboard-write" style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} /> : null}
            {!view && !problem ? <Empty>Opening…</Empty> : null}
            {problem ? <Empty>{`The app could not be opened: ${problem}`}</Empty> : null}
          </div>
        </div>
      </section>
      {ask ? <AskDialog ask={ask} app={appId!} onAnswer={answer} onConsent={async states => {
        const v = viewRef.current
        if (!v) return
        try { await consentView({ view: v.view, states }).unwrap() } catch (e) { toast(errorText(e), true) }
      }} onComment={async (anchor, text) => {
        const v = viewRef.current
        if (!v) return false
        try {
          await createThread({ artifact: v.app, version: v.version, anchor: { ...(anchor as object), target: v.target } as never, text }).unwrap()
          toast('Comment added.')
          return true
        } catch (e) { toast(errorText(e), true); return false }
      }} /> : null}
      {approving && app && view ? <ApproveDialog app={app} n={view.version} onClose={() => setApproving(false)} /> : null}
    </div>
  )
}

function AskDialog({ ask, app, onAnswer, onConsent, onComment }: {
  ask: Ask; app: string
  onAnswer: (m: Record<string, unknown>) => void
  onConsent: (states: Record<string, string>) => Promise<void>
  onComment: (anchor: unknown, text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const close = () => {
    if (ask.kind === 'consent') onAnswer({ id: ask.id, states: Object.fromEntries(ask.names.map(n => [n, 'denied'])) })
    else if (ask.kind === 'download') onAnswer({ id: ask.id, status: 'declined' })
    else if (ask.kind === 'compose') onAnswer({ id: ask.id, opened: false })
    else onAnswer({ id: ask.id })
  }
  let title = '', body = null, ok: (() => Promise<void>) | null = null, okText = ''
  if (ask.kind === 'consent') {
    title = `Allow ${app}?`
    body = <p style={{ margin: 0 }}>{`${app} asks to use ${ask.names.map(n => ({ sample: 'Claude (sample): it sends text you see to a model, as you', comments: 'comments: it writes threads as you' }[n] ?? n)).join('; ')}.`}</p>
    okText = 'Allow'
    ok = async () => {
      const states = Object.fromEntries(ask.names.map(n => [n, 'granted']))
      await onConsent(states)
      onAnswer({ id: ask.id, states })
    }
  } else if (ask.kind === 'download') {
    title = 'Save a file?'
    body = <p style={{ margin: 0 }}>{`${app} offers `}<code>{ask.filename}</code>{` (${Math.max(1, Math.round(ask.data.size / 1024))} KB).`}</p>
    okText = 'Save'
    ok = async () => {
      const url = URL.createObjectURL(ask.data)
      const a = document.createElement('a')
      a.href = url
      a.download = ask.filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      onAnswer({ id: ask.id, status: 'saved' })
    }
  } else if (ask.kind === 'compose') {
    title = 'Comment'
    body = <>
      {ask.text ? <p className="muted" style={{ margin: 0 }}>{`On “${ask.text.slice(0, 120)}”`}</p> : null}
      <textarea autoFocus rows={4} value={text} onChange={e => setText(e.target.value)} style={{ width: '100%' }} />
    </>
    okText = 'Comment'
    ok = async () => { onAnswer({ id: ask.id, opened: true }); if (text.trim()) await onComment(ask.anchor, text.trim()) }
  } else {
    title = `What ${app} may do`
    body = <p style={{ margin: 0 }}>Consents are kept per app; an admin approves the slop permissions of each version from the Apps menu.</p>
  }
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) close() }}>
      <div className="dialog" role="dialog" aria-label={title}>
        <header><h2>{title}</h2><IconButton aria-label="Close" onClick={close}>×</IconButton></header>
        <div className="form">{body}</div>
        <footer><Button onClick={close}>{ok ? 'Cancel' : 'Close'}</Button>{ok ? <Button variant="primary" onClick={() => void ok!()}>{okText}</Button> : null}</footer>
      </div>
    </div>
  )
}

// ApproveDialog lists the slop permissions an app version asks for, in
// plain words. Approval is per version; the app reopens with them.
export function ApproveDialog({ app, n, onClose }: { app: AppInfo; n: number; onClose: () => void }) {
  const [approve, { isLoading }] = useApproveAppMutation()
  const asks = app.permissions ?? []
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-label="Approve app">
        <header><h2>{`Approve ${app.title} v${n}`}</h2><IconButton aria-label="Close" onClick={onClose}>×</IconButton></header>
        <div className="form">
          <p style={{ margin: 0 }}>{`Whoever opens it lets it call slop as them, with ${asks.length ? 'these permissions' : 'no permissions at all'}:`}</p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {asks.map(p => <li key={p}><code>{p}</code>{' — '}{app.labels[p] ?? p}</li>)}
          </ul>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>{`An app never sees or changes people, tokens or the audit log. Everything it changes is logged as “app ${app.artifact}@${n}”.`}</p>
        </div>
        <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading} onClick={async () => {
          try { await approve({ id: app.artifact, version: n }).unwrap(); toast(`${app.title} v${n} is approved; reopen it to use them.`); onClose(); location.reload() } catch (e) { toast(errorText(e), true) }
        }}>{`Approve v${n}`}</Button></footer>
      </div>
    </div>
  )
}
