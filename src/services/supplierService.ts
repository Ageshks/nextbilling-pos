import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { Supplier } from '../types'

export interface SupplierDraft {
  name: string
  company: string
  phone: string
  email: string
  address: string
  gstNumber: string
  notes: string
}

const byName = (a: Supplier, b: Supplier): number => (a.name ?? '').localeCompare(b.name ?? '')

/**
 * Real-time supplier list for the current store. The listener is the single
 * source of truth for the UI — create/update flows never mutate local state
 * manually (the snapshot fires automatically, preventing duplicates).
 * Query is storeId-equality ONLY (no composite index required) and sorted
 * client-side. Returns an unsubscribe function.
 */
export function subscribeToSuppliers(
  storeId: string,
  onData: (rows: Supplier[]) => void,
  onError: (err: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), COLLECTIONS.suppliers),
    where('storeId', '==', storeId),
  )
  return onSnapshot(
    q,
    (snap) => {
      const all = unwrapDocs<Supplier>(snap.docs)
        .filter((s) => s.active !== false)
        .sort(byName)
      onData(all)
    },
    onError,
  )
}

export async function listSuppliers(storeId: string): Promise<Supplier[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.suppliers),
    where('storeId', '==', storeId),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Supplier>(snap.docs).sort(byName)
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.suppliers, id))
  if (!snap.exists()) return null
  return { ...(snap.data() as object), id: snap.id } as Supplier
}

export async function createSupplier(
  storeId: string,
  data: SupplierDraft,
  createdBy: string,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.suppliers), {
    storeId,
    ...data,
    outstandingBalance: 0,
    totalPurchases: 0,
    lastPurchaseAt: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

export async function updateSupplier(
  id: string,
  data: Partial<SupplierDraft>,
  updatedBy: string,
): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.suppliers, id), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

/**
 * Soft-delete — purchases referencing this supplier keep historical names.
 * The realtime listener drops inactive rows automatically.
 */
export async function deactivateSupplier(id: string, updatedBy: string): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.suppliers, id), {
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

export async function restoreSupplier(id: string, updatedBy: string): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.suppliers, id), {
    active: true,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}