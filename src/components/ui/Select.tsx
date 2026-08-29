import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  children: ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, children, className = '', id, ...rest },
  ref,
) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          className={`w-full cursor-pointer appearance-none rounded-lg border bg-white px-3 py-2 pr-9 text-sm text-slate-900 outline-none transition-colors focus:ring-2 dark:bg-slate-800 dark:text-slate-100 ${
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
              : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200 dark:border-slate-600'
          } ${className}`}
          aria-invalid={error ? true : undefined}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
      </div>
      {(error || hint) && (
        <p className={`mt-1 text-xs ${error ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
})