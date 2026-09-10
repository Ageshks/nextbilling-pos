import type { FirestoreType } from './common'

export interface PurchaseItem {
  productId: string
  name: string
  unit: string
  quantity: number
  purchasePrice: number
  gstRate: number
  gstAmount: number
  lineTotal: number
}

export interface Purchase extends FirestoreType {
  id?: string
  storeId: string
  purchaseNumber: string
  supplierId?: string
  supplierName: string
  supplierInvoiceNumber: string
  purchaseDate: number
  items: PurchaseItem[]
  subtotal: number
  discount: number
  gstAmount: number
  total: number
  paidAmount: number
  status: 'PAID' | 'PARTIAL' | 'UNPAID'
  notes: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
}

/** How the money for a purchase return is settled with the supplier. */
export type PurchaseReturnMethod = 'REFUND' | 'BUYBACK'

export const PURCHASE_RETURN_METHODS: ReadonlyArray<{ value: PurchaseReturnMethod; label: string }> = [
  { value: 'REFUND', label: 'Cash refund' },
  { value: 'BUYBACK', label: 'Buy other stock (credit note)' },
]

export interface PurchaseReturnItem {
  productId: string
  name: string
  unit: string
  quantity: number
  /** Per-unit price credited back (GST-exclusive purchase price). */
  purchasePrice: number
  gstRate: number
  gstAmount: number
  lineTotal: number
}

/**
 * Immutable purchase-return record. Stock is decremented and a PURCHASE_RETURN
 * ledger movement is written in the same transaction. Settlement is either a
 * cash refund (reduces the open cash drawer) or supplier credit used to buy
 * other stock (reduces supplier payable instead of paying cash).
 */
export interface PurchaseReturn extends FirestoreType {
  id?: string
  storeId: string
  returnNumber: string
  purchaseId: string
  purchaseNumber: string
  supplierId?: string
  supplierName: string
  items: PurchaseReturnItem[]
  subtotal: number
  gstAmount: number
  total: number
  method: PurchaseReturnMethod
  /** Cash handed back to the store: refund total minus any stock bought back in the same transaction. */
  cashOut: number
  /** Value of replacement stock taken (reduces what the supplier owes back). */
  buyBackNet: number
  notes: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
}