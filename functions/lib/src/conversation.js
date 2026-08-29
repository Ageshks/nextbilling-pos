"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_STATUSES = void 0;
exports.handleInbound = handleInbound;
// ---------------------------------------------------------------------------
// Inbound WhatsApp conversation handler. Deterministic NLU + live Firestore
// catalog/customers/orders. Never trusts customer-supplied prices/totals;
// every checkout re-validates stock & price inside a transaction (orders.ts).
// ---------------------------------------------------------------------------
const firestore_1 = require("firebase-admin/firestore");
const nlu_1 = require("./nlu");
const matcher_1 = require("./matcher");
const orders_1 = require("./orders");
const whatsapp_1 = require("./whatsapp");
const razorpay_1 = require("./payments/razorpay");
const money = (v, cur) => `${cur === 'INR' ? '₹' : cur + ' '}${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
async function loadWaConfig(db, storeId) {
    const snap = await db.collection('settings').doc(storeId).get();
    const s = (snap.data() ?? {});
    return {
        storeName: String(s.storeName ?? 'our store'),
        currency: String(s.currency ?? 'INR'),
        pickupAddress: String(s.pickupAddress ?? ''),
        pickupInstructions: String(s.pickupInstructions ?? ''),
        businessHours: String(s.businessHours ?? ''),
        paymentTimeoutMinutes: Number(s.paymentTimeoutMinutes ?? 15),
        greetingTemplate: String(s.waGreetingTemplate ?? ''),
        readyTemplate: String(s.waReadyTemplate ?? ''),
        completedTemplate: String(s.waCompletedTemplate ?? ''),
    };
}
function fill(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
function menu(cfgv) {
    return (fill(cfgv.greetingTemplate, { storeName: cfgv.storeName }) ||
        `Hello! 👋 Welcome to ${cfgv.storeName}.\n\n1️⃣ Place an order\n2️⃣ Track my order\n3️⃣ Store timings & address`);
}
function cartText(items, cur, catalog) {
    if (items.length === 0)
        return 'Your cart is empty. Tell me what you need — e.g. "2 milk and 1 bread".';
    let subtotal = 0;
    const lines = items.map((it) => {
        const p = catalog.get(it.productId);
        const unit = Number(p?.price ?? 0);
        const lineTotal = Math.round(unit * it.quantity * 100) / 100;
        subtotal += lineTotal;
        return `${it.name} × ${it.quantity} — ${money(lineTotal, cur)}`;
    });
    return `${lines.join('\n')}\n--------------------\nSubtotal ${money(Math.round(subtotal * 100) / 100, cur)}`;
}
async function getConvo(db, storeId, phone) {
    const snap = await convoRef(db, storeId, phone).get();
    if (snap.exists)
        return snap.data();
    return { storeId, customerPhone: phone, state: 'IDLE', items: [] };
}
/** Main entry — always answers; never throws to the webhook caller. */
async function handleInbound(db, msg) {
    try {
        const storeId = process.env.WA_STORE_ID ?? '';
        if (!storeId) {
            console.error('[wa] WA_STORE_ID not set');
            return;
        }
        const cfgv = await loadWaConfig(db, storeId);
        const catalogList = await (0, orders_1.loadCatalog)(db, storeId);
        const catalog = new Map(catalogList.map((p) => [p.id, p]));
        const ref = convoRef(db, storeId, msg.fromPhone);
        const convo = await getConvo(db, storeId, msg.fromPhone);
        // ---------- helpers closed over this message ----------
        function addItem(p, qty) {
            const avail = (0, orders_1.available)(p);
            const existing = convo.items.find((i) => i.productId === p.id);
            const wanted = (existing?.quantity ?? 0) + qty;
            if (avail <= 0)
                return `Sorry, ${p.name} is currently out of stock.`;
            if (wanted > avail)
                return `We currently have only ${avail} unit(s) of ${p.name} available.\nWould you like ${avail}? (yes / no)`;
            if (existing)
                existing.quantity = wanted;
            else
                convo.items.push({ productId: p.id, name: p.name, quantity: qty });
            convo.state = 'BROWSING';
            const line = existing ?? convo.items[convo.items.length - 1];
            return `${p.name} × ${line.quantity}\n\n${money(Number(p.price), cfgv.currency)} each · added to your order.`;
        }
        async function findRecentActiveOrder() {
            const snap = await db
                .collection('orders')
                .where('storeId', '==', storeId)
                .where('customerPhone', '==', msg.fromPhone)
                .orderBy('createdAt', 'desc')
                .limit(5)
                .get();
            return snap.docs.find((d) => ['AWAITING_PAYMENT', 'PAID', 'PACKING', 'READY_FOR_PICKUP'].includes(d.data().status ?? ''));
        }
        // ---------- identify / create customer ----------
        const customerId = await (0, orders_1.upsertCustomer)(db, storeId, msg.fromPhone, msg.name);
        convo.customerId = customerId;
        async function confirmPrompt() {
            convo.state = 'AWAITING_CONFIRM';
            return `${cartText(convo.items, cfgv.currency, catalog)}\n\nReply "yes" to place your order, add more items, or say "cancel".`;
        }
        function pickupFooter() {
            let s = '\n\n🏪 Store pickup';
            if (cfgv.storeName || cfgv.pickupAddress) {
                s += `\n${cfgv.storeName}${cfgv.pickupAddress ? `\n${cfgv.pickupAddress}` : ''}`;
            }
            if (cfgv.businessHours)
                s += `\nHours: ${cfgv.businessHours}`;
            if (cfgv.pickupInstructions)
                s += `\n${cfgv.pickupInstructions}`;
            return s;
        }
        async function trackText(docSnap) {
            const o = docSnap.data();
            const phrases = {
                AWAITING_PAYMENT: 'Awaiting payment — complete it to start preparing your order.',
                PAID: 'Payment received ✅ — we will begin packing shortly.',
                PACKING: 'We are packing your order right now 📦.',
                READY_FOR_PICKUP: 'Packed and waiting for you at the store 🎉.',
            };
            return (`📦 Order #ORD-${o.orderNo}\n\nStatus: ${phrases[o.status ?? ''] ?? o.status}` +
                pickupFooter());
        }
        // ---------- checkout: server-side re-validation + payment link ----------
        async function checkout() {
            if (convo.items.length === 0)
                return cartText(convo.items, cfgv.currency, catalog);
            const res = await (0, orders_1.createWaOrder)(db, {
                storeId,
                customerId,
                customerName: msg.name,
                customerPhone: msg.fromPhone,
                lines: convo.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
                currency: cfgv.currency,
                paymentTimeoutMinutes: cfgv.paymentTimeoutMinutes,
            });
            if (!res.ok) {
                // Re-validate against live stock so the reply shows current truth.
                const fresh = await (0, orders_1.loadCatalog)(db, storeId);
                const fm = new Map(fresh.map((p) => [p.id, p]));
                convo.items = convo.items.filter((i) => {
                    const p = fm.get(i.productId);
                    return !!p && (0, orders_1.available)(p) > 0;
                });
                for (const i of convo.items) {
                    const p = fm.get(i.productId);
                    if (p)
                        i.quantity = Math.min(i.quantity, (0, orders_1.available)(p));
                }
                return res.reason === 'STOCK_CHANGED'
                    ? `Sorry — stock changed just before I could reserve your items.\n\nHere's what's still possible right now:\n\n${cartText(convo.items, cfgv.currency, fm)}\n\nSay "yes" to place this updated order.`
                    : `Sorry, I couldn't place that order just now (${res.reason ?? 'unknown reason'}). Please try again in a moment.`;
            }
            convo.items = [];
            convo.state = 'IDLE';
            const total = money(Number(res.total), cfgv.currency);
            const provider = (0, razorpay_1.getPaymentProvider)();
            if (provider) {
                try {
                    const link = await provider.createPaymentLink({
                        orderNo: String(res.orderNo),
                        amountMajor: Number(res.total),
                        currency: cfgv.currency,
                        customerName: msg.name,
                        customerPhone: msg.fromPhone,
                    });
                    // Persist link onto the order so staff can re-send / trace it.
                    if (res.orderId) {
                        await db
                            .collection('orders')
                            .doc(res.orderId)
                            .update({ paymentLink: link.url, paymentLinkId: link.linkId, paymentProvider: provider.name })
                            .catch(() => undefined);
                    }
                    return (`✅ Order #ORD-${res.orderNo} created.\nOrder total: ${total}\n\nPlease complete your payment using the secure link below:\n\n${link.url}\n\nYour order will be prepared once payment is confirmed.` +
                        pickupFooter());
                }
                catch {
                    // Gateway unavailable — order stays valid; pay on pickup.
                }
            }
            return (`✅ Order #ORD-${res.orderNo} created.\nOrder total: ${total}\n\nOnline payment is temporarily unavailable — you can pay at the counter when you collect.` +
                pickupFooter());
        }
        // ---------- intent router ----------
        const intent = (0, nlu_1.detectIntent)(msg.body);
        let reply = '';
        switch (intent) {
            case 'GREETING':
            case 'MENU_4_CONTACT':
                reply = menu(cfgv);
                break;
            case 'MENU_1_ORDER':
                reply =
                    convo.items.length > 0
                        ? await confirmPrompt()
                        : 'Great! Tell me what you need — e.g. "2 milk and 1 bread" or "add 5 coca cola 1L". You can also ask prices ("price of rice").';
                break;
            case 'MENU_3_INFO':
                reply =
                    `${cfgv.storeName}\n` +
                        (cfgv.pickupAddress ? `${cfgv.pickupAddress}\n` : '') +
                        (cfgv.businessHours ? `\nHours: ${cfgv.businessHours}\n` : '') +
                        (cfgv.pickupInstructions ? `\n${cfgv.pickupInstructions}\n` : '') +
                        `\nType "menu" anytime.` +
                        pickupFooter();
                break;
            case 'MENU_2_TRACK':
            case 'TRACK': {
                const d = await findRecentActiveOrder();
                reply = d
                    ? await trackText(d)
                    : `You don't have an active order right now. Say "hi" to start a new one!`;
                break;
            }
            case 'VIEW_CART':
                reply = cartText(convo.items, cfgv.currency, catalog);
                break;
            case 'CHECKOUT':
                reply =
                    convo.items.length === 0
                        ? cartText(convo.items, cfgv.currency, catalog)
                        : await confirmPrompt();
                break;
            case 'YES':
            case 'CONFIRM':
                reply = convo.items.length === 0 ? menu(cfgv) : await checkout();
                break;
            case 'NO':
            case 'CANCEL':
                if (intent === 'CANCEL' && convo.state === 'AWAITING_CONFIRM') {
                    convo.items = [];
                    convo.state = 'IDLE';
                    reply = 'Order cancelled. Your cart is empty — tell me what you need whenever you like!';
                }
                else {
                    reply = menu(cfgv);
                }
                break;
            case 'REMOVE_ITEM': {
                const parsed = (0, nlu_1.parseQuantityPhrase)((0, nlu_1.stripPriceNoise)(msg.body.replace(/remove|delete|cancel|take out/gi, ' ')));
                let removed = false;
                for (const item of parsed) {
                    if (!item.text.trim())
                        continue;
                    const m = (0, matcher_1.matchProduct)(item.text, catalogList);
                    if (!m.product)
                        continue;
                    const existing = convo.items.find((i) => i.productId === m.product.id);
                    if (!existing)
                        continue;
                    removed = true;
                    existing.quantity -= item.quantity;
                    if (existing.quantity <= 0) {
                        convo.items = convo.items.filter((i) => i.productId !== m.product.id);
                    }
                }
                reply = removed
                    ? `Done.\n\n${cartText(convo.items, cfgv.currency, catalog)}`
                    : cartText(convo.items, cfgv.currency, catalog);
                break;
            }
            case 'ADD_ITEMS': {
                const parsed = (0, nlu_1.parseQuantityPhrase)((0, nlu_1.stripPriceNoise)(msg.body));
                const unknowns = [];
                let added = '';
                for (const item of parsed) {
                    if (!item.text.trim())
                        continue;
                    const m = (0, matcher_1.matchProduct)(item.text, catalogList);
                    if (!m.product) {
                        unknowns.push(item.text.trim());
                        continue;
                    }
                    const line = addItem(m.product, item.quantity);
                    added = added ? `${added}\n\n${line}` : line;
                }
                if (!added) {
                    reply =
                        unknowns.length > 0
                            ? `I couldn't find: ${[...new Set(unknowns)].join(', ')}. Could you check the spelling or be more specific?`
                            : 'Tell me what you need — e.g. "2 milk and 1 bread".';
                }
                else {
                    reply =
                        `${added}\n\n${cartText(convo.items, cfgv.currency, catalog)}` +
                            (unknowns.length > 0 ? `\n\n(I couldn't find: ${[...new Set(unknowns)].join(', ')})` : '');
                }
                break;
            }
            case 'PRICE_QUERY':
            case 'STOCK_QUERY': {
                const parsed = (0, nlu_1.parseQuantityPhrase)((0, nlu_1.stripPriceNoise)(msg.body));
                const q = parsed.length > 0 ? parsed[parsed.length - 1].text : msg.body;
                const m = (0, matcher_1.matchProduct)(q, catalogList);
                if (m.product) {
                    const p = m.product;
                    const avail = (0, orders_1.available)(p);
                    const unitNote = parsed.length > 0 && parsed[parsed.length - 1].unit
                        ? ` per ${parsed[parsed.length - 1].unit}`
                        : '';
                    reply =
                        avail > 0
                            ? `${p.name} — ${money(Number(p.price), cfgv.currency)}${unitNote}.\n${avail} unit(s) in stock. How many would you like?`
                            : `${p.name} is currently out of stock. Would you like me to check anything else?`;
                }
                else {
                    reply = `I couldn't find that product. Try the name as on our shelves — e.g. "milk", "atta", "rice".`;
                }
                break;
            }
            default:
                reply =
                    convo.state === 'AWAITING_CONFIRM'
                        ? `Reply "yes" to place this order or "cancel" to discard.\n\n${cartText(convo.items, cfgv.currency, catalog)}`
                        : menu(cfgv);
                break;
        }
        await ref.set({ ...convo, lastMessageAt: Date.now(), updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
        await (0, whatsapp_1.sendText)(msg.fromPhone, reply);
    }
    catch (err) {
        console.error('[wa] inbound handling failed:', err);
        try {
            await (0, whatsapp_1.sendText)(msg.fromPhone, 'Something went wrong on our side. Please try again in a moment.');
        }
        catch {
            /* never throw into the webhook */
        }
    }
}
// ---------------------------------------------------------------------------
// Module-level helpers (hoisted — safe to call from getConvo above).
// ---------------------------------------------------------------------------
function convoRef(db, storeId, phone) {
    return db.collection('waConversations').doc(`${storeId}_${phone}`);
}
/** Statuses considered "active" for customer tracking questions. */
exports.ACTIVE_STATUSES = ['AWAITING_PAYMENT', 'PAID', 'PACKING', 'READY_FOR_PICKUP'];
//# sourceMappingURL=conversation.js.map