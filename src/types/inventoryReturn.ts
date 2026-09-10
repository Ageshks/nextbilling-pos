import type { FirestoreType } from './common'

/**
 * Inventory Returns (damage / expiry / supplier-return / write-off).
 *
 * This module is deliberately separate from customer refunds: it removes
 * unusable stock from SELLABLE inventory while preserving a complete,
 * immutable audit trail. It never touches `sales` or customer credit.
 */

export const INVENTORY_RETURN_REASONS = [
  'EXPIRED',
  'DAMAGED',
  'DEFECTIVE',
  'SPOILED',
  'BROKEN',
  'PACKAGING_DAMAGED',
  'QUALITY_ISSUE',
  'STOCK_DISCREPANCY',
  'SUPPLIER_RETURN',
  'OTHER',
] as const
export type InventoryReturnReason = (typeof INVENTORY_RETURN_REASONS)[number]

/** Destination bucket of removed stock. `stock` on the product stays sellable-only. */
export const INVENTORY_CONDITIONS = [
  'DAMAGED',
  'EXPIRED',
  'QUARANTINED',
  'SUPPLIER_RETURN',
  'WRITTEN_OFF',
] as const
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number]

/** Which workflow created the record. */
export type InventoryReturnKind = 'STOCK_CONDITION' | 'SUPPLIER_RETURN' | 'WRITE_OFF'

export const INVENTORY_RETURN_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT_TO_SUPPLIER',
  'SUPPLIER_ACCEPTED',
  'CREDIT_RECEIVED',
  'REPLACEMENT_RECEIVED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const
export type InventoryReturnStatus = (typeof INVENTORY_RETURN_STATUSES)[number]

/** Valid transitions; anything else is rejected by the service. */
export const INVENTORY_RETURN_TRANSITIONS: Record<InventoryReturnStatus, InventoryReturnStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SENT_TO_SUPPLIER', 'COMPLETED', 'CANCELLED'],
  SENT_TO_SUPPLIER: ['SUPPLIER_ACCEPTED', 'CANCELLED'],
  SUPPLIER_ACCEPTED: ['CREDIT_RECEIVED', 'REPLACEMENT_RECEIVED'],
  CREDIT_RECEIVED: ['REPLACEMENT_RECEIVED', 'COMPLETED'],
  REPLACEMENT_RECEIVED: ['CREDIT_RECEIVED', 'COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
}

/** Terminal states — records here can never be edited again. */
export const INVENTORY_RETURN_TERMINAL: InventoryReturnStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED']

export interface InventoryReturnTimelineEvent {
  action: string
  by: string
  byName: string
  at: number
  note?: string
}

export interface InventoryReturn extends FirestoreType {
  id?: string
  storeId: string
  /** INV-RET-YYYY-XXXXXX */
  returnNumber: string
  kind: InventoryReturnKind
  status: InventoryReturnStatus

  // Product snapshot (frozen at creation — immutable per security rules)
  productId: string
  productName: string
  sku: string
  categoryId: string
  categoryName: string
  batchNumber: string
  expiryDate: number | null
  purchaseDate: number | null
  supplierId: string
  supplierName: string
  quantity: number
  purchasePrice: number
  /** quantity × purchasePrice — server/service-computed, never trusted from UI */
  value: number

  reason: InventoryReturnReason
  condition: InventoryCondition
  notes: string
  /** Download URLs of evidence photos (same exposure model as product images). */
  evidenceUrls: string[]

  // Supplier-return lifecycle
  supplierReference: string
  creditNoteNumber: string
  replacementReceived: boolean
  returnDate: number

  // Governance
  createdBy: string
  createdByName: string
  approvedBy: string | null
  approvedByName: string | null
  approvedAt: number | null
  approvalReason: string
  rejectionReason: string
  stockMovedAt: number | null
  completedAt: number | null

  timeline: InventoryReturnTimelineEvent[]
  createdAt?: number
  updatedAt?: number
}

export interface CreateInventoryReturnInput {
  storeId: string
  kind: InventoryReturnKind
  productId: string
  productName: string
  sku: string
  categoryId: string
  categoryName: string
  batchNumber: string
  expiryDate: number | null
  purchaseDate: number | null
  supplierId: string
  supplierName: string
  quantity: number
  purchasePrice: number
  reason: InventoryReturnReason
  condition: InventoryCondition
  notes: string
  evidenceUrls: string[]
  supplierReference: string
  returnDate: number
  actor: { uid: string; name: string }
}

export interface ActorInput {
  uid: string
  name: string
}

/** Pure helper — expiry buckets for the Expiry Management dashboard. */
export interface ExpiryBucket {
  key: 'EXPIRED' | 'TODAY' | 'D3' | 'D7' | 'D30'
  title: string
  products: Array<{ id: string; name: string; sku: string; stock: number; expiryDate: number; value: number }>
}

/** Pure helper — data-driven observations for the dashboard (never auto-acts). */
export interface InventoryObservation {
  severity: 'info' | 'warning' | 'critical'
  message: string
}
