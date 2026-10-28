import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Agent, Thread, Version } from '../../api/types'
import { ago, cx, isAgent, plural } from '../../app/format'
import { Avatar, Button, LinkButton, Tag } from '../atoms'

// Molecules render one slop object from props; they do not fetch.

export function VersionAvatar({ v, by, large }: { v: Pick<Version, 'by' | 'via'>; by: string; large?: boolean }) {
  return <Avatar name={by} agent={isAgent(v.via)} large={large} title={by} />
}

// ThreadItem is one comment thread with its replies and actions.
export function ThreadItem(props: {
  t: Thread
  num: number
  focused: boolean
  gone: boolean
  currentN: number
  name: (id: string) => string
  agents: Agent[]
  replyOpen: boolean
  onFocus: () => void
  onSeeVersion: (n: number) => void
  onReplyOpen: (open: boolean) => void
  onReply: (text: string) => void
  onResolve: () => void
}) {
  const { t, num, name } = props
  const onPage = !!t.anchor?.selector
  return (
    <div className={cx('thread', props.focused && 'focus', t.resolved && 'resolved')} id={'th-' + t.id}>
      <div className="th-h">
        <button type="button" className="pinno" title="Show on the page" onClick={props.onFocus}>{num}</button>
        <span>{`${name(t.by)} · on v${t.version} · ${ago(t.at)}`}</span>
        <span className="sp" />
        {t.resolved ? <Tag>resolved</Tag> : null}
      </div>
      <button type="button" className={cx('anchor', props.gone && 'gone')} onClick={props.onFocus} title="Show on the page">
        {onPage ? t.anchor!.selector : t.anchor?.record ? t.anchor.record + (t.anchor.field ? ' · ' + t.anchor.field : '') : 'the page'}
      </button>
      {props.gone ? <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{`Not found in v${props.currentN}: the element changed or went away.`}</span> : null}
      {t.comments.map(c => (
        <div key={c.id} className={cx('cm', c.agent && 'agent')}>
          <Avatar name={name(c.by)} agent={c.agent} />
          <div className="who">
            <b>{c.agent ? agentName(props.agents, c.by, name) : name(c.by)}</b>
            <span>{ago(c.at)}</span>
            {c.version ? <LinkButton onClick={() => props.onSeeVersion(c.version!)}>{`see v${c.version}`}</LinkButton> : null}
          </div>
          <div className="txt">{c.text}</div>
        </div>
      ))}
      {props.replyOpen ? <ReplyBox onSend={props.onReply} onCancel={() => props.onReplyOpen(false)} /> : null}
      <div className="th-act">
        <LinkButton onClick={() => props.onReplyOpen(true)}>Reply</LinkButton>
        <LinkButton onClick={props.onResolve}>{t.resolved ? 'Reopen' : 'Resolve'}</LinkButton>
      </div>
    </div>
  )
}

const agentName = (agents: Agent[], by: string, name: (id: string) => string) =>
  agents.find(a => a.user === by)?.name ?? `${name(by)}’s agent`

function ReplyBox({ onSend, onCancel }: { onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const send = () => { if (text.trim()) onSend(text.trim()) }
  return (
    <div style={{ paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea ref={ref} className="inp" rows={2} placeholder="Reply" aria-label="Reply" style={{ width: '100%' }} value={text}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
      <div className="row">
        <Button small variant="primary" onClick={send}>Reply</Button>
        <Button small onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// Composer is the comment box for a picked element or record.
export function Composer({ what, onPost, onCancel }: { what: ReactNode; onPost: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const post = () => { if (text.trim()) onPost(text.trim()); else ref.current?.focus() }
  return (
    <div className="composer live">
      <div className="on-what">{what}</div>
      <textarea ref={ref} id="cmtText" placeholder="What should change?" aria-label="Comment" value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); if (e.key === 'Escape') onCancel() }} />
      <div className="row">
        <Button variant="primary" onClick={post}>Post</Button>
        <Button onClick={onCancel}>Cancel</Button>
        <span className="sp" />
        <span className="note">⌘↩ posts</span>
      </div>
    </div>
  )
}

// VersionRow is one version in the Versions pane.
export function VersionRow({ v, on, by, tags, onSelect }: { v: Version; on: boolean; by: string; tags: ReactNode[]; onSelect: () => void }) {
  const files = Object.keys(v.files).length
  return (
    <div className={cx('hrow', on && 'on')}>
      <VersionAvatar v={v} by={by} large />
      <button type="button" className="ht" onClick={onSelect}>
        <b>{`v${v.n}`}</b>
        <span className="msg">{v.message}</span>
        <small>{`${by} · ${ago(v.at)} · ${plural(files, 'file')}${v.session ? ' · ' + v.session : ''}`}</small>
        {tags.length ? <span className="tags">{tags}</span> : null}
      </button>
    </div>
  )
}

// FilmFrame is one version in the filmstrip.
export function FilmFrame({ v, on, by, flags, children, onSelect }: { v: Version; on: boolean; by: string; flags: string[]; children: ReactNode; onSelect: () => void }) {
  return (
    <button type="button" className={cx('frame', on && 'on')} data-n={v.n} title={`v${v.n} · ${v.message}`} onClick={onSelect}>
      <div className="shot">
        {children}
        {flags.map(f => <span key={f} className={cx('flag', f === 'main' && 'main')}>{f}</span>)}
      </div>
      <span className="meta"><VersionAvatar v={v} by={by} /><b>{'v' + v.n}</b><span>{ago(v.at)}</span></span>
    </button>
  )
}
