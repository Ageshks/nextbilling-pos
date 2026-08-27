import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  increment,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { Customer } from '../types'

export interface CustomerDraft {
  name: string
  phone: string
  email: string
  address: string
  notes: string
}

const WALK_IN_ID = 'walkin'
const WALK_IN: Customer = {
  id: WALK_IN_ID,
  storeId: '',
  name: 'Walk-in Customer',
  phone: '',
  email: '',
  address: '',
  notes: '',
  creditBalance: 0,
  totalSpent: 0,
  lastPurchaseAt: 0,
}

export function isWalkIn(id: string): boolean {
  return id === WALK_IN_ID
}

export function walkInCustomer(): Customer {
  return WALK_IN
}

export async function listCustomers(storeId: string): Promise<Customer[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.customers),
    where('storeId', '==', storeId),
    orderBy('name', 'asc'),
    limit(500),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Customer>(snap.docs)
}

export async function searchCustomers(storeId: string, text: string): Promise<Customer[]> {
  const t = text.trim().toLowerCase()
  if (!t) return []
  const all = await listCustomers(storeId)
  return all
    .filter(
      (c) =>
        c.name.toLowerCase().includes(t) ||
        c.phone.includes(t) ||
        c.email.toLowerCase().includes(t),
    )
    .slice(0, 20)
}

export async function getCustomer(id: string): Promise<Customer | null> {
  if (id === WALK_IN_ID) return WALK_IN
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.customers, id))
  if (!snap.exists()) return null
  return { ...(snap.data() as object), id: snap.id } as Customer
}

export async function createCustomer(
  storeId: string,
  data: CustomerDraft,
  createdBy: string,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.customers), {
    storeId,
    ...data,
    creditBalance: 0,
    totalSpent: 0,
    lastPurchaseAt: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

export async function updateCustomer(
  id: string,
  data: Partial<CustomerDraft>,
  updatedBy: string,
): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.customers, id), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

export async function listCreditCustomers(storeId: string): Promise<Customer[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.customers),
    where('storeId', '==', storeId),
    where('creditBalance', '>', 0),
    orderBy('creditBalance', 'desc'),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Customer>(snap.docs)
}

/**
 * Records a udhaar (credit) collection against a customer. Uses Firestore's
 * atomic increment so concurrent collections can never lose an update.
 */
export async function recordCreditPayment(
  customerId: string,
  amount: number,
  collectedBy: string,
): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.customers, customerId), {
    creditBalance: increment(-amount),
    updatedAt: serverTimestamp(),
    updatedBy: collectedBy,
  })
}