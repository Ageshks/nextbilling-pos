"use strict";
// ---------------------------------------------------------------------------
// Server-side order state machine — the ONLY authority for lifecycle edges.
// Mirrors WA_TRANSITIONS in src/types/waOrder.ts (frontend uses it for display
// gating only; this module is what actually enforces transitions).
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransition = canTransition;
exports.assertTransition = assertTransition;
exports.reservationDeltas = reservationDeltas;
const EDGES = {
    PENDING: ['AWAITING_PAYMENT', 'CANCELLED'],
    AWAITING_PAYMENT: ['PAID', 'CANCELLED', 'EXPIRED'],
    PAID: ['PACKING', 'CANCELLED'],
    PACKING: ['READY_FOR_PICKUP', 'CANCELLED'],
    READY_FOR_PICKUP: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: ['REFUNDED'],
    EXPIRED: [],
    REFUNDED: [],
};
function canTransition(from, to) {
    return EDGES[from]?.includes(to) ?? false;
}
/** Throws when a transition is illegal — used by webhooks/callables/sweeper. */
function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Illegal transition ${from} -> ${to}`);
    }
}
/**
 * Returns { stockDelta, reservedDelta } for the product document.
 * RESERVE  : customer added & confirmed → hold units
 * RELEASE  : cancelled/expired before pickup → give back
 * CONSUME  : unit physically handed over at pickup → stock falls with reserved
 * SELL_THROUGH: paid but collected outside system guard-rails — treat like CONSUME
 */
function reservationDeltas(op, qty) {
    const q = Math.max(0, Math.round(qty));
    switch (op) {
        case 'RESERVE':
            return { stockDelta: 0, reservedDelta: q };
        case 'RELEASE':
            return { stockDelta: 0, reservedDelta: -q };
        case 'CONSUME':
        case 'SELL_THROUGH':
            return { stockDelta: -q, reservedDelta: -q };
    }
}
//# sourceMappingURL=stateMachine.js.map