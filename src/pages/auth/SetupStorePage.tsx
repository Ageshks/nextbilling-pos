import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { createInitialSetup, seedStore, seedFeatureEnabled } from '../../services/seedService'
import { friendlyError } from '../../utils/errors'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../context/ToastContext'

/**
 * Shown when an authenticated Firebase user has no store profile yet
 * (e.g. provisioned manually in Firebase Console), or when the owner needs
 * to re-bootstrap after deleting a store document.
 */
export default function SetupStorePage() {
  const { authUser } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [storeName, setStoreName] = useState('')
  const [withSeed, setWithSeed] = useState(seedFeatureEnabled())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!authUser) return
    if (!storeName.trim()) {
      setError('Store name is required.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { storeId } = await createInitialSetup({
        ownerUid: authUser.uid,
        ownerName: authUser.displayName ?? 'Owner',
        ownerEmail: authUser.email ?? '',
        storeName: storeName.trim(),
      })
      if (withSeed) {
        await seedStore(storeId, authUser.uid)
        notify({ type: 'success', message: 'Sample products and categories added.', title: 'Seed data loaded' })
      }
            navigate('/', { replace: true })
    } catch (err) {
      // Surface the real permission error message so the cause is diagnosable,
      // while keeping the user-facing wording friendly.
      console.error(
        '[SETUP] createInitialSetup failed',
        JSON.stringify(
          {
            ownerUid: authUser.uid,
            storeName: storeName.trim(),
            code: (err as { code?: string }).code,
            message: String(err),
          },
          null,
          2,
        ),
      )
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
            <Store className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Set up your store</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Welcome {authUser?.displayName ?? 'there'} — let's create your store profile.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}
          <Input label="Store name" placeholder="e.g. SuperMart" value={storeName} onChange={(e) => setStoreName(e.target.value)} required autoFocus />
          {withSeed && (
            <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={withSeed} onChange={(e) => setWithSeed(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">Load sample data</span>
                <span className="block text-xs text-slate-500">Categories, brands and 12 sample products (dev only).</span>
              </span>
            </label>
          )}
          <Button type="submit" fullWidth size="lg" loading={loading}>
            Create store
          </Button>
        </form>
      </div>
    </div>
  )
}