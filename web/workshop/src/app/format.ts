// Small formatting helpers, from the prototype's app.js.

export function ago(t: string | number | undefined | null): string {
  if (!t) return ''
  const d = (Date.now() - new Date(t).getTime()) / 1000
  if (d < 45) return 'just now'
  if (d < 90) return '1 min ago'
  if (d < 3600) return Math.round(d / 60) + ' min ago'
  if (d < 5400) return '1 h ago'
  if (d < 86400) return Math.round(d / 3600) + ' h ago'
  const days = Math.round(d / 86400)
  return days === 1 ? 'yesterday' : days + ' d ago'
}

export function until(t: string | undefined): string {
  if (!t) return 'never'
  const d = Math.round((new Date(t).getTime() - Date.now()) / 86400e3)
  return d < 0 ? 'expired' : d === 0 ? 'today' : 'in ' + d + ' d'
}

export const clock = (t: string) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's')
export const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
