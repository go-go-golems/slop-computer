import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { errorText, useAgentsQuery, useCreateThreadMutation, useReplyMutation, useResolveThreadMutation } from '../../api/slopApi'
import type { Agent, Anchor, Artifact, RouteView, Thread, Version } from '../../api/types'
import { useAppSelector, toast } from '../../app/store'
import { clock, plural } from '../../app/format'
import { shortHost, useNames, useVersionBy } from '../../app/hooks'
import { Button, Tag, Toggle } from '../atoms'
import { Composer, ThreadItem, VersionRow } from '../molecules'

// threadNumbers numbers threads by age, as pins on the page show them.
export function threadNumbers(threads: Thread[]): Map<string, number> {
  const m = new Map<string, number>()
  threads.slice().sort((x, y) => x.at.localeCompare(y.at)).forEach((t, i) => m.set(t.id, i + 1))
  return m
}

// listenerFor is the agent waiting on comments for this artifact, if any.
export function listenerFor(agents: Agent[] | undefined, a: Artifact): Agent | undefined {
  return (agents ?? []).find(x => x.artifact === a.id || (x.project && x.project === a.project) || (!x.artifact && !x.project))
}

export interface Pending extends Anchor { label?: string }

interface CommentsProps {
  a: Artifact
  v: Version
  threads: Thread[]
  pending: Pending | null
  picking: boolean
  canPoint: boolean
  pointLabel: string
  focus: string | null
  missing: Set<string>
  showResolved: boolean
  replyOpen: string | null
  onStartPick: () => void
  onCancel: () => void
  onPosted: (t: Thread) => void
  onFocus: (id: string) => void
  onSeeVersion: (n: number) => void
  onShowResolved: (on: boolean) => void
  onReplyOpen: (id: string | null) => void
}

export function CommentsPane(p: CommentsProps) {
  const name = useNames()
  const { data: agents = [] } = useAgentsQuery()
  const [createThread] = useCreateThreadMutation()
  const [reply] = useReplyMutation()
  const [resolve] = useResolveThreadMutation()
  const { a, v } = p
  const nums = useMemo(() => threadNumbers(p.threads), [p.threads])
  const resolvedCount = p.threads.filter(t => t.resolved).length
  const list = p.threads.filter(t => p.showResolved || !t.resolved).slice()
    .sort((x, y) => Number(x.resolved) - Number(y.resolved) || y.at.localeCompare(x.at))
  const listener = listenerFor(agents, a)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (p.focus) document.getElementById('th-' + p.focus)?.scrollIntoView({ block: 'nearest' })
  }, [p.focus])

  const post = async (text: string) => {
    if (!p.pending) return
    const { label: _label, ...anchor } = p.pending
    try {
      const t = await createThread({ artifact: a.id, version: v.n, anchor, text }).unwrap()
      p.onPosted(t)
      toast(listener ? `Posted. ${listener.name} picks it up from slop comments wait.` : 'Comment posted.')
    } catch (e) {
      toast(errorText(e), true)
    }
  }

  let composer: ReactNode
  if (p.pending) {
    const pd = p.pending
    composer = (
      <Composer key={pd.selector ?? pd.record} onPost={post} onCancel={p.onCancel} what={<>
        <span>{`On v${v.n} of ${a.id}`}</span>
        <code>{pd.record ?? pd.selector}</code>
        {pd.text ? <span>{'“' + pd.text.slice(0, 70) + (pd.text.length > 70 ? '…' : '') + '”'}</span> : null}
      </>} />
    )
  } else if (p.picking) {
    composer = <div className="composer live"><div className="on-what"><span style={{ color: 'var(--ink)' }}>Click anything on the page to comment on it.</span><span>Esc cancels.</span></div></div>
  } else {
    composer = (
      <div className="composer"><div className="row">
        <Button disabled={!p.canPoint} onClick={p.onStartPick} title="Shortcut: C">{p.pointLabel}</Button>
        {p.canPoint && a.kind === 'page' ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>or press C</span> : null}
        <span className="sp" />
        {resolvedCount ? <Toggle on={p.showResolved} onClick={() => p.onShowResolved(!p.showResolved)}>{`Resolved ${resolvedCount}`}</Toggle> : null}
      </div></div>
    )
  }

  return (
    <>
      {composer}
      <div className="scroll" id="threads" ref={box}>
        {!list.length ? <p className="empty">{a.kind === 'data' ? 'No open threads. Select a record and comment on it.' : 'No open threads. Comment on the page and the agent listening on this project picks it up.'}</p> : null}
        {list.map(t => (
          <ThreadItem key={t.id} t={t} num={nums.get(t.id) ?? 0} focused={p.focus === t.id} gone={!!t.anchor?.selector && p.missing.has(t.id)}
            currentN={v.n} name={name} agents={agents} replyOpen={p.replyOpen === t.id}
            onFocus={() => p.onFocus(t.id)} onSeeVersion={p.onSeeVersion} onReplyOpen={o => p.onReplyOpen(o ? t.id : null)}
            onReply={async text => {
              try { await reply({ thread: t.id, text }).unwrap(); p.onReplyOpen(null) } catch (e) { toast(errorText(e), true) }
            }}
            onResolve={async () => {
              try { await resolve({ thread: t.id, resolved: !t.resolved }).unwrap(); toast(t.resolved ? 'Reopened.' : 'Resolved.') } catch (e) { toast(errorText(e), true) }
            }} />
        ))}
      </div>
      {listener
        ? <div className="listen" id="listen"><span><span className="dot" /><b>{listener.name}</b>{' is waiting'}</span><code>{`slop comments wait ${listener.artifact ? '-a ' + listener.artifact : listener.project ? '-p ' + listener.project : ''}`}</code><span>{`${listener.token ? 'token ' + listener.token + ' · ' : ''}since ${clock(listener.since)}`}</span></div>
        : <div className="listen" id="listen"><span>{'No agent listens on '}<b>{a.project ?? a.id}</b>{'. Comments wait for a person, or for '}<code>slop comments wait</code>.</span></div>}
    </>
  )
}

export function VersionsPane({ a, versions, current, routes, onSelect }: { a: Artifact; versions: Version[]; current: number; routes: RouteView[]; onSelect: (n: number) => void }) {
  const by = useVersionBy()
  return (
    <div className="scroll">
      {versions.slice().reverse().map(x => {
        const tags: ReactNode[] = []
        if (x.n === a.main) tags.push(<Tag key="main" tone="ink">main</Tag>)
        routes.forEach(r => {
          if (r.n === x.n) tags.push(<Tag key={r.host + r.path} tone={r.version ? 'red' : 'ink'}>{shortHost(r.host) + r.path}</Tag>)
        })
        return <VersionRow key={x.n} v={x} on={x.n === current} by={by(x)} tags={tags} onSelect={() => onSelect(x.n)} />
      })}
    </div>
  )
}

export function ConsolePane() {
  const lines = useAppSelector(s => s.ui.console)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [lines])
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [])
  return (
    <div className="console" id="console" aria-live="polite" ref={box}>
      {!lines.length ? <p className="empty">{`Pushes, comments, route changes and waiting agents show up here as they happen (${plural(0, 'line')} so far).`}</p> : null}
      {lines.map(l => (
        <div key={l.id} className={'cl ' + l.kind}>
          <span className="t">{clock(l.at)}</span>
          <span className="x"><span className="w">{l.who}</span><span className="c">{l.text}</span></span>
        </div>
      ))}
    </div>
  )
}
