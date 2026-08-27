import { useEffect, useState } from 'react'
import { subscribeToCategories, subscribeToBrands } from '../services/categoryService'
import type { Brand, Category } from '../types'

interface LiveList<T> {
  items: T[]
  loading: boolean
  error: string | null
}

const EMPTY: LiveList<never> = { items: [], loading: true, error: null }

function useStoreCollection<T>(
  storeId: string | undefined,
  subscribe: (
    sid: string,
    onData: (rows: T[]) => void,
    onError: (err: Error) => void,
  ) => () => void,
  label: string,
): LiveList<T> {
  const [state, setState] = useState<LiveList<T>>(EMPTY)

  useEffect(() => {
    // Never attach a listener without a store (prevents cross-store leakage).
    if (!storeId) {
      setState({ items: [], loading: false, error: null })
      return
    }
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const unsubscribe = subscribe(
      storeId,
      (rows) => setState({ items: rows, loading: false, error: null }),
      (err) => {
        console.error(`${label} listener failed`, err)
        // A permission/index failure is NOT an empty list — surface it.
        setState({ items: [], loading: false, error: err.message || `Failed to load ${label}` })
      },
    )
    return unsubscribe
  }, [storeId, subscribe, label])

  return state
}

/** Real-time categories for the current store (live across tabs, no reloads). */
export function useCategories(storeId: string | undefined): LiveList<Category> {
  return useStoreCollection<Category>(storeId, subscribeToCategories, 'categories')
}

/** Real-time brands for the current store. */
export function useBrands(storeId: string | undefined): LiveList<Brand> {
  return useStoreCollection<Brand>(storeId, subscribeToBrands, 'brands')
}
