import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, suffix, className = '', id, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:ring-2 dark:bg-slate-800 dark:text-slate-100 ${
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-200 dark:border-red-500'
              : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200 dark:border-slate-600 dark:focus:border-emerald-400'
          } ${suffix ? 'pr-10' : ''} ${className}`}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        {suffix && <span className="absolute inset-y-0 right-3 flex items-center text-slate-400">{suffix}</span>}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  )
})