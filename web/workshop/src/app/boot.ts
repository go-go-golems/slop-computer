import type { Config, Me } from '../api/types'

// Boot data: who is signed in and how the server is set up. Loaded once
// before the store is created; the CSRF token goes on every mutation.
export interface Boot { me: Me; config: Config }

let current: Boot | null = null

export function boot(): Boot {
  if (!current) throw new Error('boot data not loaded')
  return current
}

export const csrfToken = () => current?.me.csrfToken ?? ''

// loadBoot returns null when nobody is signed in (the caller goes to /auth/login).
export async function loadBoot(): Promise<Boot | null> {
  const [me, config] = await Promise.all([fetch('/api/me', { credentials: 'same-origin' }), fetch('/api/config', { credentials: 'same-origin' })])
  if (me.status === 401) return null
  if (!me.ok || !config.ok) throw new Error(`the server answered ${me.status} / ${config.status}`)
  current = { me: await me.json(), config: await config.json() }
  return current
}

// sandboxHost reports whether an origin is one of the server's preview origins.
export function isSandboxOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    return u.host.endsWith('.' + boot().config.sandboxDomain)
  } catch {
    return false
  }
}
