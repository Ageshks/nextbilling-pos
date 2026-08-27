import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Store, User, Mail, Lock } from 'lucide-react'
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { getFirebaseApp } from '../../firebase/config'
import { createInitialSetup } from '../../services/seedService'
import { friendlyError } from '../../utils/errors'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'

/**
 * First-run registration. Creates the Firebase auth account and bootstraps the
 * store, settings and owner profile. In a real deployment the owner can also
 * be provisioned manually from the Firebase Console — the setup page covers that.
 */
export default function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !storeName.trim() || !email.trim() || password.length < 6) {
      setError('Fill in all fields. Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      const auth = getAuth(getFirebaseApp())
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
      await createInitialSetup({
        ownerUid: cred.user.uid,
        ownerName: name.trim(),
        ownerEmail: email.trim(),
        storeName: storeName.trim(),
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8 dark:bg-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white">
            <Store className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Start your store</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create the owner account and your store</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="pl-9" autoFocus aria-label="Your name" />
          </div>
          <div className="relative">
            <Store className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input placeholder="Store name (e.g. SuperMart)" value={storeName} onChange={(e) => setStoreName(e.target.value)} className="pl-9" aria-label="Store name" />
          </div>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input type="email" autoComplete="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" aria-label="Work email" />
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input type="password" autoComplete="new-password" placeholder="Password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" aria-label="Password" />
          </div>
          <Button type="submit" fullWidth size="lg" loading={loading}>
            Create store & owner account
          </Button>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}