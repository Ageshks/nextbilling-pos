import { getFirestore, connectFirestoreEmulator, Timestamp, type Firestore, type DocumentData } from 'firebase/firestore'
import { getFirebaseApp } from './config'

let _db: Firestore | null = null

/**
 * True when the Firebase Emulator Suite should be used instead of the real
 * project. Set VITE_USE_EMULATORS=1 (e.g. in .env.emulator or the shell) and
 * start the suite with `npm run emulators`.
 */
export function useEmulators(): boolean {
  if (import.meta.env?.VITE_USE_EMULATORS === '1') return true
  // Node-based tooling (vitest) exposes VITE_* flags via process.env; the
  // browser does not have `process`, so guard via globalThis.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return env?.VITE_USE_EMULATORS === '1'
}

// Lazy database accessor. Only initializes (and therefore validates the
// Firebase config) when a data operation is actually attempted, so the
// application can still render a friendly setup screen when misconfigured.
export function getDb(): Firestore {
  if (!_db) {
    _db = getFirestore(getFirebaseApp())
    if (useEmulators()) {
      connectFirestoreEmulator(_db, '127.0.0.1', 8080)
    }
  }
  return _db
}

export const COLLECTIONS = {
  users: 'users',
  stores: 'stores',
  settings: 'settings',
  products: 'products',
  categories: 'categories',
  brands: 'brands',
  suppliers: 'suppliers',
  customers: 'customers',
  sales: 'sales',
  purchases: 'purchases',
  supplierPayments: 'supplierPayments',
  stockMovements: 'stockMovements',
  inventoryReturns: 'inventoryReturns',
  expenses: 'expenses',
  returns: 'returns',
  cashSessions: 'cashSessions',
  auditLogs: 'auditLogs',
  heldBills: 'heldBills',
  aiInsights: 'aiInsights',
  dailyInsights: 'dailyInsights',
  orders: 'orders',
  waConversations: 'waConversations',
  purchaseReturns: 'purchaseReturns',
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]

export type Timestamps = number | Timestamp | undefined

export function toMillis(value: Timestamps): number | undefined {
  if (value === undefined || value === null) return undefined
  if (value instanceof Timestamp) return value.toMillis()
  return value
}

// Converts raw Firestore document snapshots into typed records with the id
// included and timestamps normalized to epoch milliseconds.
export function unwrapDoc<T>(id: string, data: DocumentData): T {
  const plain: Record<string, unknown> = { ...data }
  for (const key of ['createdAt', 'updatedAt', 'openedAt', 'closedAt', 'purchaseDate', 'heldAt', 'timestamp', 'date', 'lastPurchaseAt']) {
    if (key in plain) plain[key] = toMillis(plain[key] as Timestamps)
  }
  return { ...(plain as object), id } as T
}

export function unwrapDocs<T>(docs: Array<{ id: string; data: () => DocumentData }>): T[] {
  return docs.map((d) => unwrapDoc<T>(d.id, d.data()))
}
