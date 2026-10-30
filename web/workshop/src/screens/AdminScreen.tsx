import { useState } from 'react'
import { errorText, useAuditQuery, useCreateTokenMutation, useRevokeTokenMutation, useSetRoleMutation, useTokensQuery, useUsersQuery } from '../api/slopApi'
import { boot } from '../app/boot'
import { ago, until } from '../app/format'
import { useNames } from '../app/hooks'
import { toast } from '../app/store'
import { Avatar, Button, Select, Tabs, Tag, Toggle } from '../components/atoms'

type Tab = 'people' | 'tokens' | 'audit'

// AdminScreen: people, tokens and the audit log (prototype app.js renderAdmin).
export function AdminScreen() {
  const [tab, setTab] = useState<Tab>('people')
  const { data: users = [] } = useUsersQuery()
  const pending = users.filter(u => u.role === 'pending').length
  return (
    <div className="split">
      <section className="tile main">
        <div className="dstrip"><Tabs value={tab} onChange={setTab} tabs={[{ key: 'people', label: 'People', count: pending || null, bad: true }, { key: 'tokens', label: 'Tokens' }, { key: 'audit', label: 'Audit log' }]} /></div>
        <div className="tilebody"><div className="scroll">
          {tab === 'people' ? <People /> : tab === 'tokens' ? <Tokens /> : <Audit />}
        </div></div>
      </section>
    </div>
  )
}

function People() {
  const { data: users = [] } = useUsersQuery()
  const [setRole] = useSetRoleMutation()
  const me = boot().me.user.id
  const local = boot().config.mode === 'local'
  const change = async (id: string, name: string, role: string) => {
    try { await setRole({ id, role }).unwrap(); toast(`${name} is now ${role}.`) } catch (e) { toast(errorText(e), true) }
  }
  return <>
    <div className="pane-head"><h2>People</h2><span className="note">{local
      ? 'Local mode: anyone who signs in with a nickname lands here with the local role. There are no plans, no billing and no other roles.'
      : 'Anyone who signs in lands here as pending and sees nothing until an admin lets them in. Admins use the Workshop; members only open the apps shared with them on site hosts.'}</span></div>
    <div className="tablewrap"><table className="rt">
      <thead><tr>{['Name', 'Email', 'Role', 'Last seen', 'Since', ''].map(t => <th key={t}>{t}</th>)}</tr></thead>
      <tbody>
        {users.slice().sort((a, b) => Number(b.role === 'pending') - Number(a.role === 'pending')).map(u => (
          <tr key={u.id}>
            <td><span style={{ marginRight: 8 }}><Avatar name={u.name} /></span>{u.name}{u.id === me ? <span className="muted"> (you)</span> : null}</td>
            <td className="dim">{u.email || (u.issuer === 'local' ? 'local nickname' : '')}</td>
            <td>{u.id === me ? u.role : <Select aria-label={'Role of ' + u.name} value={u.role} onChange={r => change(u.id, u.name, r)} options={['admin', 'member', 'pending', 'disabled'].map(r => ({ value: r, label: r }))} />}</td>
            <td className="dim">{ago(u.lastSeenAt ?? u.lastLoginAt)}</td>
            <td className="dim">{ago(u.createdAt)}</td>
            <td>{u.role === 'pending' ? <span className="tags"><Button small variant="primary" onClick={() => change(u.id, u.name, 'member')}>Let in as member</Button><Button small onClick={() => change(u.id, u.name, 'admin')}>as admin</Button></span> : null}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  </>
}

function Tokens() {
  const { data: tokens = [] } = useTokensQuery()
  const name = useNames()
  const [createToken] = useCreateTokenMutation()
  const [revoke] = useRevokeTokenMutation()
  const [form, setForm] = useState(false)
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null)
  const [tname, setTname] = useState('claude code agent')
  const [scopes, setScopes] = useState({ read: true, write: true, admin: false })
  const [days, setDays] = useState('90')
  const [copied, setCopied] = useState('Copy')
  const create = async () => {
    const sc = Object.entries(scopes).filter(([, on]) => on).map(([k]) => k)
    if (!sc.length) return
    try {
      const out = await createToken({ name: tname.trim() || 'token', scopes: sc, days: +days }).unwrap()
      setSecret({ name: out.info.name, token: out.token }); setForm(false)
    } catch (e) { toast(errorText(e), true) }
  }
  return <>
    <div className="pane-head"><h2>Tokens</h2><span className="note">What the CLI and agents use. slop auth login gets one through the browser, without copying it.</span><span className="sp" />
      <Button small onClick={() => { setForm(!form); setSecret(null) }}>{form ? 'Cancel' : 'New token'}</Button></div>
    {secret ? (
      <div className="box red" style={{ margin: 12 }}>
        <h4>{`${secret.name}: copy it now, it is shown once`}</h4>
        <div className="secret">{secret.token}</div>
        <div className="row">
          <Button small onClick={() => navigator.clipboard.writeText(secret.token).then(() => setCopied('Copied'), () => setCopied('Select it and copy'))}>{copied}</Button>
          <code>{`slop auth login --with-token --server ${boot().config.publicUrl} < token.txt`}</code>
        </div>
      </div>
    ) : null}
    {form ? (
      <div className="box" style={{ margin: 12 }}>
        <h4>New token</h4>
        <div className="kv">
          <span>Name</span><input className="inp" id="tokName" value={tname} onChange={e => setTname(e.target.value)} />
          <span>Scopes</span><div className="row">{(Object.keys(scopes) as (keyof typeof scopes)[]).map(k => <Toggle key={k} on={scopes[k]} onClick={() => setScopes({ ...scopes, [k]: !scopes[k] })}>{k}</Toggle>)}</div>
          <span>Lifetime</span><Select id="tokDays" aria-label="Lifetime" value={days} onChange={setDays} options={[30, 90].map(n => ({ value: String(n), label: n + ' days' }))} />
        </div>
        <div className="row"><Button variant="primary" onClick={create}>Create token</Button></div>
      </div>
    ) : null}
    <div className="tablewrap"><table className="rt">
      <thead><tr>{['Name', 'Owner', 'Scopes', 'Created', 'Last used', 'Expires', ''].map(t => <th key={t}>{t}</th>)}</tr></thead>
      <tbody>
        {tokens.map(t => (
          <tr key={t.id}>
            <td>{t.name}</td><td className="dim">{name(t.owner)}</td>
            <td><span className="tags">{t.scopes.map(s => <Tag key={s} tone={s === 'admin' ? 'ink' : undefined}>{s}</Tag>)}</span></td>
            <td className="dim">{ago(t.createdAt)}</td>
            <td className="dim">{t.lastUsedAt ? ago(t.lastUsedAt) : 'never'}</td>
            <td className="dim">{t.revokedAt ? 'revoked ' + ago(t.revokedAt) : until(t.expiresAt)}</td>
            <td>{t.revokedAt ? null : <Button small variant="danger" onClick={async () => {
              try { await revoke(t.id).unwrap(); toast(`${t.name} revoked. The CLI using it has to log in again.`) } catch (e) { toast(errorText(e), true) }
            }}>Revoke</Button>}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  </>
}

function Audit() {
  const { data: entries = [] } = useAuditQuery()
  const name = useNames()
  return <>
    <div className="pane-head"><h2>Audit log</h2><span className="note">Every change, with the token or agent it came through.</span></div>
    <div className="tablewrap"><table className="rt">
      <thead><tr>{['When', 'Who', 'Through', 'What', 'Subject'].map(t => <th key={t}>{t}</th>)}</tr></thead>
      <tbody>
        {entries.map(e => (
          <tr key={e.id}><td className="dim">{ago(e.at)}</td><td>{name(e.actor)}</td><td className="dim">{e.via}</td><td><code>{e.action}</code></td><td>{e.subject}</td></tr>
        ))}
      </tbody>
    </table></div>
  </>
}
