import type { MovementType, StockStatus, FirestoreType } from './common'

export interface StockMovement extends FirestoreType {
  id?: string
  storeId: string
  productId: string
  productName: string
  type: MovementType
  quantity: number
  beforeStock: number
  afterStock: number
  referenceType: string
  referenceId: string
  notes: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
}

export interface StockLevel {
  product: {
    id: string
    name: string
    sku: string
    unit: string
    stock: number
    minimumStock: number
    maximumStock: number
    purchasePrice: number
    sellingPrice: number
    active: boolean
  }
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  stockValue: number
}

export function stockStatusOf(stock: number, minimumStock: number): StockStatus {
  if (stock <= 0) return 'OUT_OF_STOCK'
  if (stock <= minimumStock) return 'LOW_STOCK'
  return 'IN_STOCK'
}