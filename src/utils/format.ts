export function formatMoney(
  amount: number,
  currency = 'INR',
): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount || 0)
  } catch {
    return `₹${(amount || 0).toFixed(2)}`
  }
}

export function formatNumber(n: number, maxFrac = 3): string {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: maxFrac,
  }).format(n || 0)
}

export function formatDate(ts?: number): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ts))
}

export function formatDateTime(ts?: number): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

export function formatTime(ts?: number): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts))
}

export function startOfDay(ts = Date.now()): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts = Date.now()): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function startOfWeek(ts = Date.now()): number {
  const d = startOfDay(ts)
  const day = new Date(d).getDay()
  const diff = d - day * 86400000
  return new Date(diff).setHours(0, 0, 0, 0)
}

export function startOfMonth(ts = Date.now()): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function daysAgo(days: number, from = Date.now()): number {
  return from - days * 86400000
}

export function toDateInputValue(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromDateInputValue(value: string): number {
  const date = new Date(`${value}T00:00:00`)
  return date.getTime()
}

export function relativeDayLabel(ts: number): string {
  const day = startOfDay(ts)
  const today = startOfDay()
  const diffDays = Math.round((today - day) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return formatDate(ts)
}