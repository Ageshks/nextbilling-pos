import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthChange, type FirebaseUser } from '../firebase/auth'
import { getUser } from '../services/userService'
import type { AppUser, Role, RolePermission } from '../types'
import { ROLES } from '../types'

/**
 * Explicit profile states so routing never guesses mid-load:
 * - 'initializing': auth/profile resolution in flight — UI must NOT decide routes yet
 * - 'ok':           active profile loaded
 * - 'inactive':     profile exists but disabled -> dedicated screen, never /setup
 * - 'missing':      authenticated account has no Firestore profile -> dedicated error, never /setup
 * - 'error':        profile fetch failed (rules/network) -> dedicated error
 */
export type ProfileStatus = 'ok' | 'inactive' | 'missing' | 'error'

interface AuthContextValue {
  authUser: FirebaseUser | null
  /** Raw Firestore profile (may be an inactive one — callers must check profileStatus). */
  user: AppUser | null
  isInitializing: boolean
  profileStatus: ProfileStatus
  isAuthenticated: boolean
  can: (permission: keyof RolePermission) => boolean
  role: Role | null
  hasRole: (...roles: Role[]) => boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('missing')

  const applyProfile = useCallback((appUser: AppUser | null) => {
    setUser(appUser)
    if (!appUser) {
      setProfileStatus('missing')
    } else if (appUser.status === 'inactive') {
      // Keep the profile visible so the router can show the "disabled" screen
      // with real context instead of silently treating the user as anonymous.
      setProfileStatus('inactive')
    } else {
      setProfileStatus('ok')
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      if (!mounted) return
      setAuthUser(firebaseUser)
      if (!firebaseUser) {
        setUser(null)
        setProfileStatus('missing')
        setIsInitializing(false)
        return
      }
      try {
        const appUser = await getUser(firebaseUser.uid)
        if (!mounted) return
        applyProfile(appUser)
      } catch (err) {
        console.error(
          '[AUTH] Failed to load user profile',
          JSON.stringify({ uid: firebaseUser.uid, action: 'LOAD_PROFILE', err: String(err) }),
        )
        if (mounted) {
          setUser(null)
          setProfileStatus('error')
        }
      }
      if (mounted) setIsInitializing(false)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [applyProfile])

  const refreshProfile = useCallback(async () => {
    if (!authUser) return
    try {
      const appUser = await getUser(authUser.uid)
      applyProfile(appUser)
    } catch (err) {
      console.error('[AUTH] refreshProfile failed', String(err))
    }
  }, [authUser, applyProfile])

  const can = useCallback(
    (permission: keyof RolePermission): boolean => {
      // Inactive/broken profiles hold zero permissions even if still signed in.
      if (!user || profileStatus !== 'ok') return false
      const perms = ROLES[user.role]
      if (!perms) return false
      if (perms.all) return true
      return Boolean(perms[permission])
    },
    [user, profileStatus],
  )

  const hasRole = useCallback(
    (...roles: Role[]): boolean => profileStatus === 'ok' && user !== null && roles.includes(user.role),
    [user, profileStatus],
  )

  const value = useMemo(
    () => ({
      authUser,
      user,
      isInitializing,
      profileStatus,
      isAuthenticated: authUser !== null,
      can,
      role: user?.role ?? null,
      hasRole,
      refreshProfile,
    }),
    [authUser, user, isInitializing, profileStatus, can, hasRole, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}