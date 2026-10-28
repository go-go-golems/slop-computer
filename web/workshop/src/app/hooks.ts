import { useCallback, useEffect, useMemo, useState } from 'react'
import { useArtifactsQuery, useRoutesQuery, useUsersQuery } from '../api/slopApi'
import type { Artifact, RouteView, Version } from '../api/types'
import { boot } from './boot'

// useNames maps user ids to display names.
export function useNames() {
  const { data } = useUsersQuery()
  return useCallback((id: string | null | undefined) => {
    if (!id) return 'someone'
    return data?.find(u => u.id === id)?.name || id
  }, [data])
}

// useVersionBy describes who pushed a version and how.
export function useVersionBy() {
  const name = useNames()
  return useCallback((v: Pick<Version, 'by' | 'via'>) => {
    if (v.via === 'claude') return `Claude Code (${name(v.by)}’s)`
    if (v.via === 'browser') return `${name(v.by)}, in the browser`
    return `${name(v.by)}, slop push`
  }, [name])
}

export const siteHost = () => boot().config.siteHosts[0] ?? ''
export const shortHost = (host: string) => (host === siteHost() ? '' : host)

// useArtifact finds one artifact in the cached list.
export function useArtifact(id: string | undefined): Artifact | undefined {
  const { data } = useArtifactsQuery()
  return useMemo(() => data?.find(a => a.id === id), [data, id])
}

// useRoutesUsing lists routes serving a page; useReaders, routes whose
// bindings read a data artifact.
export function useRoutesUsing(id: string | undefined): RouteView[] {
  const { data } = useRoutesQuery()
  return useMemo(() => (data ?? []).filter(r => r.page === id), [data, id])
}

export function useReaders(id: string | undefined): RouteView[] {
  const { data } = useRoutesQuery()
  return useMemo(() => (data ?? []).filter(r => Object.values(r.data ?? {}).some(b => b.artifact === id)), [data, id])
}

// usePref is useState backed by localStorage (per browser conveniences).
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const k = 'slop:workshop:' + key
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(k)
      return s == null ? initial : (JSON.parse(s) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage may be unavailable */ }
  }, [k, v])
  return [v, setV]
}
