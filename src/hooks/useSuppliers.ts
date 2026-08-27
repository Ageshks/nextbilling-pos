import { useEffect, useState } from 'react'
import { subscribeToSuppliers } from '../services/supplierService'
import type { Supplier } from '../types'

export interface UseSuppliersResult {
  suppliers: Supplier[]
  loading: boolean
  error: string | null
}

/**
 * Real-time supplier list for the current store via Firestore onSnapshot.
 * Create/edit/deactivate flows only write to Firestore — the listener updates
 * React state automatically (no manual appends, no page reloads).
 */
export function useSuppliers(storeId: string | undefined): UseSuppliersResult {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) {
      setSuppliers([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const unsubscribe = subscribeToSuppliers(
      storeId,
      (rows) => {
        setSuppliers(rows)
        setLoading(false)
      },
      (err) => {
        console.error('suppliers listener failed', err)
        setError(err.message || 'Failed to load suppliers')
        setLoading(false)
      },
    )
    return unsubscribe
  }, [storeId])

  return { suppliers, loading, error }
}
