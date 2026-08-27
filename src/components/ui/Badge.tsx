import type { ReactNode } from 'react'

type Tone = 'emerald' | 'red' | 'amber' | 'sky' | 'slate' | 'violet' | 'indigo'

interface BadgeProps {
  tone?: Tone
  children: ReactNode
  className?: string
  dot?: boolean
}

const TONES: Record<Tone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  sky: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-700/40 dark:text-slate-300',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300',
}

const DOT: Record<Tone, string> = {
  emerald: 'bg-emerald-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  slate: 'bg-slate-400',
  violet: 'bg-violet-500',
  indigo: 'bg-indigo-500',
}

export function Badge({ tone = 'slate', children, className = '', dot = false }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

export function statusTone(status: string): Tone {
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'paid' || s === 'instock' || s === 'in_stock' || s === 'active' || s === 'open' || s === 'online') return 'emerald'
  if (s === 'cancelled' || s === 'out_of_stock' || s === 'outofstock' || s === 'offline' || s === 'error') return 'red'
  if (s === 'low_stock' || s === 'lowstock' || s === 'partial' || s === 'partially_returned' || s === 'syncing' || s === 'pending') return 'amber'
  if (s === 'returned') return 'violet'
  return 'slate'
}