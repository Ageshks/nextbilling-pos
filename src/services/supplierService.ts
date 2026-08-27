import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
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

export async function listSuppliers(storeId: string): Promise<Supplier[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.suppliers),
    where('storeId', '==', storeId),
    orderBy('name', 'asc'),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Supplier>(snap.docs)
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