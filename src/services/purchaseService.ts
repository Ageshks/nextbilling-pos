import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDoc, unwrapDocs } from '../firebase/firestore'
import type { Purchase, PurchaseItem, Product, PurchaseReturnItem, PurchaseReturn, PurchaseReturnMethod, CashSession } from '../types'
import { round2 } from '../utils/calculations'
import { formatInvoiceNumber } from '../utils/invoice'
import { stockMovementDocument } from './inventoryService'

export interface PurchaseDraft {
  storeId: string
  supplierId: string
  supplierName: string
  supplierInvoiceNumber: string
  purchaseDate: number
  items: PurchaseItem[]
  subtotal: number
  discount: number
  gstAmount: number
  total: number
  paidAmount: number
  notes: string
  createdBy: string
}

/**
 * Creates a purchase atomically:
 * - increases product stock
 * - writes PURCHASE stock movements
 * - updates supplier outstanding balances
 * - allocates the next purchase number
 */
export async function createPurchase(draft: PurchaseDraft): Promise<string> {
  const db = getDb()
  if (draft.items.length === 0) throw new Error('Add at least one product line')
  const year = new Date(draft.purchaseDate).getFullYear()

  const purchaseId = doc(collection(db, COLLECTIONS.purchases)).id
  await runTransaction(db, async (tx) => {
    // ---- Phase 1: ALL reads before ANY writes --------------------------------
    // Firestore transactions require every read to happen before the first
    // write; reading after a write throws INVALID_ARGUMENT and aborts the
    // whole transaction (this is exactly what broke purchase saving).
    const counterRef = doc(db, COLLECTIONS.stores, draft.storeId, 'counters', 'purchases')
    const supplierRef = draft.supplierId ? doc(db, COLLECTIONS.suppliers, draft.supplierId) : null

    // Aggregate repeated product lines (the same product listed more than
    // once on the purchase) so stock math stays correct.
    const quantityByProduct = new Map<string, number>()
    const nameByProduct = new Map<string, string>()
    for (const item of draft.items) {
      quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity)
      if (!nameByProduct.has(item.productId)) nameByProduct.set(item.productId, item.name)
    }
    const productIds = [...quantityByProduct.keys()]
    const productRefs = productIds.map((id) => doc(db, COLLECTIONS.products, id))

    const [counterSnap, productSnaps, supplierSnap] = await Promise.all([
      tx.get(counterRef),
      Promise.all(productRefs.map((ref) => tx.get(ref))),
      supplierRef ? tx.get(supplierRef) : Promise.resolve(null),
    ])

    // ---- Phase 2: writes ------------------------------------------------------
    const current = counterSnap.exists() ? (counterSnap.data()?.current as number) || 0 : 0
    const next = current + 1
    const purchaseNumber = `${formatInvoiceNumber('PO', year, next)}`

    const purchaseDoc: Omit<Purchase, 'id'> = {
      storeId: draft.storeId,
      purchaseNumber,
      supplierId: draft.supplierId,
      supplierName: draft.supplierName,
      supplierInvoiceNumber: draft.supplierInvoiceNumber,
      purchaseDate: Timestamp.fromMillis(draft.purchaseDate) as unknown as number,
      items: draft.items,
      subtotal: draft.subtotal,
      discount: draft.discount,
      gstAmount: draft.gstAmount,
      total: draft.total,
      paidAmount: draft.paidAmount,
      status: draft.paidAmount >= draft.total ? 'PAID' : draft.paidAmount > 0 ? 'PARTIAL' : 'UNPAID',
      notes: draft.notes,
      createdAt: serverTimestamp() as unknown as number,
      updatedAt: serverTimestamp() as unknown as number,
      createdBy: draft.createdBy,
    }
    tx.set(doc(db, COLLECTIONS.purchases, purchaseId), purchaseDoc)

    for (let idx = 0; idx < productIds.length; idx++) {
      const productId = productIds[idx]
      const productSnap = productSnaps[idx]
      if (!productSnap || !productSnap.exists()) {
        throw new Error(`Product ${nameByProduct.get(productId) ?? productId} not found`)
      }
      const quantity = quantityByProduct.get(productId) ?? 0
      const stock = productSnap.data().stock ?? 0
      const after = stock + quantity
      tx.update(productRefs[idx], { stock: after, updatedAt: serverTimestamp() })
      tx.set(doc(collection(db, COLLECTIONS.stockMovements)), stockMovementDocument({
        storeId: draft.storeId,
        product: { id: productId, name: nameByProduct.get(productId) ?? '', storeId: draft.storeId } as Product,
        type: 'PURCHASE',
        quantity,
        referenceType: 'PURCHASE',
        referenceId: purchaseId,
        notes: `${purchaseNumber} · ${draft.supplierName || 'Supplier'}`,
        createdBy: draft.createdBy,
        beforeStock: stock,
        afterStock: after,
      }))
    }

    if (supplierRef && supplierSnap) {
      const outstanding = supplierSnap.exists() ? supplierSnap.data().outstandingBalance ?? 0 : 0
      const totalPurchases = supplierSnap.exists() ? supplierSnap.data().totalPurchases ?? 0 : 0
      tx.set(
        supplierRef,
        {
          outstandingBalance: round2(outstanding + (draft.total - draft.paidAmount)),
          totalPurchases: round2(totalPurchases + draft.total),
          lastPurchaseAt: Timestamp.fromMillis(draft.purchaseDate),
        },
        { merge: true },
      )
    }

    tx.set(counterRef, { current: next, updatedAt: serverTimestamp() })
  })

  return purchaseId
}

export interface PurchaseFilter {
  storeId: string
  from?: number
  to?: number
  supplierId?: string
  max?: number
}

export interface PurchasePaymentDraft {
  storeId: string
  purchaseId: string
  amount: number
  method: 'CASH' | 'UPI' | 'CARD' | 'OTHER'
  notes: string
  createdBy: string
}

/**
 * Applies a later payment to an unpaid or partially-paid purchase. The purchase
 * status and supplier payable are updated together, and an immutable payment
 * entry is retained for reconciliation.
 */
export async function recordPurchasePayment(draft: PurchasePaymentDraft): Promise<void> {
  const db = getDb()
  const amount = round2(draft.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a payment amount greater than zero')

  await runTransaction(db, async (tx) => {
    const purchaseRef = doc(db, COLLECTIONS.purchases, draft.purchaseId)
    const purchaseSnap = await tx.get(purchaseRef)
    if (!purchaseSnap.exists()) throw new Error('Purchase not found')
    const purchase = purchaseSnap.data()
    if (purchase.storeId !== draft.storeId) throw new Error('This purchase belongs to another store')

    const supplierRef = purchase.supplierId ? doc(db, COLLECTIONS.suppliers, purchase.supplierId) : null
    const supplierSnap = supplierRef ? await tx.get(supplierRef) : null

    const total = round2(purchase.total ?? 0)
    const paid = round2(purchase.paidAmount ?? 0)
    const remaining = round2(Math.max(0, total - paid))
    if (remaining <= 0) throw new Error('This purchase is already fully paid')
    if (amount > remaining + 0.001) throw new Error(`Payment cannot exceed the remaining ${remaining}`)

    const nextPaid = round2(paid + amount)
    tx.update(purchaseRef, {
      paidAmount: nextPaid,
      status: nextPaid >= total - 0.001 ? 'PAID' : 'PARTIAL',
      updatedAt: serverTimestamp(),
      updatedBy: draft.createdBy,
    })

    if (supplierRef && supplierSnap?.exists()) {
      const outstanding = round2(supplierSnap.data().outstandingBalance ?? 0)
      tx.update(supplierRef, {
        outstandingBalance: round2(Math.max(0, outstanding - amount)),
        updatedAt: serverTimestamp(),
        updatedBy: draft.createdBy,
      })
    }

    tx.set(doc(collection(db, COLLECTIONS.supplierPayments)), {
      storeId: draft.storeId,
      purchaseId: draft.purchaseId,
      purchaseNumber: purchase.purchaseNumber ?? '',
      supplierId: purchase.supplierId ?? '',
      supplierName: purchase.supplierName ?? '',
      amount,
      method: draft.method,
      notes: draft.notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: draft.createdBy,
    })
  })
}

export async function listPurchases(filter: PurchaseFilter): Promise<Purchase[]> {
  const db = getDb()
  const base = collection(db, COLLECTIONS.purchases)
  let q = query(base, where('storeId', '==', filter.storeId), orderBy('createdAt', 'desc'), limit(filter.max ?? 100))
  if (filter.from && filter.to) {
    q = query(q, where('createdAt', '>=', Timestamp.fromMillis(filter.from)), where('createdAt', '<=', Timestamp.fromMillis(filter.to)))
  }
  const snap = await getDocs(q)
  // Firestore returns date fields as Timestamp instances. Convert them before
  // handing records to the UI, whose formatters operate on epoch milliseconds.
  let purchases = unwrapDocs<Purchase>(snap.docs)
  if (filter.supplierId) purchases = purchases.filter((p) => p.supplierId === filter.supplierId)
  return purchases
}

export async function getPurchase(id: string): Promise<Purchase | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.purchases, id))
  if (!snap.exists()) return null
  return unwrapDoc<Purchase>(snap.id, snap.data())
}

// ---------------------------------------------------------------------------
// Purchase returns (supplier returns)
// ---------------------------------------------------------------------------

export interface PurchaseReturnDraft {
  storeId: string
  purchaseId: string
  purchaseNumber: string
  supplierId: string
  supplierName: string
  items: PurchaseReturnItem[]
  method: PurchaseReturnMethod
  buyBackNet: number
  notes: string
  createdBy: string
}

/**
 * Returns items to the supplier atomically:
 * - decrements product stock (never below zero)
 * - writes PURCHASE_RETURN ledger movements
 * - reduces supplier payable / totalPurchases
 * - REFUND: reduces the OPEN cash session's drawer (cash physically leaves);
 *   BUYBACK: the refund is credited against replacement stock taken instead.
 * Throws (with the return already recorded) if REFUND is chosen with no open
 * session — the UI prompts the user to open one and retry.
 */
export async function createPurchaseReturn(draft: PurchaseReturnDraft): Promise<string> {
  const db = getDb()
  if (draft.items.length === 0) throw new Error('Add at least one item to return')
  if (draft.items.some((i) => i.quantity <= 0)) throw new Error('Return quantities must be positive')

  const openSessionQuery = query(
    collection(db, COLLECTIONS.cashSessions),
    where('storeId', '==', draft.storeId),
    where('status', '==', 'OPEN'),
    limit(1),
  )
  const returnRef = doc(collection(db, COLLECTIONS.purchaseReturns))

  let warnNoSession = false

  await runTransaction(db, async (tx) => {
    // ---- Phase 1: all reads first (transaction best practice) ---------------
    const productSnaps = await Promise.all(
      draft.items.map((item) => tx.get(doc(db, COLLECTIONS.products, item.productId))),
    )
    const sessionSnap = await getDocs(openSessionQuery)
    const supplierSnap = draft.supplierId
      ? await tx.get(doc(db, COLLECTIONS.suppliers, draft.supplierId))
      : null

    const session = sessionSnap.empty
      ? null
      : ({ ...(sessionSnap.docs[0].data() as object), id: sessionSnap.docs[0].id } as CashSession)
    if (!session) warnNoSession = true

    for (let idx = 0; idx < draft.items.length; idx++) {
      const item = draft.items[idx]
      const snap = productSnaps[idx]
      if (!item || !snap || !snap.exists()) throw new Error(`Product ${item?.name ?? 'item'} not found`)
      const stock = snap.data().stock ?? 0
      if (stock < item.quantity) {
        throw new Error(`Cannot return ${item.quantity} × ${item.name}: only ${stock} in stock`)
      }
    }

    // ---- Phase 2: writes ------------------------------------------------------
    for (let idx = 0; idx < draft.items.length; idx++) {
      const item = draft.items[idx]
      const snap = productSnaps[idx]
      if (!item || !snap || !snap.exists()) throw new Error(`Product ${item?.name ?? 'item'} not found`)
      const stock = snap.data().stock ?? 0
      const after = stock - item.quantity
      const productRef = doc(db, COLLECTIONS.products, item.productId)
      tx.update(productRef, { stock: after, updatedAt: serverTimestamp() })
      tx.set(doc(collection(db, COLLECTIONS.stockMovements)), stockMovementDocument({
        storeId: draft.storeId,
        product: { id: item.productId, name: item.name, storeId: draft.storeId } as Product,
        type: 'PURCHASE_RETURN',
        quantity: -item.quantity,
        referenceType: 'PURCHASE_RETURN',
        referenceId: returnRef.id,
        notes: `Return against ${draft.purchaseNumber} · ${draft.supplierName || 'Supplier'}`,
        createdBy: draft.createdBy,
        beforeStock: stock,
        afterStock: after,
      }))
    }

    const subtotal = round2(draft.items.reduce((s, i) => s + i.purchasePrice * i.quantity, 0))
    const gstAmount = round2(draft.items.reduce((s, i) => s + i.gstAmount, 0))
    const total = round2(subtotal + gstAmount)
    const buyBackNet = draft.method === 'BUYBACK' ? Math.min(round2(draft.buyBackNet), total) : 0
    const cashOut = draft.method === 'REFUND' ? total : round2(total - buyBackNet)
    const returnNumber = `PR-${new Date().getFullYear()}-${returnRef.id.slice(-6).toUpperCase()}`

    const returnDoc: Omit<PurchaseReturn, 'id'> = {
      storeId: draft.storeId,
      returnNumber,
      purchaseId: draft.purchaseId,
      purchaseNumber: draft.purchaseNumber,
      supplierId: draft.supplierId,
      supplierName: draft.supplierName,
      items: draft.items,
      subtotal,
      gstAmount,
      total,
      method: draft.method,
      cashOut,
      buyBackNet,
      notes: draft.notes,
      createdAt: serverTimestamp() as unknown as number,
      updatedAt: serverTimestamp() as unknown as number,
      createdBy: draft.createdBy,
    }
    tx.set(returnRef, returnDoc)

    if (supplierSnap && supplierSnap.exists()) {
      const s = supplierSnap.data()
      tx.update(doc(db, COLLECTIONS.suppliers, draft.supplierId), {
        outstandingBalance: round2(Math.max(0, (s.outstandingBalance ?? 0) - total)),
        totalPurchases: round2(Math.max(0, (s.totalPurchases ?? 0) - total)),
        updatedAt: serverTimestamp(),
      })
    }

    // Cash physically leaves the drawer only for the cash portion.
    if (session && cashOut > 0) {
      tx.update(doc(db, COLLECTIONS.cashSessions, session.id as string), {
        cashRefunds: round2((session.cashRefunds ?? 0) + cashOut),
        expectedCash: round2((session.expectedCash ?? 0) - cashOut),
        updatedAt: serverTimestamp(),
      })
    }
  })

  if (warnNoSession && draft.method === 'REFUND') {
    throw new Error('Return recorded, but no cash session is open. Open a cash session, then record the refund against the drawer.')
  }
  return returnRef.id
}
