import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Menu,
  Search,
  Bell,
  Sun,
  Moon,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  PackageX,
  CloudUpload,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useTheme } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { logout } from '../../firebase/auth'
import { searchProducts } from '../../services/productService'
import { listLowStock, listOutOfStock } from '../../services/inventoryService'
import { readPendingQueue } from '../../services/salesService'
import { formatMoney } from '../../utils/format'
import { friendlyError } from '../../utils/errors'

interface TopbarProps {
  onMenuClick: () => void
  storeName: string
}

export function Topbar({ onMenuClick, storeName }: TopbarProps) {
  const { user } = useAuth()
  const { settings } = useStore()
  const { theme, toggleTheme } = useTheme()
  const { notify } = useToast()
  const navigate = useNavigate()
  const status = useOnlineStatus()

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; sellingPrice: number; barcode: string }>>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [lowStock, setLowStock] = useState(0)
  const [outOfStock, setOutOfStock] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (!user) return
    let mounted = true
    Promise.all([listLowStock(user.storeId), listOutOfStock(user.storeId), Promise.resolve(readPendingQueue().length)])
      .then(([low, out, pending]) => {
        if (mounted) {
          setLowStock(low.length)
          setOutOfStock(out.length)
          setPendingCount(pending)
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [user, notifOpen])

  const onSearchChange = useCallback(
    (value: string) => {
      setSearchText(value)
      window.clearTimeout(searchTimer.current)
      if (!user || value.trim().length < 1) {
        setSearchResults([])
        setSearchOpen(false)
        return
      }
      searchTimer.current = window.setTimeout(async () => {
        try {
          const found = await searchProducts(user.storeId, value, false, 200)
          setSearchResults(found.map((p) => ({ id: p.id ?? '', name: p.name, sellingPrice: p.sellingPrice, barcode: p.barcode })).slice(0, 8))
          setSearchOpen(true)
        } catch {
          setSearchResults([])
        }
      }, 220)
    },
    [user],
  )

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login')
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Logout failed' })
    }
  }

  const currency = settings?.currency ?? 'INR'

  const statusUi = useMemo(() => {
    if (status === 'offline') {
      return { label: 'OFFLINE', icon: WifiOff, cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', title: 'Working offline. Sales will be queued locally.' }
    }
    if (status === 'unknown') {
      return { label: 'SYNCING', icon: RefreshCw, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', title: 'Checking connection…' }
    }
    return { label: 'ONLINE', icon: Wifi, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', title: 'Connected.' }
  }, [status])

  const StatusIcon = statusUi.icon

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onMenuClick}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-700"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0">
        <h1 className="truncate text-sm font-bold text-slate-900 dark:text-white sm:text-base">{storeName}</h1>
      </div>

      <span
        className={`ml-1 hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex ${statusUi.cls}`}
        title={statusUi.title}
      >
        <StatusIcon className="h-3 w-3" aria-hidden="true" />
        {statusUi.label}
      </span>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <div ref={searchBoxRef} className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
            placeholder="Search products…"
            aria-label="Search products"
            className="w-48 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 outline-none transition-all focus:w-64 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 lg:w-56 lg:focus:w-72"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute right-0 top-full mt-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40"
                  onClick={() => {
                    setSearchOpen(false)
                    setSearchText('')
                    navigate('/products')
                  }}
                >
                  <span className="truncate text-slate-800 dark:text-slate-200">{r.name}</span>
                  <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
                    {formatMoney(r.sellingPrice, currency)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {(lowStock > 0 || outOfStock > 0 || pendingCount > 0) && (
              <span className="absolute right-1 top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white">
                {lowStock + outOfStock + pendingCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-200">
                Alerts
              </div>
              <div className="max-h-72 overflow-y-auto">
                {pendingCount > 0 && (
                  <button type="button" onClick={() => navigate('/sales')} className="flex w-full gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                    <span className="text-slate-700 dark:text-slate-200">{pendingCount} sale{pendingCount > 1 ? 's' : ''} waiting to sync.</span>
                  </button>
                )}
                {lowStock > 0 && (
                  <button type="button" onClick={() => navigate('/inventory')} className="flex w-full gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                    <span className="text-slate-700 dark:text-slate-200">{lowStock} products are running low on stock.</span>
                  </button>
                )}
                {outOfStock > 0 && (
                  <button type="button" onClick={() => navigate('/inventory')} className="flex w-full gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
                    <span className="text-slate-700 dark:text-slate-200">{outOfStock} products are out of stock.</span>
                  </button>
                )}
                {lowStock === 0 && outOfStock === 0 && pendingCount === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">All good. No alerts right now.</p>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>

        <div className="hidden items-center gap-2 sm:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            {(user?.name ?? 'U').charAt(0).toUpperCase()}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{user?.name ?? 'User'}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{user?.role ?? ''}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10"
          aria-label="Logout"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}