import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { RolePermission } from '../types'

interface ProtectedRouteProps {
  children: ReactNode
  permission?: keyof RolePermission
}

export function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { authUser, user, isInitializing, can } = useAuth()
  const location = useLocation()

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
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (!user) {
    // Authenticated but profile missing/inactive -> first-run setup or disabled.
    return <Navigate to="/setup" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}