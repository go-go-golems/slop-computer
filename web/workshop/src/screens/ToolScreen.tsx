import { useEffect, useRef, useState } from 'react'
import { errorText, useDisableToolMutation, useEnableToolMutation, useGrantToolMutation, useSandboxUrlQuery, useToolsQuery } from '../api/slopApi'
import type { ToolView } from '../api/types'
import { boot, isSandboxOrigin } from '../app/boot'
import { ago } from '../app/format'
import { useNames } from '../app/hooks'
import { navigate, toolPath, watchPath } from '../app/router'
import { toast } from '../app/store'
import { Button, Empty, IconButton, Tag } from '../components/atoms'

// Renew the grant well before its hour is up.
const RENEW_MS = 45 * 60 * 1000

// toolArgs are the query of /tools/<id>?…, less the Workshop's own try:
// what the tool should open (Pinup: ?file=<design>). They are display state
// for the tool, not authority; the grant decides what it may do.
export function toolArgs(q: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  q.forEach((v, k) => { if (k !== 'try') out[k] = v })
  return out
}

// ToolScreen runs a tool in an iframe on the sandbox domain. The chrome
// around it (version, try, update, disable) belongs to the Workshop, so a
// broken or hostile tool cannot hide the way out.
export function ToolScreen({ id, tryN, args = {} }: { id: string; tryN?: number; args?: Record<string, string> }) {
  const { data, isLoading } = useToolsQuery()
  const [dialog, setDialog] = useState<number | null>(null)
  const [disable] = useDisableToolMutation()
  const name = useNames()
  const t = data?.tools.find(x => x.artifact === id)
  if (isLoading) return <div className="boot">Loading…</div>
  if (!t) return <div className="split"><section className="tile main"><Empty>{`${id} is not a tool: its slop.json has no "tool" section.`}</Empty></section></div>
  const enabled = t.enabled
  const n = tryN ?? enabled?.version
  const trying = tryN != null && tryN !== enabled?.version
  const newer = t.latest.n > (enabled?.version ?? 0) && !t.latest.error

  return (
    <div className="split">
      <section className="tile main">
        <div className="toolbar">
          <div className="addr label"><span>tool</span><span className="ro">{t.latest.title || enabled?.title || id}</span></div>
          {enabled ? <Tag tone="ink">{`enabled v${enabled.version}`}</Tag> : <Tag tone="red">not enabled</Tag>}
          {trying ? <Tag tone="red">{`trying v${tryN} · only you`}</Tag> : null}
          <span className="sp" />
          {newer && tryN !== t.latest.n ? <Button onClick={() => navigate(toolPath(id, t.latest.n))}>{`Try v${t.latest.n}`}</Button> : null}
          {trying && enabled ? <Button onClick={() => navigate(toolPath(id))}>{`Back to v${enabled.version}`}</Button> : null}
          {newer ? <Button variant="primary" onClick={() => setDialog(t.latest.n)}>{enabled ? `Update to v${t.latest.n}…` : `Enable v${t.latest.n}…`}</Button> : null}
          {enabled ? <Button variant="danger" onClick={async () => {
            try { await disable(id).unwrap(); toast(`${t.latest.title || id} is disabled; its grants are revoked.`) } catch (e) { toast(errorText(e), true) }
          }}>Disable</Button> : null}
          <Button onClick={() => navigate(watchPath(id, n))}>Watch the code</Button>
        </div>
        <div className="visit calm">
          {enabled
            ? <span>{`Enabled by ${name(enabled.enabledBy)} ${ago(enabled.enabledAt)} with `}{enabled.permissions.map(p => <code key={p} style={{ marginRight: 6 }}>{p}</code>)}</span>
            : <span>{`This tool is not enabled. Try it (only you get access), then enable it for everyone.`}</span>}
          {t.latest.error ? <span className="muted" style={{ color: 'var(--accent)' }}>{`v${t.latest.n}: ${t.latest.error}`}</span> : null}
        </div>
        <div className="tilebody">
          {n ? <ToolFrame key={`${id}@${n}`} id={id} n={n} trying={trying} args={args} />
            : <Empty>{`Try v${t.latest.n} to see it; enabling it then lets everyone open it from the Tools menu.`}</Empty>}
        </div>
      </section>
      {dialog != null ? <EnableToolDialog t={t} n={dialog} permissions={data!.permissions} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

// ToolFrame loads one tool version and answers its hello with a grant,
// renewed while it is open. Without a grant the tool can do nothing.
function ToolFrame({ id, n, trying, args }: { id: string; n: number; trying: boolean; args: Record<string, string> }) {
  const { data: sb, isError } = useSandboxUrlQuery({ artifact: id, n, mode: 'tool' })
  const frame = useRef<HTMLIFrameElement>(null)
  const [grantTool] = useGrantToolMutation()
  const [problem, setProblem] = useState('')
  const argsRef = useRef(args)
  argsRef.current = args

  useEffect(() => {
    if (!sb) return
    let renew: ReturnType<typeof setInterval> | undefined
    const give = async () => {
      try {
        const g = await grantTool({ id, n, try: trying }).unwrap()
        const cfg = boot().config
        frame.current?.contentWindow?.postMessage({ slop: 1, type: 'grant', grant: g.grant, expiresAt: g.expiresAt, permissions: g.permissions, user: g.user,
          people: g.people ?? {}, args: argsRef.current, config: { siteHosts: cfg.siteHosts, publicUrl: cfg.publicUrl } }, sb.origin)
        setProblem('')
      } catch (e) {
        setProblem(errorText(e))
      }
    }
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || !isSandboxOrigin(e.origin) || e.origin !== sb.origin) return
      const m = e.data as { slop?: number; type?: string; args?: Record<string, unknown> } | null
      if (m && m.slop === 1 && m.type === 'tool-args') {
        // The tool chose what it shows (Pinup: a design); keep it in the URL.
        const q = new URLSearchParams(location.search)
        for (const k of [...q.keys()]) if (k !== 'try') q.delete(k)
        for (const [k, v] of Object.entries(m.args ?? {})) if (typeof v === 'string' && v) q.set(k, v)
        const s = q.toString()
        history.replaceState(history.state, '', location.pathname + (s ? '?' + s : ''))
        argsRef.current = toolArgs(q)
        return
      }
      if (!m || m.slop !== 1 || m.type !== 'tool-hello') return
      void give()
      clearInterval(renew)
      renew = setInterval(give, RENEW_MS)
    }
    window.addEventListener('message', on)
    return () => { window.removeEventListener('message', on); clearInterval(renew) }
  }, [sb, id, n, trying, grantTool])

  return (
    <div className="stage" style={{ padding: 0 }}>
      {sb ? <iframe ref={frame} src={sb.url} title={`Tool ${id} v${n}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" allow="clipboard-read; clipboard-write" style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} /> : null}
      {isError ? <Empty>The tool could not be opened.</Empty> : null}
      {problem ? <div className="pickhint" style={{ background: 'var(--accent)' }}>{`No grant: ${problem}`}</div> : null}
    </div>
  )
}

// EnableToolDialog lists what a tool version may do, in plain words, with
// the permissions it asks for beyond the enabled version marked.
function EnableToolDialog({ t, n, permissions, onClose }: { t: ToolView; n: number; permissions: Record<string, string>; onClose: () => void }) {
  const [enable, { isLoading }] = useEnableToolMutation()
  const asks = t.latest.permissions ?? []
  const fresh = new Set(t.latest.newPermissions)
  const go = async () => {
    try {
      await enable({ id: t.artifact, n }).unwrap()
      toast(`${t.latest.title} v${n} is enabled for everyone.`)
      onClose()
      // Keep what the tool was showing (?file=…), drop the try.
      const q = new URLSearchParams(toolArgs(new URLSearchParams(location.search))).toString()
      navigate(toolPath(t.artifact) + (q ? '?' + q : ''))
    } catch (e) { toast(errorText(e), true) }
  }
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog" role="dialog" aria-label="Enable tool">
        <header><h2>{`${t.enabled ? 'Update' : 'Enable'} ${t.latest.title} v${n}`}</h2><IconButton aria-label="Close" onClick={onClose}>×</IconButton></header>
        <div className="form">
          <p style={{ margin: 0 }}>{`Everyone who opens it from the Tools menu lets it act as them, for an hour at a time, with ${asks.length ? 'these permissions' : 'no permissions at all'}:`}</p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {asks.map(p => (
              <li key={p}><code>{p}</code>{' — '}{permissions[p] ?? p}{fresh.has(p) && t.enabled ? <> <Tag tone="red">new</Tag></> : null}</li>
            ))}
          </ul>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>A tool can never see or change people, tokens, the audit log or other tools. Everything it changes is logged as “tool {t.artifact}@{n}” and can be undone. Disable it any time.</p>
        </div>
        <footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading} onClick={go}>{t.enabled ? `Update to v${n}` : `Enable v${n}`}</Button></footer>
      </div>
    </div>
  )
}
