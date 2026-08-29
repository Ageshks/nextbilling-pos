"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCatalog = loadCatalog;
exports.available = available;
exports.upsertCustomer = upsertCustomer;
exports.createWaOrder = createWaOrder;
exports.releaseReservations = releaseReservations;
exports.consumeReservations = consumeReservations;
// ---------------------------------------------------------------------------
// Order + inventory operations. Every mutation is a Firestore transaction so
// concurrent WhatsApp orders / POS sales / expiries cannot oversell stock.
// Products.waReserved acts as an atomic availability counter:
//     availableToPromise = stock - waReserved
// Physical POS sales keep deducting products.stock exactly as before — single
// source of truth stays the existing catalog.
// ---------------------------------------------------------------------------
const firestore_1 = require("firebase-admin/firestore");
const stateMachine_1 = require("./stateMachine");
async function loadCatalog(db, storeId) {
    const snap = await db
        .collection('products')
        .where('storeId', '==', storeId)
        .where('active', '==', true)
        .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
/** Availability shown to customers never promises reserved units. */
function available(p) {
    return Math.max(0, Math.floor((p.stock ?? 0) - (p.waReserved ?? 0)));
}
async function nextOrderNo(tx, db, storeId) {
    const ref = db.collection('counters').doc(`${storeId}_waOrders`);
    const snap = await tx.get(ref);
    const cur = Number(snap.exists ? snap.data().seq ?? 10000 : 10000);
    tx.set(ref, { seq: cur + 1 }, { merge: true });
    return cur + 1;
}
async function upsertCustomer(db, storeId, phoneDigits, name) {
    const col = db.collection('customers');
    const found = await col.where('storeId', '==', storeId).where('phone', '==', phoneDigits).limit(1).get();
    if (!found.empty) {
        const d = found.docs[0];
        const patch = { updatedAt: firestore_1.FieldValue.serverTimestamp() };
        if (name && name !== d.data().name)
            patch.name = name;
        await d.ref.update(patch);
        return d.id;
    }
    const created = await col.add({
        storeId,
        name: name || `WhatsApp ${phoneDigits.slice(-4)}`,
        phone: phoneDigits,
        whatsappPhone: phoneDigits,
        email: '',
        creditBalance: 0,
        totalPurchases: 0,
        notes: 'Created via WhatsApp ordering',
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return created.id;
}
/**
 * Confirms a cart into an order. Prices/stock are RE-READ inside the txn from
 * the live catalog — anything stale in the conversation (or customer-tampered)
 * is recalculated here, guaranteeing the charged amount matches reality.
 */
async function createWaOrder(db, opts) {
    return db.runTransaction(async (tx) => {
        const prods = new Map();
        for (const line of opts.lines) {
            if (prods.has(line.productId))
                continue;
            const snap = await tx.get(db.collection('products').doc(line.productId));
            if (!snap.exists)
                return { ok: false, reason: `Unknown product ${line.productId}` };
            const p = { id: snap.id, ...snap.data() };
            if ((p.active ?? true) === false)
                return { ok: false, reason: `${p.name} is unavailable` };
            prods.set(p.id, p);
        }
        const items = [];
        for (const line of opts.lines) {
            const p = prods.get(line.productId);
            if (line.quantity > available(p))
                return { ok: false, reason: 'STOCK_CHANGED' };
            const unitPrice = Number(p.price); // authoritative POS price
            items.push({
                productId: p.id,
                productName: p.name,
                sku: p.sku ?? '',
                unit: p.unit ?? '',
                quantity: line.quantity,
                unitPrice,
                gstRate: Number(p.gstRate ?? 0),
                subtotal: Math.round(unitPrice * line.quantity * 100) / 100,
            });
        }
        const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
        const tax = items.reduce((a, i) => a + (i.subtotal * (i.gstRate ?? 0)) / 100, 0);
        const total = Math.round((subtotal + tax) * 100) / 100;
        // Atomically reserve units.
        for (const i of items) {
            const { reservedDelta } = (0, stateMachine_1.reservationDeltas)('RESERVE', i.quantity);
            tx.update(db.collection('products').doc(i.productId), {
                waReserved: firestore_1.FieldValue.increment(reservedDelta),
            });
        }
        const seq = await nextOrderNo(tx, db, opts.storeId);
        const orderRef = db.collection('orders').doc();
        tx.create(orderRef, {
            storeId: opts.storeId,
            orderNo: seq,
            source: 'WHATSAPP',
            customerId: opts.customerId,
            customerName: opts.customerName ?? '',
            customerPhone: opts.customerPhone,
            status: 'AWAITING_PAYMENT',
            paymentStatus: 'LINK_SENT',
            fulfillmentType: 'STORE_PICKUP',
            items,
            subtotal,
            discount: 0,
            tax,
            total,
            currency: opts.currency,
            packedItemIds: [],
            timeline: [{ at: Date.now(), status: 'AWAITING_PAYMENT' }],
            expiresAt: Date.now() + opts.paymentTimeoutMinutes * 60000,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            paidAt: null,
            readyAt: null,
            completedAt: null,
            completedByUid: null,
        });
        return { ok: true, orderId: orderRef.id, orderNo: seq, total };
    });
}
/** Release reserved units (cancel/expire). Chunked batch, best-effort. */
async function releaseReservations(db, items) {
    let batch = db.batch();
    let n = 0;
    for (const i of items) {
        const { reservedDelta } = (0, stateMachine_1.reservationDeltas)('RELEASE', i.quantity);
        batch.update(db.collection('products').doc(i.productId), {
            waReserved: firestore_1.FieldValue.increment(reservedDelta),
        });
        if (++n === 400) {
            await batch.commit().catch(() => undefined);
            batch = db.batch();
            n = 0;
        }
    }
    if (n > 0)
        await batch.commit().catch(() => undefined);
}
/** Units physically left the store at pickup completion. */
async function consumeReservations(db, items) {
    const batch = db.batch();
    for (const i of items) {
        const { stockDelta, reservedDelta } = (0, stateMachine_1.reservationDeltas)('CONSUME', i.quantity);
        batch.update(db.collection('products').doc(i.productId), {
            stock: firestore_1.FieldValue.increment(stockDelta),
            waReserved: firestore_1.FieldValue.increment(reservedDelta),
        });
    }
    await batch.commit().catch(() => undefined);
}
//# sourceMappingURL=orders.js.map