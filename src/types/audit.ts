import type { FirestoreType } from './common'

export interface AuditLog extends FirestoreType {
  id?: string
  storeId: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  timestamp: number
  metadata: Record<string, string | number | boolean>
}

export const AUDIT_ACTIONS = {
  PRODUCT_CREATED: 'product_created',
  PRODUCT_UPDATED: 'product_updated',
  PRODUCT_DEACTIVATED: 'product_deactivated',
  SALE_CREATED: 'sale_created',
  SALE_CANCELLED: 'sale_cancelled',
  RETURN_CREATED: 'return_created',
  STOCK_ADJUSTED: 'stock_adjusted',
  PURCHASE_CREATED: 'purchase_created',
  EXPENSE_CREATED: 'expense_created',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  SETTINGS_CHANGED: 'settings_changed',
  CATEGORY_CREATED: 'category_created',
  BRAND_CREATED: 'brand_created',
  HELD_BILL_DELETED: 'held_bill_deleted',
  CASH_SESSION_OPENED: 'cash_session_opened',
  CASH_SESSION_CLOSED: 'cash_session_closed',
  CUSTOMER_CREATED: 'customer_created',
  SUPPLIER_CREATED: 'supplier_created',
} as const

export interface Notification {
  id: string
  title?: string
  message?: string
  type: 'success' | 'error' | 'info' | 'warning'
}