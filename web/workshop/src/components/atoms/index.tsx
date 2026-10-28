import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cx } from '../../app/format'

// Atoms: no data, no slop concepts. Class names are the prototype's style.css.

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger'; small?: boolean }

export function Button({ variant, small, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('btn', variant, small && 'sm', className)} {...rest} />
}

export function IconButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx('ibtn', className)} {...rest} />
}

export function LinkButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx('link', className)} {...rest} />
}

export function Tag({ tone, children, title }: { tone?: 'ink' | 'red'; children: ReactNode; title?: string }) {
  return <span className={cx('tag', tone)} title={title}>{children}</span>
}

export function Count({ n, bad, title }: { n: number; bad?: boolean; title?: string }) {
  return <span className={cx('count', bad && 'bad')} title={title}>{n}</span>
}

// Avatar is an initial, or "C" in the agent style.
export function Avatar({ name, agent, large, title }: { name: string; agent?: boolean; large?: boolean; title?: string }) {
  return <span className={cx('av', agent && 'ag', large && 'lg')} title={title}>{agent ? 'C' : (name || '?').charAt(0)}</span>
}

export interface Option { value: string; label: string }

export function Select({ options, value, onChange, className, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { options: Option[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className={cx('sel', className)} value={value} onChange={e => onChange(e.target.value)} {...rest}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// Seg is a segmented control.
export function Seg<T extends string>({ options, value, onChange, small, label }: { options: [T, string][]; value: T; onChange: (v: T) => void; small?: boolean; label: string }) {
  return (
    <div className={cx('seg', small && 'sm')} role="group" aria-label={label}>
      {options.map(([k, l]) => <button type="button" key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  )
}

export function Toggle({ on, onClick, children, red }: { on: boolean; onClick: () => void; children: ReactNode; red?: boolean }) {
  return <button type="button" className={cx('tog', on && 'on', red && 'red')} onClick={onClick}>{children}</button>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="fld"><span>{label}</span>{children}</label>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

// Tabs is a tab strip (dtabs) with optional counts.
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number | null; bad?: boolean }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="dtabs" role="tablist">
      {tabs.map(t => (
        <button type="button" key={t.key} className={cx('dtab', value === t.key && 'on')} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null ? <Count n={t.count} bad={t.bad && t.count > 0} /> : null}
        </button>
      ))}
    </div>
  )
}
