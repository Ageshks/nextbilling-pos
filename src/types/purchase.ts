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