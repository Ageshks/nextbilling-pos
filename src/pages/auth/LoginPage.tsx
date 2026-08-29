import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Lock, Mail, Eye, EyeOff } from 'lucide-react'
import { loginWithEmail } from '../../firebase/auth'
import { friendlyError } from '../../utils/errors'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useStore } from '../../context/StoreContext'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { reloadSettings } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await loginWithEmail(email, password)
      await reloadSettings()
      navigate(from, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
                    <div className="mx-auto mb-3 flex h-16 w-auto items-center justify-center">
            <img src="/logo.png" alt="Nextbilling" className="h-16 w-auto object-contain" />
          </div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Nextbilling POS</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sign in to your store
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type="email"
              autoComplete="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
              aria-label="Email address"
              autoFocus
            />
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9 pr-10"
              aria-label="Password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" fullWidth size="lg" loading={loading}>
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          First time here?{' '}
          <Link to="/register" className="font-medium text-emerald-600 hover:underline dark:text-emerald-400">
            Create your store
          </Link>
        </p>
      </div>
    </div>
  )
}