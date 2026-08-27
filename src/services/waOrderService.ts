import { httpsCallable, getFunctions } from 'firebase/functions'
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import { getFirebaseApp } from '../firebase/config'
import type { WaOrder, WaOrderAction, WaPerformance, WaOrderStatus } from '../types/waOrder'

// ---------------------------------------------------------------------------
// Staff-facing WhatsApp order management. All mutations go through the
// `orderAction` Cloud Function so the lifecycle state machine is only ever
// enforced on the server — the browser can never write these documents.
// ---------------------------------------------------------------------------

export async function listWaOrders(
  storeId: string,
  opts?: { status?: WaOrderStatus | 'ALL'; max?: number },
): Promise<WaOrder[]> {
  const db = getDb()
  const max = opts?.max ?? 100
  let q
  if (opts?.status && opts.status !== 'ALL') {
    q = query(
      collection(db, COLLECTIONS.orders),
      where('storeId', '==', storeId),
      where('status', '==', opts.status),
      orderBy('createdAt', 'desc'),
      limit(max),
    )
  } else {
    q = query(
      collection(db, COLLECTIONS.orders),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(max),
    )
  }
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as WaOrder[]
}

export async function triggerOrderAction(
  orderId: string,
  action: WaOrderAction,
  itemIds?: string[],
): Promise<{ ok: boolean; message: string }> {
  const fn = httpsCallable<{ orderId: string; action: WaOrderAction; itemIds?: string[] }, { ok: boolean; message: string }>(
    getFunctions(getFirebaseApp()),
    'orderAction',
  )
  const res = await fn({ orderId, action, itemIds })
  return res.data
}

/** Computes today's WhatsApp performance card data (+ conversion rate). */
export async function waPerformanceToday(storeId: string): Promise<WaPerformance> {
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const orders = await listRecentOrdersSince(storeId, startToday.getTime())
  const paidLike = orders.filter((o) => o.paymentStatus === 'PAID')
  return buildPerformance(orders, paidLike)
}

async function listRecentOrdersSince(storeId: string, since: number): Promise<WaOrder[]> {
  const db = getDb()
  // Fetch a recent window and filter client-side — cheap even at scale since
  // docs are small and the composite index keeps this a single indexed read.
  const q = query(
    collection(db, COLLECTIONS.orders),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    limit(300),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as WaOrder)
    .filter((o) => typeof o.createdAt === 'number' && o.createdAt >= since)
}

export function buildPerformance(orders: WaOrder[], paidLike: WaOrder[]): WaPerformance {
  const totalCents = paidLike.reduce((a, o) => a + (o.total || 0), 0)
  return {
    ordersToday: orders.length,
    revenueToday: Math.round(totalCents),
    avgOrderValue: paidLike.length ? Math.round(totalCents / paidLike.length) : 0,
    pendingPayments: orders.filter((o) => o.status === 'AWAITING_PAYMENT').length,
    paidCount: orders.filter((o) => o.paymentStatus === 'PAID').length,
    readyCount: orders.filter((o) => o.status === 'READY_FOR_PICKUP').length,
    completedPickupsToday: orders.filter((o) => o.status === 'COMPLETED').length,
    cancelledCount: orders.filter((o) => o.status === 'CANCELLED' || o.status === 'EXPIRED').length,
    conversionRate: orders.length ? Math.round((paidLike.length / orders.length) * 100) : 0,
  }
}

/** Small helper for the dashboard stat row. */
export async function touchOrderWatchdog(_storeId: string): Promise<void> {
  void doc // keeps tree-shaking honest; no-op by design
}
