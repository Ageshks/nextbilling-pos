import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthChange, type FirebaseUser } from '../firebase/auth'
import { getUser } from '../services/userService'
import type { AppUser, Role, RolePermission } from '../types'
import { ROLES } from '../types'

interface AuthContextValue {
  authUser: FirebaseUser | null
  user: AppUser | null
  isInitializing: boolean
  can: (permission: keyof RolePermission) => boolean
  role: Role | null
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    let mounted = true
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      if (!mounted) return
      setAuthUser(firebaseUser)
      if (firebaseUser) {
        try {
          const appUser = await getUser(firebaseUser.uid)
          if (mounted) {
            setUser(appUser)
            if (appUser?.status === 'inactive') {
              setUser(null)
            }
          }
        } catch (err) {
          console.error('Failed to load user profile', err)
          if (mounted) setUser(null)
        }
      } else {
        if (mounted) setUser(null)
      }
      if (mounted) setIsInitializing(false)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const can = useCallback(
    (permission: keyof RolePermission): boolean => {
      if (!user) return false
      const perms = ROLES[user.role]
      if (!perms) return false
      if (perms.all) return true
      return Boolean(perms[permission])
    },
    [user],
  )

  const hasRole = useCallback((...roles: Role[]): boolean => {
    return user !== null && roles.includes(user.role)
  }, [user])

  const value = useMemo(
    () => ({ authUser, user, isInitializing, can, role: user?.role ?? null, hasRole }),
    [authUser, user, isInitializing, can, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}