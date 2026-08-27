import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { StockMovement, MovementType, Product, StockLevel } from '../types'
import { stockStatusOf } from '../types/inventory'

export interface MovementInput {
  storeId: string
  product: Product
  type: MovementType
  quantity: number // positive = in, negative = out
  referenceType: string
  referenceId: string
  notes: string
  createdBy: string
  beforeStock: number
  afterStock: number
}

/** Pure builder for a stock movement write (used inside larger transactions). */
export function stockMovementDocument(input: MovementInput) {
  return {
    storeId: input.storeId,
    productId: input.product.id ?? '',
    productName: input.product.name,
    type: input.type,
    quantity: input.quantity,
    beforeStock: input.beforeStock,
    afterStock: input.afterStock,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    notes: input.notes,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

/** Standalone stock adjustment that also writes a stock movement record. */
export async function adjustStock(
  storeId: string,
  productId: string,
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE' | 'EXPIRED',
  quantity: number,
  reason: string,
  createdBy: string,
): Promise<void> {
  const db = getDb()
  const productSnap = await getDoc(doc(db, COLLECTIONS.products, productId))
  if (!productSnap.exists()) throw new Error('Product not found')
  const product = { ...(productSnap.data() as object), id: productSnap.id } as Product
  const before = product.stock ?? 0
  const delta = type === 'ADJUSTMENT_IN' ? quantity : -quantity
  const after = before + delta
  if (after < 0 && !reason) throw new Error('Insufficient stock for this adjustment')

  const batch = writeBatch(db)
  batch.update(doc(db, COLLECTIONS.products, productId), { stock: after, updatedAt: serverTimestamp() })
  batch.set(doc(collection(db, COLLECTIONS.stockMovements)), stockMovementDocument({
    storeId,
    product,
    type,
    quantity: delta,
    referenceType: 'STOCK_ADJUSTMENT',
    referenceId: productId,
    notes: reason || type,
    createdBy,
    beforeStock: before,
    afterStock: after,
  }))
  await batch.commit()
}

export async function listStockMovements(
  storeId: string,
  productId?: string,
  max = 200,
): Promise<StockMovement[]> {
  const db = getDb()
  const base = collection(db, COLLECTIONS.stockMovements)
  const q = productId
    ? query(base, where('storeId', '==', storeId), where('productId', '==', productId), orderBy('createdAt', 'desc'), limit(max))
    : query(base, where('storeId', '==', storeId), orderBy('createdAt', 'desc'), limit(max))
  const snap = await getDocs(q)
  return unwrapDocs<StockMovement>(snap.docs)
}

/** Inventory summary with status + stock value. Reads every product document. */
export async function listInventory(storeId: string): Promise<StockLevel[]> {
  const db = getDb()
  const q = query(collection(db, COLLECTIONS.products), where('storeId', '==', storeId), orderBy('name', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data() as Product
    return {
      product: {
        id: d.id,
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        stock: data.stock ?? 0,
        minimumStock: data.minimumStock ?? 0,
        maximumStock: data.maximumStock ?? 0,
        purchasePrice: data.purchasePrice ?? 0,
        sellingPrice: data.sellingPrice ?? 0,
        active: data.active ?? true,
      },
      status: data.trackInventory ? stockStatusOf(data.stock ?? 0, data.minimumStock ?? 0) : 'IN_STOCK',
      stockValue: (data.stock ?? 0) * (data.purchasePrice ?? 0),
    }
  })
}

export async function listLowStock(storeId: string): Promise<StockLevel[]> {
  const inventory = await listInventory(storeId)
  return inventory.filter((i) => i.status !== 'IN_STOCK' && i.status !== 'OUT_OF_STOCK')
}

export async function listOutOfStock(storeId: string): Promise<StockLevel[]> {
  const inventory = await listInventory(storeId)
  return inventory.filter((i) => i.status === 'OUT_OF_STOCK')
}

export async function addStock(
  storeId: string,
  productId: string,
  quantity: number,
  referenceType: string,
  referenceId: string,
  notes: string,
  createdBy: string,
): Promise<void> {
  const db = getDb()
  const productSnap = await getDoc(doc(db, COLLECTIONS.products, productId))
  if (!productSnap.exists()) throw new Error('Product not found')
  const product = { ...(productSnap.data() as object), id: productSnap.id } as Product
  const before = product.stock ?? 0
  const after = before + quantity
  const batch = writeBatch(db)
  batch.update(doc(db, COLLECTIONS.products, productId), { stock: after, updatedAt: serverTimestamp() })
  batch.set(doc(collection(db, COLLECTIONS.stockMovements)), stockMovementDocument({
    storeId,
    product,
    type: 'ADJUSTMENT_IN',
    quantity,
    referenceType,
    referenceId,
    notes,
    createdBy,
    beforeStock: before,
    afterStock: after,
  }))
  await batch.commit()
}