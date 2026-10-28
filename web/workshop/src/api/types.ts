// The server's JSON, written by hand to match the Go structs in pkg/store,
// pkg/routing and pkg/server. Times are RFC 3339 strings.

export type Role = 'admin' | 'pending' | 'disabled'

export interface MeUser { id: string; name: string; email: string; role: Role; local: boolean }
export interface Me { user: MeUser; csrfToken?: string }

export interface Config { mode: 'local' | 'oidc'; publicUrl: string; siteHosts: string[]; sandboxDomain: string }

export interface Project { id: string; name: string; brief: string; createdAt: string }

export interface Artifact {
  id: string
  title: string
  kind: 'page' | 'data'
  type?: string
  viewer?: string
  project: string | null
  createdBy: string | null
  createdAt: string
  main: number
  latest: number
}

export interface FileEntry { sha256: string; size: number; type: string }

export interface Version {
  artifact: string
  n: number
  parent: number | null
  manifest: Record<string, unknown>
  message: string
  by: string
  tokenId?: string
  via: 'browser' | 'cli' | 'claude' | string
  session?: string
  reply?: string
  at: string
  files: Record<string, FileEntry>
}

export interface Binding { artifact: string; version: number | null }
export interface ResolvedBinding extends Binding { n: number }

export interface Route {
  host: string
  path: string
  page: string
  version: number | null
  bindings: Record<string, Binding> | null
  record?: string
  access: 'public' | 'admins'
  changedBy: string | null
  changedAt: string
}

// RouteView is a route from GET /api/routes?resolve=1.
export interface RouteView extends Route { n: number; data: Record<string, ResolvedBinding> }

export interface RouteLogEntry {
  id: number
  host: string
  path: string
  from: Route | null
  to: Route | null
  note: string
  by: string | null
  via: string
  at: string
}

export interface Resolution { route: Route; params: Record<string, string>; record?: string; fallback: boolean }
export interface Resolved { resolution: Resolution; n: number; bindings: Record<string, ResolvedBinding> }

export interface Anchor {
  selector?: string
  fx?: number
  fy?: number
  text?: string
  tag?: string
  styles?: Record<string, string>
  record?: string
  field?: string
}

export interface Comment {
  id: number
  thread: string
  by: string
  tokenId?: string
  agent: boolean
  version?: number
  text: string
  at: string
}

export interface Thread {
  id: string
  artifact: string
  version: number
  anchor: Anchor | null
  by: string
  at: string
  resolvedAt?: string
  resolvedBy?: string
  resolved: boolean
  comments: Comment[]
}

export interface User {
  id: string
  issuer: string
  subject: string
  email: string
  emailVerified: boolean
  name: string
  role: Role
  createdAt: string
  lastLoginAt?: string
  lastSeenAt?: string
}

export interface Token {
  id: string
  owner: string
  name: string
  scopes: string[]
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  revokedAt?: string
}

export interface AuditEntry {
  id: number
  actor: string | null
  tokenId?: string
  via: string
  action: string
  subject: string
  summary: unknown
  at: string
}

// Agent is a `slop comments wait` that is blocked right now.
export interface Agent { id: number; user: string; name: string; token: string; project?: string; artifact?: string; since: string }

export type Rec = Record<string, unknown> & { id: string; path: string; title?: string; date?: string; tags?: string[]; body?: string; html?: string }

export interface SandboxURL { url: string; origin: string; artifact: string; n: number }

export interface PushRequest {
  tree: Record<string, string>
  manifest?: Record<string, unknown>
  message: string
  base?: number
  reply?: { thread: string; text: string }
  create?: { title: string; kind: 'page' | 'data'; type?: string; viewer?: string; project?: string | null }
  moveMain?: boolean
  force?: boolean
}

export interface PushResult { artifact: Artifact; version: Version; created: boolean; unchanged: boolean; warnings: string[] | null }

export interface SlopEvent {
  seq: number
  type: string
  project?: string
  artifact?: string
  actor?: string
  payload: Record<string, unknown>
  at: string
}

export interface ApiError { code: string; message: string }

// Tools: pushed pages that run inside the Workshop with a grant.
export interface Tool { artifact: string; version: number; permissions: string[]; title: string; icon: string; enabledBy: string; enabledAt: string }
export interface ToolView {
  artifact: string
  project: string | null
  enabled: Tool | null
  latest: { n: number; title: string; icon?: string; permissions: string[] | null; newPermissions: string[]; error?: string }
}
export interface ToolList { tools: ToolView[]; permissions: Record<string, string> }
export interface ToolGrant { grant: string; expiresAt: string; permissions: string[]; n: number; try: boolean; user: { id: string; name: string } }
