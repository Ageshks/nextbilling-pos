// ---------------------------------------------------------------------------
// Server-side order state machine — the ONLY authority for lifecycle edges.
// Mirrors WA_TRANSITIONS in src/types/waOrder.ts (frontend uses it for display
// gating only; this module is what actually enforces transitions).
// ---------------------------------------------------------------------------

export type WaStatus =
  | 'PENDING'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'

const EDGES: Record<WaStatus, WaStatus[]> = {
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

export function canTransition(from: WaStatus, to: WaStatus): boolean {
  return EDGES[from]?.includes(to) ?? false
}

/** Throws when a transition is illegal — used by webhooks/callables/sweeper. */
export function assertTransition(from: WaStatus, to: WaStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal transition ${from} -> ${to}`)
  }
}

// ---------------------------------------------------------------------------
// Inventory reservation arithmetic (pure; unit-tested). Products carry a
// `waReserved` counter so availability = stock - reserved without scanning
// active orders. One source of truth for stock remains products.stock.
// ---------------------------------------------------------------------------

export type ReserveOp = 'RESERVE' | 'RELEASE' | 'CONSUME' | 'SELL_THROUGH'

/**
 * Returns { stockDelta, reservedDelta } for the product document.
 * RESERVE  : customer added & confirmed → hold units
 * RELEASE  : cancelled/expired before pickup → give back
 * CONSUME  : unit physically handed over at pickup → stock falls with reserved
 * SELL_THROUGH: paid but collected outside system guard-rails — treat like CONSUME
 */
export function reservationDeltas(
  op: ReserveOp,
  qty: number,
): { stockDelta: number; reservedDelta: number } {
  const q = Math.max(0, Math.round(qty))
  switch (op) {
    case 'RESERVE':
      return { stockDelta: 0, reservedDelta: q }
    case 'RELEASE':
      return { stockDelta: 0, reservedDelta: -q }
    case 'CONSUME':
    case 'SELL_THROUGH':
      return { stockDelta: -q, reservedDelta: -q }
  }
}

/** One line item of a WhatsApp order (mirrors orders/{id}/items subcollection). */
export interface WaOrderItem {
  productId: string
  productName: string
  sku?: string
  quantity: number
  unitPrice: number
  subtotal: number
  /** Selling unit label ("kg", "packet"…), if any. */
  unit?: string
  /** Product GST rate (%) captured at order time. */
  gstRate?: number
}
