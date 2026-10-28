import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSandboxUrlQuery } from '../../api/slopApi'
import { isSandboxOrigin } from '../../app/boot'
import { cx } from '../../app/format'
import type { FromPreview, Pin, ToPreview } from '../../preview/bridge-protocol'

export type Device = 'fit' | 'desktop' | 'phone'

interface Props {
  artifact: string
  n: number
  host?: string
  path?: string
  device: Device
  mode?: 'preview' | 'thumb'
  picking?: boolean
  pins?: Pin[]
  focus?: string | null
  // scrollTo asks the preview to scroll a pin into view; bump `scrollSeq` to repeat.
  scrollTo?: string | null
  scrollSeq?: number
  onMessage?: (m: FromPreview) => void
  className?: string
  title?: string
}

// PreviewStage shows one version in an iframe on the sandbox domain, sized
// like a device, and speaks the bridge protocol with it.
export function PreviewStage({ artifact, n, host, path, device, mode = 'preview', picking, pins, focus, scrollTo, scrollSeq, onMessage, className, title }: Props) {
  const { data: sb, isError } = useSandboxUrlQuery({ artifact, n, mode, ...(host ? { host } : {}), ...(path ? { path } : {}) })
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState({ w: 1280, h: 800, s: 1 })
  const [ready, setReady] = useState(0)

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const fit = () => {
      const W = Math.max(100, el.clientWidth - 32), H = Math.max(100, el.clientHeight - 32)
      if (device === 'fit') setSize({ w: W, h: H, s: 1 })
      else if (device === 'phone') { const s = Math.min(1, W / 390, H / 844); setSize({ w: 390, h: 844, s }) }
      else { const s = Math.min(1, W / 1280); setSize({ w: 1280, h: H / s, s }) }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [device])

  // Nothing is sent before the bridge says it is ready: until the iframe has
  // loaded, its window is still about:blank on our own origin.
  const send = (m: ToPreview) => {
    if (ready && sb && frame.current?.contentWindow) frame.current.contentWindow.postMessage(m, sb.origin)
  }

  useEffect(() => setReady(0), [sb?.url])

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || !isSandboxOrigin(e.origin)) return
      const m = e.data as (FromPreview & { slop?: number }) | null
      if (!m || m.slop !== 1) return
      if (m.type === 'ready') setReady(r => r + 1)
      onMessage?.(m)
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [onMessage])

  useEffect(() => { send({ slop: 1, type: 'pick', on: !!picking }) }, [picking, ready])
  useEffect(() => { if (pins) send({ slop: 1, type: 'pins', pins, focus: focus ?? null }) }, [pins, focus, ready])
  useEffect(() => { if (scrollTo) send({ slop: 1, type: 'focus', id: scrollTo }) }, [scrollTo, scrollSeq, ready])

  return (
    <div className={cx('stage', picking && 'picking', className)} ref={stage}>
      <div className="dwrap" style={{ width: Math.floor(size.w * size.s), height: Math.floor(size.h * size.s) }}>
        <div className="device" style={{ width: size.w, height: size.h, transform: `scale(${size.s})` }}>
          {sb ? <iframe ref={frame} key={sb.url} src={sb.url} title={title ?? `${artifact} v${n}`} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /> : null}
        </div>
      </div>
      {isError ? <p className="empty">The preview could not be opened.</p> : null}
      {picking ? <div className="pickhint">Click an element to comment on it · Esc cancels</div> : null}
    </div>
  )
}

// Thumb is a small, lazy, non-interactive preview 1280 px wide scaled down.
export function Thumb({ artifact, n, width, host, path }: { artifact: string; n: number; width?: number; host?: string; path?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [w, setW] = useState(width ?? 250)
  useEffect(() => {
    const el = box.current
    if (!el) return
    if (!width) setW(el.clientWidth || 250)
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [width])
  return (
    <div ref={box} style={{ position: 'absolute', inset: 0 }}>
      {visible ? <ThumbFrame artifact={artifact} n={n} host={host} path={path} scale={w / 1280} /> : null}
    </div>
  )
}

// A thumb is shown in its route's context (host and a sample path), so pages
// behind /:param routes show a record instead of their "not found" state.
function ThumbFrame({ artifact, n, scale, host, path }: { artifact: string; n: number; scale: number; host?: string; path?: string }) {
  const { data } = useSandboxUrlQuery({ artifact, n, mode: 'thumb', ...(host ? { host } : {}), ...(path ? { path } : {}) })
  if (!data) return null
  return <iframe src={data.url} tabIndex={-1} aria-hidden="true" loading="lazy" sandbox="allow-scripts allow-same-origin" style={{ transform: `scale(${scale})` }} title="" />
}
