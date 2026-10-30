import { useState, type ReactNode } from 'react'
import { errorText, useAccessQuery, useCreateLinkMutation, usePutGrantMutation, useRemoveGrantMutation, useRevokeLinkMutation, useUsersQuery } from '../../api/slopApi'
import type { AccessLink, Artifact } from '../../api/types'
import { ago, until } from '../../app/format'
import { toast } from '../../app/store'
import { Button, Empty, Seg, Select } from '../atoms'

// Access (SLOP-011): who may open a target on live routes, and who has it
// open now. The same answers as `slop access ls`.

const LEVELS = ['view', 'interact', 'admin', 'owner'].map(l => ({ value: l, label: l }))
const EVERYONE = [
  { value: '*signed-in', label: 'Everyone signed in' },
  { value: '*anyone', label: 'Anyone, guests too' },
]

const linkState = (l: AccessLink) => (l.revokedAt ? 'revoked' : l.expiresAt ? (until(l.expiresAt) === 'expired' ? 'expired' : `until ${l.expiresAt.slice(0, 10)}`) : 'no expiry')

// liveApp reports whether an artifact can run on a live route: an app's
// data, or an app (a page that declares capabilities).
export const liveApp = (a: Artifact, manifest?: Record<string, unknown> | null) =>
  (a.kind === 'data' && !!a.app) || (a.kind === 'page' && !!manifest && 'capabilities' in manifest)

// OpenLive links to the first live route that opens a target.
export function OpenLive({ target }: { target: string }) {
  const { data } = useAccessQuery(target)
  const r = data?.routes[0]
  return r ? <Button onClick={() => window.open(r.url, '_blank', 'noopener')}>Open live</Button> : null
}

// Item is one line of the pane: what, its controls, and a quieter detail.
function Item({ main, side, detail }: { main: ReactNode; side?: ReactNode; detail?: string }) {
  return <div className="acc-item"><span className="acc-main">{main}</span>{side ? <span className="acc-side">{side}</span> : null}{detail ? <span className="dim acc-detail">{detail}</span> : null}</div>
}

export function AccessPane({ a }: { a: Artifact }) {
  const { data, error, isLoading } = useAccessQuery(a.id, { pollingInterval: 15000 })
  const { data: users = [] } = useUsersQuery()
  const [putGrant] = usePutGrantMutation()
  const [removeGrant] = useRemoveGrantMutation()
  const [createLink] = useCreateLinkMutation()
  const [revokeLink] = useRevokeLinkMutation()
  const [who, setWho] = useState('*signed-in')
  const [level, setLevel] = useState('view')
  const [linkLevel, setLinkLevel] = useState<'view' | 'interact'>('view')
  const [days, setDays] = useState('30')
  const [made, setMade] = useState<string[] | null>(null)

  if (isLoading) return <Empty>Loading who has access…</Empty>
  if (error || !data) return <Empty>{errorText(error)}</Empty>

  const run = async (p: Promise<unknown>, done: string) => {
    try { await p; toast(done) } catch (e) { toast(errorText(e), true) }
  }
  const people = users.filter(u => u.role === 'admin' || u.role === 'member').map(u => ({ value: u.id, label: `${u.name} (${u.role})` }))
  const grant = (subject: string, l: string, name: string) => run(putGrant({ target: a.id, subject, level: l }).unwrap(), `${name} may ${l} ${a.id}.`)
  const live = data.links.filter(l => !l.revokedAt)

  return (
    <div className="det">
      <div className="box">
        <h4>Live</h4>
        {data.routes.length
          ? data.routes.map(r => <Item key={r.url} main={<a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>} detail={`for ${r.access === 'public' ? 'anyone' : r.access}`} />)
          : <span className="dim">{`No live route opens ${a.id}. In Routes, set a route of ${data.app || a.id} to run as a live app.`}</span>}
      </div>

      <div className="box">
        <h4>Who may open it</h4>
        {data.owner ? <Item main={<b>{data.owner.name || data.owner.id}</b>} side="owner" detail="created it" /> : null}
        {data.grants.map(g => (
          <Item key={g.subject} main={<b>{g.name || g.subject}</b>} detail={g.via ? `by link ${g.via}` : `granted ${ago(g.createdAt)}`} side={<>
            <Select aria-label={`Level of ${g.name || g.subject}`} value={g.level} options={LEVELS} onChange={l => grant(g.subject, l, g.name || g.subject)} />
            <Button small onClick={() => run(removeGrant({ target: a.id, subject: g.subject }).unwrap(), `${g.name || g.subject} lost access to ${a.id}.`)}>Remove</Button>
          </>} />
        ))}
        {!data.owner && !data.grants.length ? <span className="dim">Admins only.</span> : null}
        <div className="row">
          <Select aria-label="Who" value={who} options={[...EVERYONE, ...people]} onChange={setWho} />
          <Select aria-label="Level" value={level} options={LEVELS} onChange={setLevel} />
          <Button small variant="primary" onClick={() => grant(who, level, [...EVERYONE, ...people].find(o => o.value === who)?.label ?? who)}>Grant</Button>
        </div>
        <span className="dim">Members get at most admin, guests at most interact. Models and publishing stay with admins.</span>
      </div>

      <div className="box">
        <h4>Share links</h4>
        {live.map(l => (
          <Item key={l.id} main={<code>{l.id}</code>} detail={`${l.level} · ${linkState(l)} · made ${ago(l.createdAt)}`}
            side={<Button small onClick={() => run(revokeLink({ target: a.id, id: l.id }).unwrap(), `${l.id} no longer works, and the access it gave is gone.`)}>Revoke</Button>} />
        ))}
        <div className="row">
          <Seg small label="What the link gives" value={linkLevel} onChange={setLinkLevel} options={[['view', 'view'], ['interact', 'interact']]} />
          <Select aria-label="Expires" value={days} onChange={setDays} options={[['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['0', 'never']].map(([value, label]) => ({ value, label }))} />
          <Button small variant="primary" onClick={async () => {
            try { setMade((await createLink({ target: a.id, level: linkLevel, days: +days }).unwrap()).urls) } catch (e) { toast(errorText(e), true) }
          }}>Make a link</Button>
        </div>
        {made ? (made.length
          ? made.map(u => <div key={u} className="row"><span className="secret">{u}</span><Button small onClick={() => run(navigator.clipboard.writeText(u), 'Link copied.')}>Copy</Button></div>)
          : <span className="dim">The link works once a live route opens this; it is shown only now.</span>) : null}
      </div>

      <div className="box">
        <h4>Open now</h4>
        {data.views.length
          ? data.views.map(v => <Item key={v.view} main={<b>{v.name}</b>} side={v.level} detail={`${v.kind} · since ${ago(v.since)}`} />)
          : <span className="dim">Nobody has it open.</span>}
      </div>
    </div>
  )
}
