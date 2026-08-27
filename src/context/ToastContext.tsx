import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import type { Notification } from '../types'

interface ToastContextValue {
  notify: (notification: Omit<Notification, 'id'>) => void
  success: (message: string, title?: string) => void
  error: (message: string, title?: string) => void
  info: (message: string, title?: string) => void
  warning: (message: string, title?: string) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const COLORS = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-sky-600 dark:text-sky-400',
  warning: 'text-amber-600 dark:text-amber-400',
}

let idCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Notification[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (notification: Omit<Notification, 'id'>) => {
      const id = `toast-${Date.now()}-${idCounter++}`
      setToasts((prev) => [...prev.slice(-4), { ...notification, id }])
      window.setTimeout(() => dismiss(id), 4200)
    },
    [dismiss],
  )

  const success = useCallback((message: string, title?: string) => notify({ message, title, type: 'success' }), [notify])
  const error = useCallback((message: string, title?: string) => notify({ message, title, type: 'error' }), [notify])
  const info = useCallback((message: string, title?: string) => notify({ message, title, type: 'info' }), [notify])
  const warning = useCallback((message: string, title?: string) => notify({ message, title, type: 'warning' }), [notify])

  const value = useMemo(
    () => ({ notify, success, error, info, warning, dismiss }),
    [notify, success, error, info, warning, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type]
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg dark:border-slate-700 dark:bg-slate-800 toast-enter"
              role="status"
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${COLORS[toast.type]}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {toast.title && <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{toast.title}</p>}
                <p className="text-sm text-slate-600 dark:text-slate-300">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}