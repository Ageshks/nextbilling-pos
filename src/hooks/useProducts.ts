import { useCallback, useEffect, useRef, useState } from 'react'
import { searchProducts, findProductByBarcode } from '../services/productService'
import { friendlyError } from '../utils/errors'
import type { Product } from '../types'
import { useDebounce } from './useOnlineStatus'

export interface UseProductSearchOptions {
  storeId: string
  includeInactive?: boolean
  debounceMs?: number
}

/**
 * Debounced product search for the POS. Returns best-matching products and a
 * helper to resolve a scanned barcode instantly.
 */
export function useProductSearch({ storeId, includeInactive = false, debounceMs = 200 }: UseProductSearchOptions) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, debounceMs)
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    if (!storeId) {
      setResults([])
      return
    }
    const text = debouncedQuery.trim()
    setLoading(true)
    setError(null)
    searchProducts(storeId, text, includeInactive)
      .then((found) => {
        if (requestId.current === id) setResults(found)
      })
      .catch((err) => {
        if (requestId.current === id) {
          setError(friendlyError(err))
          setResults([])
        }
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false)
      })
  }, [storeId, debouncedQuery, includeInactive])

  const scanBarcode = useCallback(
    async (barcode: string): Promise<Product | null> => {
      if (!storeId || !barcode.trim()) return null
      return findProductByBarcode(storeId, barcode)
    },
    [storeId],
  )

  return { query, setQuery, results, loading, error, scanBarcode }
}