import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { getSettings, DEFAULT_SETTINGS } from '../services/settingsService'
import { friendlyError } from '../utils/errors'
import type { StoreSettings } from '../types'

interface StoreContextValue {
  settings: StoreSettings | null
  loading: boolean
  error: string | null
  reloadSettings: () => Promise<void>
  patchSettings: (patch: Partial<StoreSettings>) => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadSettings = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const found = await getSettings(user.storeId)
      setSettings(found)
      setError(null)
    } catch (err) {
      const message = friendlyError(err)
      setError(message)
      // Fall back to defaults so the UI never shows a blank screen.
      setSettings({ storeId: user.storeId, ...DEFAULT_SETTINGS } as StoreSettings)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void reloadSettings()
  }, [reloadSettings])

  const patchSettings = useCallback((patch: Partial<StoreSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const value = useMemo(
    () => ({ settings, loading, error, reloadSettings, patchSettings }),
    [settings, loading, error, reloadSettings, patchSettings],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}