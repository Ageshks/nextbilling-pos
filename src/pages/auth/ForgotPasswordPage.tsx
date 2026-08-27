import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, CheckCircle2 } from 'lucide-react'
import { requestPasswordReset } from '../../firebase/auth'
import { friendlyError } from '../../utils/errors'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {sent ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
            <h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-white">Check your email</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              If an account exists for <span className="font-semibold">{email}</span>, a password reset link is on its way.
            </p>
            <Link to="/login" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Reset your password</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Enter your account email and we will send a reset link.
            </p>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {error && (
                <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                  {error}
                </div>
              )}
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                  autoFocus
                  aria-label="Email address"
                />
              </div>
              <Button type="submit" fullWidth loading={loading}>
                Send reset link
              </Button>
              <Link to="/login" className="flex items-center justify-center gap-1 text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </form>
          </>
        )}
      </div>
    </div>
  )
}