import type { FirestoreType } from './common'

// ---------------------------------------------------------------------------
// WhatsApp commerce — order lifecycle & contracts.
//
// Orders are created exclusively by backend Cloud Functions (webhook-driven),
// never from the browser. Staff manage them through the POS via the
// `orderAction` callable, which re-validates every transition server-side.
// ---------------------------------------------------------------------------

export type WaOrderStatus =
  | 'PENDING' // draft being assembled in conversation (no reservation yet)
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'

/** Allowed lifecycle edges — enforced in functions/src/stateMachine.ts. */
export const WA_TRANSITIONS: Record<WaOrderStatus, WaOrderStatus[]> = {
  PENDING: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'CANCELLED', 'EXPIRED'],
  PAID: ['PACKING', 'CANCELLED'],
  PACKING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['REFUNDED'],
  EXPIRED: [],
  REFUNDED: [],
}

export function canTransition(from: WaOrderStatus, to: WaOrderStatus): boolean {
  return WA_TRANSITIONS[from]?.includes(to) ?? false
}

export type WaPaymentStatus =
  | 'NOT_REQUIRED'
  | 'LINK_SENT'
  | 'PAID'
  | 'FAILED'
  | 'CASH_ON_PICKUP'
  | 'REFUNDED'

export type WaFulfillmentType = 'STORE_PICKUP'

/** Staff actions routed through the single server-validated callable. */
export type WaOrderAction =
  | 'START_PACKING'
  | 'TOGGLE_PACK_ITEM'
  | 'MARK_READY'
  | 'COMPLETE_PICKUP'
  | 'CANCEL_ORDER'
  | 'REFUND_ORDER'
  | 'MARK_PAID_CASH_ON_PICKUP'
  | 'RESEND_PAYMENT_LINK'

export interface WaOrderItem {
  productId: string
  productName: string
  sku: string
  unit: string
  quantity: number
  unitPrice: number
  gstRate: number
  subtotal: number
}

/**
 * NOTE: items are intentionally embedded (not an /items subcollection):
 * supermarket carts are small (<50 lines), which keeps this one-read-per-order
 * and avoids extra subcollection indexes. Line-level integrity is preserved
 * because only functions write these documents.
 */
export interface WaOrder extends FirestoreType {
  orderNo: string // ORD-10001 style, from counters/{storeId}_waOrders
  source: 'WHATSAPP'
  customerId?: string
  customerName?: string
  /** E164 digits only (e.g. 919876543210) — also used for notifications. */
  customerPhone: string
  status: WaOrderStatus
  paymentStatus: WaPaymentStatus
  fulfillmentType: WaFulfillmentType
  items: WaOrderItem[]
  subtotal: number
  discount: number
  tax: number
  total: number
  currency: string
  paymentProvider?: string
  paymentLink?: string
  paymentLinkId?: string
  paymentId?: string
  paidAt?: number | null
  readyAt?: number | null
  completedAt?: number | null
  completedByUid?: string | null
  expiresAt?: number | null // reservation/payment deadline (ms)
  /** Ids of items staff have ticked during packing. */
  packedItemIds: string[]
  timeline: Array<{ at: number; status: WaOrderStatus; by?: string }>
}

export interface WaPerformance {
  ordersToday: number
  revenueToday: number
  avgOrderValue: number
  pendingPayments: number
  paidCount: number
  readyCount: number
  completedPickupsToday: number
  cancelledCount: number
  /** Paid ÷ all created — basic conversion for today's cohort. */
  conversionRate: number
}