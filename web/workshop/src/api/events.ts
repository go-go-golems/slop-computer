import type { TagDescription } from '@reduxjs/toolkit/query'
import type { AppStore } from '../app/store'
import { toast } from '../app/store'
import { consoleAdded, liveChanged } from '../app/ui'
import { slopApi } from './slopApi'
import { isAgent } from '../app/format'
import type { SlopEvent } from './types'

type Tag = TagDescription<'User' | 'Token' | 'Audit' | 'Project' | 'Artifact' | 'Version' | 'Route' | 'RouteLog' | 'Thread' | 'Agent' | 'Records' | 'Tool'>
type Payload = Record<string, unknown>

const art = (e: SlopEvent) => e.artifact ?? (e.payload.artifact as string | undefined) ?? ''

// What each event makes stale. Every change reaches the cache through here.
const INVALIDATES: Record<string, (e: SlopEvent) => Tag[]> = {
  'artifact.created': () => [{ type: 'Artifact', id: 'LIST' }],
  'artifact.updated': e => [{ type: 'Artifact', id: 'LIST' }, { type: 'Version', id: art(e) }],
  'version.created': e => [{ type: 'Version', id: art(e) }, { type: 'Artifact', id: 'LIST' }, { type: 'Route', id: 'LIST' }, 'Audit', 'Tool'],
  'ref.moved': e => [{ type: 'Version', id: art(e) }, { type: 'Artifact', id: 'LIST' }, { type: 'Route', id: 'LIST' }],
  'route.set': () => [{ type: 'Route', id: 'LIST' }, 'RouteLog', 'Audit'],
  'route.removed': () => [{ type: 'Route', id: 'LIST' }, 'RouteLog', 'Audit'],
  'thread.created': e => [{ type: 'Thread', id: art(e) }, { type: 'Thread', id: 'ALL' }],
  'comment.created': e => [{ type: 'Thread', id: art(e) }, { type: 'Thread', id: 'ALL' }],
  'thread.resolved': e => [{ type: 'Thread', id: art(e) }, { type: 'Thread', id: 'ALL' }],
  'project.updated': () => ['Project'],
  'user.role': () => ['User', 'Audit'],
  'token.created': () => ['Token', 'Audit'],
  'token.revoked': () => ['Token', 'Audit'],
  'agent.waiting': () => ['Agent'],
  'agent.left': () => ['Agent'],
  'tool.enabled': () => ['Tool', 'Audit'],
  'tool.disabled': () => ['Tool', 'Audit'],
}

// describe is the console line for an event, or null for none.
function describe(e: SlopEvent): string | null {
  const p = e.payload as Payload
  switch (e.type) {
    case 'version.created': return `pushed ${p.artifact} v${p.n}${p.message ? ` · ${p.message}` : ''}`
    case 'ref.moved': return `moved ${p.artifact} ${p.ref} to v${p.to}`
    case 'route.set': return `route ${(p.route as Payload)?.host ?? ''}${(p.route as Payload)?.path ?? ''} → ${(p.route as Payload)?.pageFrom ? `${(p.route as Payload).pageFrom} else ` : ''}${(p.route as Payload)?.page ?? ''}@${(p.route as Payload)?.version ?? 'main'}${p.note ? ` (${p.note})` : ''}`
    case 'route.removed': return `removed route ${p.host}${p.path}`
    case 'thread.created': return `commented on ${e.artifact}`
    case 'comment.created': return `replied on ${e.artifact}`
    case 'thread.resolved': return `${(p.thread as Payload)?.resolved === false ? 'reopened' : 'resolved'} a thread on ${e.artifact}`
    case 'agent.waiting': return `slop comments wait${p.artifact ? ` -a ${p.artifact}` : p.project ? ` -p ${p.project}` : ''}`
    case 'agent.left': return 'stopped waiting'
    case 'tool.enabled': return `enabled the tool ${e.artifact} at v${p.version}`
    case 'tool.disabled': return `disabled the tool ${e.artifact}`
    default: return null
  }
}

// startEvents follows /api/events for the life of the page. EventSource
// reconnects by itself and resends Last-Event-ID, which the server replays from.
export function startEvents(store: AppStore, nameOf: (id: string) => string) {
  const es = new EventSource('/api/events', { withCredentials: true })
  es.addEventListener('ready', () => store.dispatch(liveChanged(true)))
  es.onerror = () => store.dispatch(liveChanged(false))
  for (const type of Object.keys(INVALIDATES)) {
    es.addEventListener(type, (m: MessageEvent) => {
      let e: SlopEvent
      try { e = JSON.parse(m.data) } catch { return }
      store.dispatch(slopApi.util.invalidateTags(INVALIDATES[type](e)))
      const p = e.payload as Payload
      const who = e.type.startsWith('agent.') ? String(p.name ?? '') : nameOf(e.actor ?? '')
      const text = describe(e)
      if (text) store.dispatch(consoleAdded({ at: e.at, who, kind: isAgent(p.via) || e.type.startsWith('agent.') ? 'agent' : 'ui', text }))
      if (e.type === 'version.created' && isAgent(p.via)) toast(`${p.via === 'claude' ? `Claude Code (${who}’s)` : `${who}’s agent`} pushed ${p.artifact} v${p.n}.`)
    })
  }
  return () => es.close()
}
