import { useSyncExternalStore } from 'react'

// A path router for the Workshop's five screens:
//   /watch[/<artifact>[/<n>]]  /routes  /artifacts  /site  /admin
export type ScreenName = 'watch' | 'routes' | 'artifacts' | 'site' | 'admin'
export const SCREENS: ScreenName[] = ['watch', 'routes', 'artifacts', 'site', 'admin']
export const SCREEN_NAMES: Record<ScreenName, string> = { watch: 'Watch', routes: 'Routes', artifacts: 'Artifacts', site: 'Site', admin: 'Admin' }

// Tools live at /tools/<artifact>[?try=<n>], outside the five screens.
export interface Location { screen: ScreenName | 'tools'; artifact?: string; n?: number; tool?: string; query: URLSearchParams }

function parse(): Location {
  const parts = location.pathname.split('/').filter(Boolean)
  if (parts[0] === 'tools' && parts[1]) return { screen: 'tools', tool: decodeURIComponent(parts[1]), query: new URLSearchParams(location.search) }
  const screen = (SCREENS as string[]).includes(parts[0]) ? (parts[0] as ScreenName) : 'watch'
  const out: Location = { screen, query: new URLSearchParams(location.search) }
  if (screen === 'watch' && parts[1]) {
    out.artifact = decodeURIComponent(parts[1])
    const n = Number(parts[2])
    if (Number.isInteger(n) && n > 0) out.n = n
  }
  return out
}

let snapshot = parse()
const listeners = new Set<() => void>()
const changed = () => {
  snapshot = parse()
  listeners.forEach(l => l())
}
window.addEventListener('popstate', changed)

export function navigate(path: string, replace = false) {
  if (path === location.pathname + location.search) return
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  changed()
}

export const toolPath = (id: string, tryN?: number | null) => `/tools/${encodeURIComponent(id)}${tryN ? `?try=${tryN}` : ''}`
export const watchPath = (artifact: string, n?: number | null) => `/watch/${encodeURIComponent(artifact)}${n ? `/${n}` : ''}`

export function useLocation(): Location {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => snapshot)
}
