import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { CashSession, Sale, Expense } from '../types'
import { round2 } from '../utils/calculations'

export async function getOpenSession(storeId: string, cashierId: string): Promise<CashSession | null> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.cashSessions),
    where('storeId', '==', storeId),
    where('userId', '==', cashierId),
    where('status', '==', 'OPEN'),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return { ...(d.data() as object), id: d.id } as CashSession
}

export async function openSession(
  storeId: string,
  cashierId: string,
  cashierName: string,
  openingCash: number,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.cashSessions), {
    storeId,
    userId: cashierId,
    userName: cashierName,
    openedAt: Timestamp.now(),
    closedAt: null,
    openingCash,
    cashSales: 0,
    cashExpenses: 0,
    cashRefunds: 0,
    cashDeposits: 0,
    cashWithdrawals: 0,
    expectedCash: 0,
    declaredCash: null,
    difference: 0,
    status: 'OPEN',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

function sumPaymentsMethod(sales: Sale[], method: 'CASH'): number {
  return round2(
    sales.reduce((sum, s) => sum + (s.payments?.filter((p) => p.method === method).reduce((a, b) => a + b.amount, 0) ?? 0), 0),
  )
}

export interface CloseSessionResult {
  sessionId: string
  expectedCash: number
  cashSales: number
  cashExpenses: number
  cashRefunds: number
  difference: number
}

/**
 * Closes the cashier session. Expected cash is computed from actual sales /
 * expenses / refunds recorded during the session window, never trusted from
 * the client.
 */
export async function closeSession(
  sessionId: string,
  storeId: string,
  declaredCash: number,
): Promise<CloseSessionResult> {
  const db = getDb()
  const sessionRef = doc(db, COLLECTIONS.cashSessions, sessionId)
  const sessionSnap = await getDoc(sessionRef)
  if (!sessionSnap.exists()) throw new Error('Cash session not found')
  const session = sessionSnap.data()

  const from = (session.openedAt as Timestamp).toMillis()
  const now = Timestamp.now()

  const [salesSnap, expensesSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, COLLECTIONS.sales),
        where('storeId', '==', storeId),
        where('createdAt', '>=', Timestamp.fromMillis(from)),
        where('createdAt', '<=', now),
      ),
    ),
    getDocs(
      query(
        collection(db, COLLECTIONS.expenses),
        where('storeId', '==', storeId),
        where('date', '>=', Timestamp.fromMillis(from)),
        where('date', '<=', now),
      ),
    ),
  ])

  const cashSales = sumPaymentsMethod(salesSnap.docs.map((d) => ({ ...(d.data() as object) }) as Sale), 'CASH')
  const cashExpenses = round2(
    expensesSnap.docs
      .map((d) => d.data() as Expense)
      .filter((e) => e.paymentMethod === 'CASH')
      .reduce((sum, e) => sum + e.amount, 0),
  )
  const cashRefunds = round2(
    salesSnap.docs
      .map((d) => d.data() as Sale)
      .filter((s) => s.status !== 'COMPLETED')
      .reduce((sum, s) => sum + (s.returnInfo?.refundTotal ?? 0), 0),
  )

  const expectedCash = round2(
    (session.openingCash ?? 0) + cashSales - cashExpenses - cashRefunds,
  )
  const difference = round2(declaredCash - expectedCash)

  await updateDoc(sessionRef, {
    closedAt: now,
    cashSales,
    cashExpenses,
    cashRefunds,
    expectedCash,
    declaredCash,
    difference,
    status: 'CLOSED',
    updatedAt: serverTimestamp(),
  })

  return { sessionId, expectedCash, cashSales, cashExpenses, cashRefunds, difference }
}

export async function listSessions(storeId: string, max = 50): Promise<CashSession[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.cashSessions),
    where('storeId', '==', storeId),
    orderBy('openedAt', 'desc'),
    limit(max),
  )
  const snap = await getDocs(q)
  return unwrapDocs<CashSession>(snap.docs)
}