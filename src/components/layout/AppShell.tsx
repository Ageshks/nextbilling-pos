import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useStore } from '../../context/StoreContext'

export function AppShell() {
  const { settings } = useStore()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const storeName = settings?.name || 'SuperMart POS'

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60 lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-700">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
            {(storeName || 'S').charAt(0).toUpperCase()}
          </div>
          <span className="truncate text-sm font-bold">{storeName}</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <Sidebar currentPath={location.pathname} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl dark:bg-slate-800">
            <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-700">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                {(storeName || 'S').charAt(0).toUpperCase()}
              </div>
              <span className="truncate text-sm font-bold">{storeName}</span>
            </div>
            <div className="py-2">
              <Sidebar currentPath={location.pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileOpen(true)} storeName={storeName} />
        <main className="flex-1 p-3 pb-16 sm:p-4 lg:pb-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}