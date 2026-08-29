import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  getDocs,
  getDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type { Sale, SaleItem, SalePayment, HeldBill, PaymentMethod, Product } from '../types'
import { formatInvoiceNumber } from '../utils/invoice'
import { round2 } from '../utils/calculations'
import { stockMovementDocument } from './inventoryService'

export interface SaleDraft {
  storeId: string
  customerId: string
  customerName: string
  cashierId: string
  cashierName: string
  items: SaleItem[]
  subtotal: number
  discount: number
  taxableAmount: number
  gstAmount: number
  total: number
  gstIncluded: boolean
  payments: SalePayment[]
  amountReceived: number
  changeGiven: number
  creditAmount: number
  notes: string
  heldBillId: string
  invoicePrefix: string
  enableNegativeStock: boolean
  currency: string
}

export interface CompleteSaleResult {
  sale: Sale
  invoiceNumber: string
}

export class SaleError extends Error {
  kind: 'STOCK' | 'NOT_FOUND' | 'INACTIVE' | 'GENERAL'
  constructor(kind: 'STOCK' | 'NOT_FOUND' | 'INACTIVE' | 'GENERAL', message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * Completes a sale atomically:
 *   - validates & deducts stock per item
 *   - allocates the next sequential invoice number (collision-safe counter)
 *   - creates the sale record
 *   - writes stock movements
 *   - updates customer balances
 * All in a single Firestore transaction so stock + sale stay consistent.
 */
export async function completeSale(draft: SaleDraft): Promise<CompleteSaleResult> {
  const db = getDb()
  const year = new Date().getFullYear()

  const result = await runTransaction(db, async (tx) => {
    // 1. Validate and plan stock deductions.
    const stockCache = new Map<string, { before: number; after: number }>()
    for (const item of draft.items) {
      if (!item.productId) throw new SaleError('GENERAL', 'Invalid product in cart')
      const snap = await tx.get(doc(db, COLLECTIONS.products, item.productId))
      if (!snap.exists()) throw new SaleError('NOT_FOUND', `Product ${item.name} no longer exists`)
      const data = snap.data()
      if (data.active === false) throw new SaleError('INACTIVE', `${item.name} is inactive`)
      const stock = data.stock ?? 0
      const after = stock - item.quantity
      if (after < 0 && !draft.enableNegativeStock) {
        throw new SaleError(
          'STOCK',
          `Only ${stock} ${data.unit ?? ''} of ${item.name} in stock (need ${item.quantity}).`,
        )
      }
      stockCache.set(item.productId, { before: stock, after })
    }

    // 2. Allocate the next invoice number from the counter subcollection.
    const counterRef = doc(db, COLLECTIONS.stores, draft.storeId, 'counters', 'sales')
    const counterSnap = await tx.get(counterRef)
    const current = counterSnap.exists() ? (counterSnap.data()?.current as number) || 0 : 0
    const next = current + 1
    const invoiceNumber = formatInvoiceNumber(draft.invoicePrefix || 'SM', year, next)

    // 3. Create the sale document.
    const saleId = doc(collection(db, COLLECTIONS.sales)).id
    const saleDoc: Omit<Sale, 'id'> = {
      storeId: draft.storeId,
      invoiceNumber,
      customerId: draft.customerId,
      customerName: draft.customerName || 'Walk-in Customer',
      cashierId: draft.cashierId,
      cashierName: draft.cashierName,
      items: draft.items,
      subtotal: draft.subtotal,
      discount: draft.discount,
      taxableAmount: draft.taxableAmount,
      gstAmount: draft.gstAmount,
      total: draft.total,
      amountReceived: draft.amountReceived,
      changeGiven: draft.changeGiven,
      creditAmount: draft.creditAmount,
      amountPaid: draft.total,
      payments: draft.payments,
      status: 'COMPLETED',
      notes: draft.notes,
      heldBillId: draft.heldBillId || '',
            createdAt: serverTimestamp() as unknown as number,
      updatedAt: serverTimestamp() as unknown as number,
      createdBy: draft.cashierId,
    }
    tx.set(doc(db, COLLECTIONS.sales, saleId), saleDoc)

    // 4. Deduct stock + write a movement per item.
    for (const item of draft.items) {
      const stock = stockCache.get(item.productId)
      if (!stock) continue
      tx.update(doc(db, COLLECTIONS.products, item.productId), {
        stock: stock.after,
        updatedAt: serverTimestamp(),
      })
      tx.set(doc(collection(db, COLLECTIONS.stockMovements)), stockMovementDocument({
        storeId: draft.storeId,
        product: { id: item.productId, name: item.name, storeId: draft.storeId } as Product,
        type: 'SALE',
        quantity: -item.quantity,
        referenceType: 'SALE',
        referenceId: saleId,
        notes: `${invoiceNumber}`,
        createdBy: draft.cashierId,
        beforeStock: stock.before,
        afterStock: stock.after,
      }))
    }

    // 5. Advance the counter for the next invoice number.
    tx.set(counterRef, { current: next, updatedAt: serverTimestamp() })

    // 6. Update customer balance.
    if (draft.customerId) {
      const customerRef = doc(db, COLLECTIONS.customers, draft.customerId)
      const customerSnap = await tx.get(customerRef)
      const debt = customerSnap.exists() ? (customerSnap.data().creditBalance ?? 0) : 0
      const spent = customerSnap.exists() ? (customerSnap.data().totalSpent ?? 0) : 0
      tx.set(
        customerRef,
        {
          creditBalance: debt + (draft.creditAmount || 0),
          totalSpent: spent + draft.total,
          lastPurchaseAt: Timestamp.now(),
        },
        { merge: true },
      )
    }

    return { saleId, invoiceNumber }
  })

  const sale: Sale = {
    ...draft,
    id: result.saleId,
    invoiceNumber: result.invoiceNumber,
    status: 'COMPLETED',
    amountPaid: draft.total,
    customerName: draft.customerName || 'Cash Customer',
  } as Sale

  return { sale, invoiceNumber: result.invoiceNumber }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface SalesFilter {
  storeId: string
  from?: number
  to?: number
  paymentMethod?: PaymentMethod | 'all'
  cashierId?: string
  status?: string
  search?: string
  max?: number
  cursorDate?: number
}

export async function listSales(filter: SalesFilter): Promise<Sale[]> {
  const db = getDb()
  const base = collection(db, COLLECTIONS.sales)
  let q = query(base, where('storeId', '==', filter.storeId), orderBy('createdAt', 'desc'), limit(filter.max ?? 100))

  if (filter.from && filter.to) {
    q = query(q, where('createdAt', '>=', Timestamp.fromMillis(filter.from)), where('createdAt', '<=', Timestamp.fromMillis(filter.to)))
  } else if (filter.from) {
    q = query(q, where('createdAt', '>=', Timestamp.fromMillis(filter.from)))
  }

  const snap = await getDocs(q)
  let sales = snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Sale)

  if (filter.paymentMethod && filter.paymentMethod !== 'all') {
    sales = sales.filter((s) => s.payments?.some((p) => p.method === filter.paymentMethod))
  }
  if (filter.cashierId) sales = sales.filter((s) => s.cashierId === filter.cashierId)
  if (filter.status && filter.status !== 'all') sales = sales.filter((s) => s.status === filter.status)
  if (filter.search) {
    const t = filter.search.toLowerCase()
    sales = sales.filter((s) => s.invoiceNumber.toLowerCase().includes(t) || s.customerName.toLowerCase().includes(t))
  }
  return sales
}

export async function getSale(id: string): Promise<Sale | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.sales, id))
  if (!snap.exists()) return null
  return { ...(snap.data() as object), id: snap.id } as Sale
}

export async function findSaleByInvoice(storeId: string, invoiceNumber: string): Promise<Sale | null> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.sales),
    where('storeId', '==', storeId),
    where('invoiceNumber', '==', invoiceNumber.trim().toUpperCase()),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return { ...(d.data() as object), id: d.id } as Sale
}

// ---------------------------------------------------------------------------
// Held bills
// ---------------------------------------------------------------------------

export async function saveHeldBill(storeId: string, held: Omit<HeldBill, 'id' | 'storeId'>): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.heldBills), {
    storeId,
    ...held,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function listHeldBills(storeId: string): Promise<HeldBill[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.heldBills),
    where('storeId', '==', storeId),
    orderBy('heldAt', 'desc'),
    limit(50),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as HeldBill)
}

export async function deleteHeldBill(id: string): Promise<void> {
  const db = getDb()
  await deleteDoc(doc(db, COLLECTIONS.heldBills, id))
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export interface SaleReturnItemInput {
  productId: string
  name: string
  quantity: number
  sellingPrice: number
  purchasePrice: number
}

export interface ReturnInput {
  storeId: string
  saleId: string
  invoiceNumber: string
  customerId: string
  cashierId: string
  cashierName: string
  items: SaleReturnItemInput[]
  refundAmount: number
  reason: string
}

/**
 * Processes a return atomically:
 * restores stock, writes RETURN stock movements, records the return document,
 * applies the refund against the original sale (which is never deleted).
 */
export async function processReturn(input: ReturnInput): Promise<string> {
  const db = getDb()
  const returnId = doc(collection(db, COLLECTIONS.returns)).id

  await runTransaction(db, async (tx) => {
    const saleRef = doc(db, COLLECTIONS.sales, input.saleId)
    const saleSnap = await tx.get(saleRef)
    if (!saleSnap.exists()) throw new Error('Invoice not found')
    const sale = saleSnap.data()
    if (sale.status === 'CANCELLED') throw new Error('This invoice was cancelled.')

    // Restore stock for each returned item
    for (const item of input.items) {
      const productSnap = await tx.get(doc(db, COLLECTIONS.products, item.productId))
      if (productSnap.exists()) {
        const stock = productSnap.data().stock ?? 0
        const after = stock + item.quantity
        tx.update(doc(db, COLLECTIONS.products, item.productId), {
          stock: after,
          updatedAt: serverTimestamp(),
        })
        tx.set(doc(collection(db, COLLECTIONS.stockMovements)), {
          storeId: input.storeId,
          productId: item.productId,
          productName: item.name,
          type: 'RETURN',
          quantity: item.quantity,
          beforeStock: stock,
          afterStock: after,
          referenceType: 'RETURN',
          referenceId: returnId,
          notes: `${input.invoiceNumber} return`,
          createdBy: input.cashierId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
    }

    const alreadyReturned = sale.returnInfo?.returnedQtyTotal ?? 0
    const newReturned = input.items.reduce((sum, it) => sum + it.quantity, 0)
    const totalQtySold = (sale.items as SaleItem[]).reduce((sum, it) => sum + it.quantity, 0)
    const nextReturned = alreadyReturned + newReturned
    const fullyReturned = nextReturned >= totalQtySold - 0.005

    tx.update(saleRef, {
      status: fullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED',
      returnInfo: {
        returnedQtyTotal: nextReturned,
        refundTotal: (sale.returnInfo?.refundTotal ?? 0) + input.refundAmount,
      },
      updatedAt: serverTimestamp(),
    })

    tx.set(doc(db, COLLECTIONS.returns, returnId), {
      storeId: input.storeId,
      saleId: input.saleId,
      invoiceNumber: input.invoiceNumber,
      customerId: input.customerId,
      cashierId: input.cashierId,
      items: input.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        quantity: it.quantity,
        sellingPrice: it.sellingPrice,
        purchasePrice: it.purchasePrice,
        refundAmount: round2(it.sellingPrice * it.quantity),
      })),
      refundAmount: input.refundAmount,
      reason: input.reason,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: input.cashierId,
    })
  })

  return returnId
}

// ---------------------------------------------------------------------------
// Cancel sale (void). Restores the sold stock and marks the sale CANCELLED.
// Original sale is never deleted.
// ---------------------------------------------------------------------------

export async function cancelSale(saleId: string, storeId: string, cancelledBy: string, reason: string): Promise<void> {
  const db = getDb()
  await runTransaction(db, async (tx) => {
    const saleRef = doc(db, COLLECTIONS.sales, saleId)
    const saleSnap = await tx.get(saleRef)
    if (!saleSnap.exists()) throw new Error('Sale not found')
    const sale = saleSnap.data()
    if (sale.status === 'CANCELLED' || sale.status === 'RETURNED') {
      throw new Error(`This sale is already ${sale.status.toLowerCase()}.`)
    }
    if (sale.returnInfo && sale.returnInfo.returnedQtyTotal > 0) {
      throw new Error('This sale has returns. Cancel each return instead.')
    }

    for (const item of sale.items as SaleItem[]) {
      const productSnap = await tx.get(doc(db, COLLECTIONS.products, item.productId))
      if (productSnap.exists()) {
        const stock = productSnap.data().stock ?? 0
        const after = stock + item.quantity
        tx.update(doc(db, COLLECTIONS.products, item.productId), {
          stock: after,
          updatedAt: serverTimestamp(),
        })
        tx.set(doc(collection(db, COLLECTIONS.stockMovements)), {
          storeId,
          productId: item.productId,
          productName: item.name,
          type: 'RETURN',
          quantity: item.quantity,
          beforeStock: stock,
          afterStock: after,
          referenceType: 'SALE_CANCELLED',
          referenceId: saleId,
          notes: `Void ${sale.invoiceNumber}: ${reason}`,
          createdBy: cancelledBy,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
    }

    if (sale.customerId && sale.creditAmount > 0) {
      const customerRef = doc(db, COLLECTIONS.customers, sale.customerId)
      const customerSnap = await tx.get(customerRef)
      const balance = customerSnap.exists() ? customerSnap.data().creditBalance ?? 0 : 0
      tx.update(customerRef, {
        creditBalance: Math.max(0, balance - sale.creditAmount),
        updatedAt: serverTimestamp(),
      })
    }

    tx.update(saleRef, {
      status: 'CANCELLED',
      notes: `${sale.notes ?? ''}\nCancelled: ${reason}`.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: cancelledBy,
    })
  })
}

// ---------------------------------------------------------------------------
// Offline sale queue
// ---------------------------------------------------------------------------

const PENDING_KEY = 'nextbilling:pendingSales'

export function queuePendingSale(draft: SaleDraft): void {
  const existing = readPendingQueue()
  existing.push(draft)
  localStorage.setItem(PENDING_KEY, JSON.stringify(existing))
}

export function readPendingQueue(): SaleDraft[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as SaleDraft[]) : []
  } catch {
    return []
  }
}

export function clearPendingQueue(): void {
  localStorage.removeItem(PENDING_KEY)
}

/**
 * Attempts to sync pending offline sales. Returns the number successfully synced
 * and reports failures individually. Runs inside transactions so stock stays
 * consistent with each synced sale.
 */
export async function flushPendingSales(onError?: (message: string) => void): Promise<number> {
  const queue = readPendingQueue()
  if (queue.length === 0) return 0
  let synced = 0
  const remaining: SaleDraft[] = []
  for (const draft of queue) {
    try {
      await completeSale(draft)
      synced++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      if (onError) onError(message)
      remaining.push(draft)
    }
  }
  localStorage.setItem(PENDING_KEY, JSON.stringify(remaining))
  return synced
}