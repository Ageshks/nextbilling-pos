import type { PaymentMethod, FirestoreType } from './common'

export interface SaleItem {
  productId: string
  name: string
  barcode: string
  sku: string
  unit: string
  quantity: number
  sellingPrice: number
  mrp: number
  purchasePrice: number
  gstRate: number
  discount: number
  taxableAmount: number
  gstAmount: number
  lineTotal: number
}

export interface SalePayment {
  method: PaymentMethod
  amount: number
}

export type SaleStatus = 'COMPLETED' | 'CANCELLED' | 'PARTIALLY_RETURNED' | 'RETURNED'

export interface Sale extends FirestoreType {
  id?: string
  storeId: string
  invoiceNumber: string
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
  amountPaid: number
  amountReceived: number
  changeGiven: number
  creditAmount: number
  payments: SalePayment[]
  status: SaleStatus
  notes: string
  heldBillId: string
  returnInfo?: {
    returnedQtyTotal: number
    refundTotal: number
  }
}

export interface HeldBill {
  id?: string
  storeId: string
  userId: string
  userName: string
  heldAt: number
  customerId: string
  customerName: string
  items: SaleItem[]
  discount: number
  subtotal: number
  taxableAmount: number
  gstAmount: number
  total: number
}

export interface SaleReturn {
  id?: string
  storeId: string
  saleId: string
  invoiceNumber: string
  customerId: string
  cashierId: string
  items: Array<{
    productId: string
    name: string
    quantity: number
    sellingPrice: number
    purchasePrice: number
    refundAmount: number
  }>
  refundAmount: number
  reason: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
}