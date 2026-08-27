import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { signOut, getAuth } from 'firebase/auth'
import { ShieldAlert, UserX } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import type { RolePermission } from '../types'

function FullScreenMessage({
  icon,
  title,
  message,
}: {
  icon: ReactNode
  title: string
  message: string
}) {
  const signOutNow = async () => {
    try {
      await signOut(getAuth())
    } catch (err) {
      console.error('[AUTH] sign out failed', err)
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-500/10">
          {icon}
        </div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <Button className="mt-5" variant="outline" onClick={() => void signOutNow()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

/**
 * Gate for every authenticated route. Deliberately distinguishes four states
 * (loading / signed-out / broken-profile / healthy) so employees are NEVER sent
 * to store setup and owners without a store always are.
 */
export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: keyof RolePermission }) {
  const { authUser, user, isInitializing, profileStatus, can } = useAuth()
  const location = useLocation()

  // State 1: never route before auth + profile are resolved.
  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      </div>
    )
  }

  // State 2: not signed in.
  if (!authUser) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  // State 3: authenticated but the profile cannot back a normal session.
  if (profileStatus === 'inactive') {
    return (
      <FullScreenMessage
        icon={<ShieldAlert className="h-7 w-7" />}
        title="Account disabled"
        message="Your account has been disabled. Please contact the store administrator."
      />
    )
  }
  if (profileStatus !== 'ok' || !user) {
    return (
      <FullScreenMessage
        icon={<UserX className="h-7 w-7" />}
        title="Account configuration problem"
        message="We couldn't find a staff profile for this login. If you just registered, your store may not be set up yet — please contact the store administrator."
      />
    )
  }

  // State 4a: healthy profile. OWNER who has not created their store yet must go
  // through setup (unless they're already heading there); employees with a null
  // storeId are a configuration error, never setup candidates.
  const needsStoreSetup = user.role === 'OWNER' && !user.storeId
  const onSetupPage = location.pathname === '/setup'
  if (needsStoreSetup && !onSetupPage) {
    return <Navigate to="/setup" replace />
  }
  if (!needsStoreSetup && !user.storeId && onSetupPage) {
    return <Navigate to="/" replace />
  }
  if (!user.storeId) {
    return (
      <FullScreenMessage
        icon={<UserX className="h-7 w-7" />}
        title="No store assigned"
        message={`This ${user.role.toLowerCase()} account is not linked to a store yet. Please ask the store administrator to assign you.`}
      />
    )
  }

  // Permission gate stays last so diagnostics above take precedence.
  if (permission && !can(permission)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

/** Only a genuinely store-less OWNER may open /setup. Everyone else bounces home. */
export function OwnerSetupRoute({ children }: { children: ReactNode }) {
  const { authUser, user, isInitializing } = useAuth()

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      </div>
    )
  }
  if (!authUser) {
    return <Navigate to="/login" replace />
  }
  // A healthy profile with a storeId means setup was already done (owner) or is
  // not applicable (any employee) — send them into the app, not the wizard.
  if (user && user.storeId) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
