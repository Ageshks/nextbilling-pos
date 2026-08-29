import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Product } from '../types'
import { calculateTotals, clampQty, round2, type TotalsResult } from '../utils/calculations'

export interface CartLine {
  productId: string
  name: string
  barcode: string
  sku: string
  unit: string
  quantity: number
  sellingPrice: number
  purchasePrice: number
  mrp: number
  gstRate: number
  discount: number
  stock: number
  trackInventory: boolean
}

export interface CartCustomer {
  id: string
  name: string
}

interface PersistedCart {
  items: CartLine[]
  billDiscount: number
  customer: CartCustomer
  savedAt: number
}

interface CartContextValue {
  items: CartLine[]
  customer: CartCustomer
  billDiscount: number
  totals: TotalsResult
  itemCount: number
  hasSavedCart: boolean
  addProduct: (product: Product, quantity?: number) => void
  setQuantity: (productId: string, quantity: number) => void
  increment: (productId: string) => void
  decrement: (productId: string) => void
    setLineDiscount: (productId: string, discount: number) => void
  removeLine: (productId: string) => void
  setItems: (items: CartLine[]) => void
  clearCart: () => void
  setBillDiscount: (amount: number) => void
  setCustomer: (customer: CartCustomer) => void
  restoreSaved: () => void
  discardSaved: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

function storageKey(userId: string): string {
    return `nextbilling:cart:${userId}`
}

export function CartProvider({ userId, settings, children }: { userId: string; settings: { gstIncluded?: boolean } | null; children: ReactNode }) {
    const [items, setItemsState] = useState<CartLine[]>([])
  const [billDiscount, setBillDiscountState] = useState(0)
  const [customer, setCustomerState] = useState<CartCustomer>({ id: 'walkin', name: 'Walk-in Customer' })
  const [hasSavedCart, setHasSavedCart] = useState(false)

  const key = storageKey(userId)

  // Persist on every change so an accidental refresh never loses the bill.
  useEffect(() => {
    if (items.length === 0 && billDiscount === 0) {
      localStorage.removeItem(key)
      return
    }
    const payload: PersistedCart = { items, billDiscount, customer, savedAt: Date.now() }
    localStorage.setItem(key, JSON.stringify(payload))
  }, [items, billDiscount, customer, key])

  const addProduct = useCallback((product: Product, quantity?: number) => {
        const qty = quantity && quantity > 0 ? quantity : 1
    setItemsState((prev) => {
      const existing = prev.find((l) => l.productId === product.id)
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: clampQty(l.quantity + qty) } : l,
        )
      }
      const line: CartLine = {
        productId: product.id ?? product.barcode,
        name: product.name,
        barcode: product.barcode,
        sku: product.sku,
        unit: product.unit,
        quantity: clampQty(qty),
        sellingPrice: product.sellingPrice,
        purchasePrice: product.purchasePrice,
        mrp: product.mrp,
        gstRate: product.gstRate,
        discount: 0,
        stock: product.stock ?? 0,
        trackInventory: product.trackInventory ?? true,
      }
      return [...prev, line]
    })
  }, [])

    const setQuantity = useCallback((productId: string, quantity: number) => {
    const q = clampQty(quantity)
    setItemsState((prev) =>
      q <= 0 ? prev.filter((l) => l.productId !== productId) : prev.map((l) => (l.productId === productId ? { ...l, quantity: q } : l)),
    )
  }, [])

  const setItems = useCallback((next: CartLine[]) => {
    setItemsState(next)
  }, [])

  const increment = useCallback((productId: string) => {
    setItemsState((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, quantity: clampQty(l.quantity + 1) } : l)),
    )
  }, [])

  const decrement = useCallback((productId: string) => {
    setItemsState((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: clampQty(l.quantity - 1) } : l))
        .filter((l) => l.quantity > 0),
    )
  }, [])

  const setLineDiscount = useCallback((productId: string, discount: number) => {
    setItemsState((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l
        const maxDiscount = round2(l.sellingPrice * l.quantity)
        return { ...l, discount: clampQty(Math.min(Math.max(discount, 0), maxDiscount), 2) }
      }),
    )
  }, [])

  const removeLine = useCallback((productId: string) => {
    setItemsState((prev) => prev.filter((l) => l.productId !== productId))
  }, [])

  const clearCart = useCallback(() => {
    setItemsState([])
    setBillDiscountState(0)
    setCustomerState({ id: 'walkin', name: 'Walk-in Customer' })
  }, [])

  const setBillDiscount = useCallback((amount: number) => {
    setBillDiscountState(Math.max(0, amount))
  }, [])

  const setCustomer = useCallback((c: CartCustomer) => setCustomerState(c), [])

  const restoreSaved = useCallback(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const saved = JSON.parse(raw) as PersistedCart
      setItemsState(saved.items ?? [])
      setBillDiscountState(saved.billDiscount ?? 0)
      setCustomerState(saved.customer ?? { id: 'walkin', name: 'Walk-in Customer' })
      setHasSavedCart(false)
    } catch {
      localStorage.removeItem(key)
    }
  }, [key])

  const discardSaved = useCallback(() => {
    localStorage.removeItem(key)
    setHasSavedCart(false)
  }, [key])

  // Detect a saved bill on first load (after an accidental refresh).
  useEffect(() => {
    if (localStorage.getItem(key)) setHasSavedCart(true)
  }, [key])

  const totals = useMemo(
    () =>
      calculateTotals(
        items.map((l) => ({
          unitPrice: l.sellingPrice,
          quantity: l.quantity,
          gstRate: l.gstRate,
          discount: l.discount,
        })),
        billDiscount,
        settings?.gstIncluded ?? true,
      ),
    [items, billDiscount, settings?.gstIncluded],
  )

  const itemCount = useMemo(() => round2(items.reduce((sum, l) => sum + l.quantity, 0)), [items])

  const value = useMemo(
    () => ({
      items,
      customer,
      billDiscount,
      totals,
      itemCount,
      hasSavedCart,
      addProduct,
      setQuantity,
      increment,
      decrement,
             setLineDiscount,
      removeLine,
      setItems,
      clearCart,
      setBillDiscount,
      setCustomer,
      restoreSaved,
      discardSaved,
    }),
         [items, customer, billDiscount, totals, itemCount, hasSavedCart, addProduct, setQuantity, increment, decrement, setLineDiscount, removeLine, setItems, clearCart, setBillDiscount, setCustomer, restoreSaved, discardSaved],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}