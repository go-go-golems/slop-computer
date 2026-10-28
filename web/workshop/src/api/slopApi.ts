import { createApi, fetchBaseQuery, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { csrfToken } from '../app/boot'
import type {
  Agent, Anchor, Artifact, AuditEntry, Comment, Project, PushRequest, PushResult, Rec, Resolved, Route, RouteLogEntry,
  RouteView, SandboxURL, Thread, Token, User, Version,
} from './types'

const baseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'same-origin',
  prepareHeaders: h => {
    h.set('X-CSRF-Token', csrfToken())
    return h
  },
})

// Mutations do not invalidate tags: the server echoes every change on
// /api/events, and api/events.ts turns events into invalidations, so a change
// from another browser, an agent or this one refreshes the cache the same way.
export const slopApi = createApi({
  reducerPath: 'slopApi',
  baseQuery,
  tagTypes: ['User', 'Token', 'Audit', 'Project', 'Artifact', 'Version', 'Route', 'RouteLog', 'Thread', 'Agent', 'Records'],
  endpoints: b => ({
    projects: b.query<Project[], void>({ query: () => 'projects', providesTags: ['Project'] }),
    artifacts: b.query<Artifact[], void>({ query: () => 'artifacts', providesTags: [{ type: 'Artifact', id: 'LIST' }] }),
    versions: b.query<Version[], string>({ query: id => `artifacts/${id}/versions`, providesTags: (_r, _e, id) => [{ type: 'Version', id }] }),
    file: b.query<string, { id: string; n: number; path: string }>({
      query: a => ({ url: `artifacts/${a.id}/versions/${a.n}/files/${a.path}`, responseHandler: 'text' }),
    }),
    records: b.query<Rec[], { id: string; n: number }>({
      query: a => `artifacts/${a.id}/versions/${a.n}/records`,
      providesTags: (_r, _e, a) => [{ type: 'Records', id: a.id }],
    }),
    routes: b.query<RouteView[], { host?: string } | void>({
      query: p => ({ url: 'routes', params: { resolve: '1', ...(p ?? {}) } }),
      providesTags: [{ type: 'Route', id: 'LIST' }],
    }),
    routeLog: b.query<RouteLogEntry[], { host: string; path: string }>({
      query: p => ({ url: 'routes/log', params: p }),
      providesTags: (_r, _e, p) => [{ type: 'RouteLog', id: p.host + p.path }],
    }),
    resolve: b.query<Resolved | null, { host: string; path: string }>({
      queryFn: async (p, _api, _x, fetch) => {
        const r = await fetch({ url: 'resolve', params: p })
        if (r.error && (r.error as FetchBaseQueryError).status === 404) return { data: null }
        return r.error ? { error: r.error as FetchBaseQueryError } : { data: r.data as Resolved }
      },
      providesTags: [{ type: 'Route', id: 'LIST' }, { type: 'Artifact', id: 'LIST' }],
    }),
    threads: b.query<Thread[], { artifact?: string } | void>({
      query: p => ({ url: 'threads', params: p ?? {} }),
      providesTags: (_r, _e, p) => [{ type: 'Thread', id: p?.artifact ?? 'ALL' }],
    }),
    sandboxUrl: b.query<SandboxURL, { artifact: string; n: number; mode: 'preview' | 'thumb'; host?: string; path?: string }>({
      query: p => ({ url: 'sandbox-url', params: p }),
      keepUnusedDataFor: 600,
    }),
    agents: b.query<Agent[], void>({ query: () => 'agents', providesTags: ['Agent'] }),
    users: b.query<User[], void>({ query: () => 'users', providesTags: ['User'] }),
    tokens: b.query<Token[], void>({ query: () => ({ url: 'tokens', params: { all: '1' } }), providesTags: ['Token'] }),
    audit: b.query<AuditEntry[], void>({ query: () => ({ url: 'audit', params: { limit: '200' } }), providesTags: ['Audit'] }),

    setRoute: b.mutation<Route, Partial<Route> & { host: string; path: string; page: string; note?: string }>({
      query: body => ({ url: 'routes', method: 'PUT', body }),
    }),
    removeRoute: b.mutation<void, { host: string; path: string }>({ query: params => ({ url: 'routes', method: 'DELETE', params }) }),
    undoRoute: b.mutation<{ route: Route | null }, { host: string; path: string }>({ query: body => ({ url: 'routes/undo', method: 'POST', body }) }),
    createThread: b.mutation<Thread, { artifact: string; version: number; anchor: Anchor; text: string }>({
      query: ({ artifact, ...body }) => ({ url: `artifacts/${artifact}/threads`, method: 'POST', body }),
    }),
    reply: b.mutation<Comment, { thread: string; text: string }>({
      query: ({ thread, text }) => ({ url: `threads/${thread}/replies`, method: 'POST', body: { text } }),
    }),
    resolveThread: b.mutation<Thread, { thread: string; resolved: boolean }>({
      query: ({ thread, resolved }) => ({ url: `threads/${thread}/resolve`, method: 'POST', body: { resolved } }),
    }),
    setRole: b.mutation<User, { id: string; role: string }>({ query: ({ id, role }) => ({ url: `users/${id}`, method: 'PATCH', body: { role } }) }),
    createToken: b.mutation<{ token: string; info: Token }, { name: string; scopes: string[]; days: number }>({
      query: body => ({ url: 'tokens', method: 'POST', body }),
    }),
    revokeToken: b.mutation<void, string>({ query: id => ({ url: `tokens/${id}`, method: 'DELETE' }) }),

    // push stores a version from the browser: files are hashed here, only
    // blobs the server lacks are uploaded, then the tree is posted.
    // `keep` carries over files of the base version that are not replaced.
    push: b.mutation<PushResult, { id: string; files: Record<string, string>; keep?: Record<string, string> } & Omit<PushRequest, 'tree'>>({
      queryFn: async ({ id, files, keep, ...req }, _api, _x, fetch) => {
        const tree: Record<string, string> = { ...(keep ?? {}) }
        const bodies: Record<string, Blob> = {}
        for (const [path, text] of Object.entries(files)) {
          const blob = new Blob([text])
          const sum = await sha256(await blob.arrayBuffer())
          tree[path] = sum
          bodies[sum] = blob
        }
        const m = await fetch({ url: 'blobs/missing', method: 'POST', body: { sha256: Object.keys(bodies) } })
        if (m.error) return { error: m.error as FetchBaseQueryError }
        for (const sum of (m.data as { missing: string[] }).missing ?? []) {
          const u = await fetch({ url: `blobs/${sum}`, method: 'PUT', body: bodies[sum], headers: { 'Content-Type': 'application/octet-stream' } })
          if (u.error) return { error: u.error as FetchBaseQueryError }
        }
        const r = await fetch({ url: `artifacts/${id}/versions`, method: 'POST', body: { ...req, tree } })
        return r.error ? { error: r.error as FetchBaseQueryError } : { data: r.data as PushResult }
      },
    }),
  }),
})

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
}

// errorText turns an RTK Query error into a sentence for a toast.
export function errorText(e: unknown): string {
  const err = e as { status?: number | string; data?: { error?: { message?: string } }; error?: string }
  return err?.data?.error?.message ?? err?.error ?? `Request failed (${err?.status ?? 'network'})`
}

export const {
  useProjectsQuery, useArtifactsQuery, useVersionsQuery, useFileQuery, useRecordsQuery, useRoutesQuery, useRouteLogQuery,
  useResolveQuery, useThreadsQuery, useSandboxUrlQuery, useAgentsQuery, useUsersQuery, useTokensQuery, useAuditQuery,
  useSetRouteMutation, useRemoveRouteMutation, useUndoRouteMutation, useCreateThreadMutation, useReplyMutation,
  useResolveThreadMutation, useSetRoleMutation, useCreateTokenMutation, useRevokeTokenMutation, usePushMutation,
} = slopApi
