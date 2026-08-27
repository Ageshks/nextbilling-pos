import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 dark:bg-slate-900">
      <SearchX className="h-16 w-16 text-slate-300 dark:text-slate-600" aria-hidden="true" />
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Page not found</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
        Go to Dashboard
      </Link>
    </div>
  )
}