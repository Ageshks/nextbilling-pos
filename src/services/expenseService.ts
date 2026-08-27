import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type { Expense, PaymentMethod } from '../types'

export interface ExpenseDraft {
  storeId: string
  category: string
  description: string
  amount: number
  paymentMethod: PaymentMethod
  date: number
  notes: string
  createdBy: string
}

export async function createExpense(input: ExpenseDraft): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.expenses), {
    storeId: input.storeId,
    category: input.category,
    description: input.description,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    date: new Date(input.date),
    notes: input.notes,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export interface ExpenseFilter {
  storeId: string
  from?: number
  to?: number
  category?: string
}

export async function listExpenses(filter: ExpenseFilter): Promise<Expense[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.expenses),
    where('storeId', '==', filter.storeId),
    orderBy('date', 'desc'),
  )
  const snap = await getDocs(q)
  let expenses = snap.docs
    .map((d) => ({ ...(d.data() as object), id: d.id }) as Expense)
    .filter((e) => {
      let ok = true
      if (filter.from && filter.to) {
        const d = e.date ?? 0
        ok = ok && d >= filter.from && d <= filter.to
      }
      if (filter.category && filter.category !== 'all') ok = ok && e.category === filter.category
      return ok
    })
  return expenses.slice(0, 200)
}