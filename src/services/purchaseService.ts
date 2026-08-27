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
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type { Purchase, PurchaseItem, Product } from '../types'
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
  const year = new Date(draft.purchaseDate).getFullYear()

  const purchaseId = doc(collection(db, COLLECTIONS.purchases)).id
  await runTransaction(db, async (tx) => {
    const counterRef = doc(db, COLLECTIONS.stores, draft.storeId, 'counters', 'purchases')
    const counterSnap = await tx.get(counterRef)
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

    for (const item of draft.items) {
      const productRef = doc(db, COLLECTIONS.products, item.productId)
      const productSnap = await tx.get(productRef)
      if (!productSnap.exists()) throw new Error(`Product ${item.name} not found`)
      const stock = productSnap.data().stock ?? 0
      const after = stock + item.quantity
      tx.update(productRef, { stock: after, updatedAt: serverTimestamp() })
      tx.set(doc(collection(db, COLLECTIONS.stockMovements)), stockMovementDocument({
        storeId: draft.storeId,
        product: { id: item.productId, name: item.name, storeId: draft.storeId } as Product,
        type: 'PURCHASE',
        quantity: item.quantity,
        referenceType: 'PURCHASE',
        referenceId: purchaseId,
        notes: `${purchaseNumber} · ${draft.supplierName || 'Supplier'}`,
        createdBy: draft.createdBy,
        beforeStock: stock,
        afterStock: after,
      }))
    }

    if (draft.supplierId) {
      const supplierRef = doc(db, COLLECTIONS.suppliers, draft.supplierId)
      const supplierSnap = await tx.get(supplierRef)
      const outstanding = supplierSnap.exists() ? supplierSnap.data().outstandingBalance ?? 0 : 0
      const totalPurchases = supplierSnap.exists() ? supplierSnap.data().totalPurchases ?? 0 : 0
      tx.set(
        supplierRef,
        {
          outstandingBalance: outstanding + (draft.total - draft.paidAmount),
          totalPurchases: totalPurchases + draft.total,
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

export async function listPurchases(filter: PurchaseFilter): Promise<Purchase[]> {
  const db = getDb()
  const base = collection(db, COLLECTIONS.purchases)
  let q = query(base, where('storeId', '==', filter.storeId), orderBy('createdAt', 'desc'), limit(filter.max ?? 100))
  if (filter.from && filter.to) {
    q = query(q, where('createdAt', '>=', Timestamp.fromMillis(filter.from)), where('createdAt', '<=', Timestamp.fromMillis(filter.to)))
  }
  const snap = await getDocs(q)
  let purchases = snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Purchase)
  if (filter.supplierId) purchases = purchases.filter((p) => p.supplierId === filter.supplierId)
  return purchases
}

export async function getPurchase(id: string): Promise<Purchase | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.purchases, id))
  if (!snap.exists()) return null
  return { ...(snap.data() as object), id: snap.id } as Purchase
}