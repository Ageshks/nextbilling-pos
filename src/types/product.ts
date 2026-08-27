import type { Unit } from './common'

export interface Product {
  id?: string
  storeId: string
  name: string
  barcode: string
  sku: string
  categoryId: string
  categoryName: string
  brandId: string
  brandName: string
  unit: Unit
  purchasePrice: number
  sellingPrice: number
  mrp: number
  gstRate: number
  stock: number
  minimumStock: number
  maximumStock: number
  supplierId: string
  imageUrl: string
  description: string
  active: boolean
  trackInventory: boolean
  expiryTracking: boolean
  sellingUnitQty: number
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface Category {
  id?: string
  storeId: string
  name: string
  /** Soft delete — products referencing the category keep historical names. */
  active?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface Brand {
  id?: string
  storeId: string
  name: string
  active?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface ProductDraft {
  name: string
  barcode: string
  sku: string
  categoryId: string
  categoryName?: string
  brandId: string
  brandName?: string
  unit: Unit
  purchasePrice: number
  sellingPrice: number
  mrp: number
  gstRate: number
  minimumStock: number
  maximumStock: number
  supplierId: string
  imageUrl: string
  description: string
  active: boolean
  trackInventory: boolean
  expiryTracking: boolean
}