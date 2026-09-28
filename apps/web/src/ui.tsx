import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { STATUS_LABELS } from './format'

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'bg-white text-brand ring-1 ring-inset ring-brand hover:bg-gray-50',
    danger: 'bg-red-700 text-white hover:bg-red-800',
  }
  return (
    <button
      className={`rounded px-4 py-2 font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-50 ${styles[variant]} ${className}`}
      {...rest}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-gray-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded border-l-4 border-red-700 bg-red-50 p-3 text-sm text-red-900">
      {children}
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded border-l-4 border-brand bg-blue-50 p-3 text-sm text-gray-900">{children}</div>
}

export function SimNote({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-sim bg-sim-bg p-3 text-sm text-sim">{children}</div>
}

export function StatusTag({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status, tone: 'bg-gray-200' }
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>
}
