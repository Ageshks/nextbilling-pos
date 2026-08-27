// ---------------------------------------------------------------------------
// SuperMart POS backend entry points.
//
// Inbound customer channel : Meta WhatsApp Cloud API -> waWebhook
// Payment callbacks        : gateway (Razorpay)      -> paymentWebhook
// Staff mutations          : POS dashboard           -> orderAction (onCall)
// Lifecycle notifications  : Firestore trigger       -> onWaOrderUpdated
// Unpaid-order expiry      : scheduler               -> expireStaleWaOrders
//
// The browser never talks to WhatsApp/Razorpay and never holds their secrets;
// staff can only call orderAction, which re-validates identity, store scoping,
// role permission and lifecycle legality server-side.
// ---------------------------------------------------------------------------
import * as admin from 'firebase-admin'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
// Express types (re-exported through firebase-functions v2). Do NOT rely on the
// Node global Request/Response (undici) — the runtime hands handlers real
// express objects.
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
type WaRequest = ExpressRequest & { rawBody?: Buffer }
import { parseInbound, verifySignature, isVerifyRequest, sendText, markRead } from './whatsapp'
import { handleInbound } from './conversation'
import { reservationDeltas, assertTransition, type WaStatus } from './stateMachine'
import { getPaymentProvider } from './payments/razorpay'

initializeApp({ credential: applicationDefault() }) // eslint-disable-line no-undef
const db = getFirestore()

interface OrderItem {
  productId: string
  productName: string
  quantity: number
  subtotal: number
}

interface OrderDoc {
  storeId: string
  orderNo: number | string
  status: WaStatus
  paymentStatus: string
  paymentLink?: string | null
  total: number
  currency?: string
  customerName?: string
  customerWhatsapp?: string
  customerPhone?: string
  items: OrderItem[]
  packedItemIds?: string[]
  timeline?: Array<{ at: number; status: string }>
  expiresAt?: number
}

const STORE = () => process.env.WA_STORE_ID ?? ''
const money = (v: number, cur = 'INR') =>
  `${cur === 'INR' ? '₹' : cur + ' '}${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

async function pushAudit(
  storeId: string,
  uid: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.collection('auditLogs').add({
      storeId,
      userId: uid,
      action,
      entityType: 'waOrder',
      entityId,
      metadata,
      timestamp: FieldValue.serverTimestamp(),
    })
  } catch {
    /* best effort */
  }
}

/** Sends the templated lifecycle message for a status change; never throws. */
async function notifyStatusChange(before: OrderDoc, after: OrderDoc): Promise<void> {
  const phone = after.customerWhatsapp ?? after.customerPhone ?? ''
  if (!phone || before.status === after.status) return
  try {
    const snap = await db.collection('settings').doc(after.storeId).get()
    const s = (snap.data() ?? {}) as Record<string, unknown>
    const cur = String(s.currency ?? after.currency ?? 'INR')
    const vars: Record<string, string> = {
      orderNo: String(after.orderNo),
      amount: money(after.total, cur),
      storeName: String(s.storeName ?? ''),
      pickupAddress: String(s.pickupAddress ?? ''),
      pickupInstructions: String(s.pickupInstructions ?? ''),
    }
    const fill = (tpl: string) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    let body = ''
    switch (after.status) {
      case 'PACKING':
        body = fill(String(s.waPackingTemplate ?? '')) ||
          `📦 We're preparing your order.\n\nOrder #${vars.orderNo} is currently being packed.`
        break
      case 'READY_FOR_PICKUP':
        body = fill(String(s.waReadyTemplate ?? '')) ||
          `🎉 Your order #${vars.orderNo} is ready!\n\nCollect it from:\n${vars.storeName}\n${vars.pickupAddress}\n\nPlease show your order number at the counter.`
        break
      case 'COMPLETED':
        body = fill(String(s.waCompletedTemplate ?? '')) ||
          `✅ Order completed.\n\nThank you for shopping with ${vars.storeName}! ❤️`
        break
      case 'EXPIRED':
        body = `⌛ Your payment window for Order #${vars.orderNo} expired.\nIf you'd still like these items, please place the order again.`
        break
      case 'CANCELLED':
        body = `❌ Order #${vars.orderNo} was cancelled.${after.paymentStatus === 'PAID' ? ' A refund will be issued.' : ''}`
        break
      default:
        return
    }
    await sendText(phone, body)
  } catch (err) {
    console.error('[wa] notify failed', err)
  }
}

// ---------------------------------------------------------------------------
// 1) WhatsApp webhook — GET handshake + signed POST messages
// ---------------------------------------------------------------------------
export const waWebhook = onRequest({ region: 'us-central1' }, async (req: WaRequest, res: ExpressResponse): Promise<void> => {
  if (req.method === 'GET') {
    const v = isVerifyRequest(req.query as Record<string, unknown>)
    res.status(v.ok ? 200 : 403).send(v.ok ? v.challenge : 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.sendStatus(405)
    return
  }

  // Signature must be validated over the EXACT raw bytes.
  const rawBytes = typeof req.rawBody === 'string' ? Buffer.from(req.rawBody) : (req.rawBody ?? Buffer.alloc(0))
  const raw = rawBytes.toString('utf8')
  if (!verifySignature(raw, req.header('X-Hub-Signature-256'))) {
    console.warn('[wa] invalid signature')
    res.sendStatus(401)
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    res.sendStatus(200) // accept-and-ignore malformed so Meta doesn't retry-storm
    return
  }

  for (const msg of parseInbound(payload).messages) {
    void markRead(msg.messageId)
    await handleInbound(db, msg).catch((err) => console.error('[wa] inbound handling failed', err))
  }
  res.sendStatus(200)
})

// ---------------------------------------------------------------------------
// 2) Payment gateway webhook — signature-verified, idempotent, amount-checked
// ---------------------------------------------------------------------------
export const paymentWebhook = onRequest({ region: 'us-central1' }, async (req: WaRequest, res: ExpressResponse): Promise<void> => {
  if (req.method !== 'POST') {
    res.sendStatus(405)
    return
  }
  const provider = getPaymentProvider()
  if (!provider) {
    res.status(503).send('payment provider not configured')
    return
  }

  const rawBytes = typeof req.rawBody === 'string' ? Buffer.from(req.rawBody) : (req.rawBody ?? Buffer.alloc(0))
  const raw = rawBytes.toString('utf8')
  if (!provider.verifyWebhook(raw, Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])))) {
    console.warn('[pay] invalid webhook signature')
    res.sendStatus(401)
    return
  }
  const parsed = provider.parseWebhook(raw)
  if (!parsed || !parsed.orderIdHint) {
    res.sendStatus(200)
    return
  }

  // orderNo was passed as reference; match on it (number or string forms).
  const hintNum = Number(parsed.orderIdHint.replace(/\D/g, ''))
  const col = db.collection('orders').where('storeId', '==', STORE())
  const snap = Number.isFinite(hintNum) && hintNum > 0
    ? await col.where('orderNo', '==', hintNum).limit(1).get()
    : await col.where('orderNo', '==', parsed.orderIdHint).limit(1).get()
  if (snap.empty) {
    console.warn('[pay] no order for', parsed.orderIdHint)
    res.sendStatus(200)
    return
  }
  const ref = snap.docs[0].ref

  if (parsed.status === 'FAILED') {
    await ref.update({ paymentStatus: 'FAILED', updatedAt: FieldValue.serverTimestamp() })
    res.sendStatus(200)
    return
  }
  if (parsed.status === 'REFUNDED') {
    await ref.update({ paymentStatus: 'REFUNDED', refundedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    res.sendStatus(200)
    return
  }

  try {
    const phone = await db.runTransaction(async (tx) => {
      const docSnap = await tx.get(ref)
      const o = docSnap.data() as OrderDoc | undefined
      if (!o) throw new Error('missing order')

      // Idempotency: duplicate deliveries are a no-op.
      if (o.paymentStatus === 'PAID') return null

      assertTransition(o.status, 'PAID') // AWAITING_PAYMENT -> PAID only

      // Amount integrity: the paid paise must equal the server-side total.
      if (Math.abs(parsed.amountPaidMajor - o.total) > 0.01) {
        throw new Error(`amount mismatch: paid ${parsed.amountPaidMajor} vs order ${o.total}`)
      }

      // Reserved units become a real stock deduction in the SAME atomic commit.
      for (const item of o.items) {
        const { stockDelta, reservedDelta } = reservationDeltas('CONSUME', item.quantity)
        tx.update(db.collection('products').doc(item.productId), {
          stock: FieldValue.increment(stockDelta),
          waReserved: FieldValue.increment(reservedDelta),
        })
      }

      tx.update(ref, {
        status: 'PAID',
        paymentStatus: 'PAID',
        paidAt: FieldValue.serverTimestamp(),
        paymentId: parsed.paymentId,
        timeline: [...(o.timeline ?? []), { at: Date.now(), status: 'PAID' }],
        updatedAt: FieldValue.serverTimestamp(),
      })

      return { o, phone: o.customerWhatsapp ?? o.customerPhone ?? '' }
    })

    if (!phone) {
      res.sendStatus(200) // duplicate
      return
    }
    await pushAudit(phone.o.storeId, 'system:razorpay', 'wa_payment_paid', String(phone.o.orderNo), {
      amount: parsed.amountPaidMajor,
      paymentId: parsed.paymentId,
    })
    await sendText(
      phone.phone,
      `💳 Payment received!\n\nOrder #${phone.o.orderNo}\nAmount paid: ${money(phone.o.total)}\n\nYour order has been confirmed and will now be prepared.`,
    ).catch(() => undefined)
    res.sendStatus(200)
  } catch (err) {
    // Amount mismatches / illegal transitions are recorded but never crash the hook.
    console.error('[pay] processing error', err)
    res.sendStatus(200)
  }
})

// ---------------------------------------------------------------------------
// 3) Staff mutations — ONE server-validated entry point (`orderAction`).
// The browser never writes order docs; every transition + reservation delta
// happens here against the state machine, scoped to the caller's store/role.
// ---------------------------------------------------------------------------

const FLOOR_ACTIONS = new Set(['START_PACKING', 'TOGGLE_PACK_ITEM', 'MARK_READY', 'COMPLETE_PICKUP'])

function stepOr400(from: WaStatus, to: WaStatus): void {
  try {
    assertTransition(from, to)
  } catch {
    throw new HttpsError('failed-precondition', `Order cannot move from ${from} to ${to}.`)
  }
}

async function applyReservation(op: 'RELEASE' | 'CONSUME', items: OrderItem[]): Promise<void> {
  const batch = db.batch()
  for (const it of items) {
    const d = reservationDeltas(op, it.quantity)
    batch.update(db.collection('products').doc(it.productId), {
      stock: FieldValue.increment(d.stockDelta),
      waReserved: FieldValue.increment(d.reservedDelta),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit().catch(() => undefined)
}

export const orderAction = onCall({ region: 'us-central1' }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const data = (req.data ?? {}) as { orderId?: string; action?: string; itemIds?: string[] }
  const { orderId, action } = data
  if (!orderId || !action) throw new HttpsError('invalid-argument', 'orderId and action are required.')

  // Caller must be an ACTIVE staff member of the order's store.
  const profSnap = await db.collection('users').doc(uid).get()
  const prof = profSnap.data() as { storeId?: string; role?: string; status?: string } | undefined
  if (!prof?.storeId || prof.status !== 'active') throw new HttpsError('permission-denied', 'No active staff profile.')

  const result = await db.runTransaction(async (tx) => {
    const ref = db.collection('orders').doc(orderId)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
    const o = snap.data() as OrderDoc & { packedItemIds?: string[] }
    if (o.storeId !== prof!.storeId) throw new HttpsError('permission-denied', 'Order belongs to another store.')

    const isAdmin = prof!.role === 'OWNER' || prof!.role === 'ADMIN'
    if (!isAdmin && !FLOOR_ACTIONS.has(action)) {
      throw new HttpsError('permission-denied', `Your role cannot perform ${action}.`)
    }

    const cur = o.status as WaStatus
    const items = Array.isArray(o.items) ? o.items : []
    const now = Date.now()
    const upd: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    let consumed = false
    let released = false

    switch (action) {
      case 'START_PACKING': {
        stepOr400(cur, 'PACKING')
        upd.status = 'PACKING'
        break
      }
      case 'TOGGLE_PACK_ITEM': {
        if (cur !== 'PACKING') stepOr400(cur, 'PACKING') // yields the proper precondition error
        const ids = Array.isArray(data.itemIds) ? data.itemIds : []
        if (ids.length !== 1) throw new HttpsError('invalid-argument', 'Provide exactly one item id to toggle.')
        const idx = Number(ids[0])
        if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) throw new HttpsError('invalid-argument', 'Unknown packing item id.')
        const key = String(idx)
        const packed = new Set(o.packedItemIds ?? [])
        if (packed.has(key)) packed.delete(key)
        else packed.add(key)
        upd.packedItemIds = Array.from(packed).sort((a, b) => Number(a) - Number(b))
        break
      }
      case 'MARK_READY': {
        stepOr400(cur, 'READY_FOR_PICKUP')
        const unpacked = items.filter((_, i) => !(o.packedItemIds ?? []).includes(String(i))).length
        if (items.length > 0 && unpacked > 0) throw new HttpsError('failed-precondition', `${unpacked} item(s) still unchecked.`)
        upd.status = 'READY_FOR_PICKUP'
        upd.readyAt = now
        break
      }
      case 'COMPLETE_PICKUP': {
        stepOr400(cur, 'COMPLETED')
        upd.status = 'COMPLETED'
        upd.completedAt = now
        upd.completedByUid = uid
        upd.pickupStatus = 'COLLECTED'
        consumed = true
        break
      }
      case 'CANCEL_ORDER': {
        stepOr400(cur, 'CANCELLED')
        upd.status = 'CANCELLED'
        if (cur !== 'PENDING') released = true // PENDING drafts hold no reservation yet
        break
      }
      case 'REFUND_ORDER': {
        stepOr400(cur, 'REFUNDED')
        upd.status = 'REFUNDED'
        upd.paymentStatus = 'REFUNDED'
        break
      }
      case 'MARK_PAID_CASH_ON_PICKUP': {
        stepOr400(cur, 'PAID')
        upd.status = 'PAID'
        upd.paymentStatus = 'CASH_ON_PICKUP'
        upd.paymentProvider = 'cash_on_pickup'
        upd.paidAt = now
        break
      }
      case 'RESEND_PAYMENT_LINK': {
        // Admin-only (guarded above); no state change — just re-deliver the link.
        if (!o.paymentLink) throw new HttpsError('failed-precondition', 'This order has no payment link yet.')
        upd.__resend = true
        break
      }
      default:
        throw new HttpsError('invalid-argument', `Unsupported action ${action}.`)
    }

    const nextStatus = (upd.status as WaStatus | undefined) ?? cur
    if (nextStatus !== cur) {
      upd.timeline = [...(Array.isArray(o.timeline) ? o.timeline : []), { at: now, status: nextStatus, by: uid }]
    }
    if ('__resend' in upd) delete upd.__resend
    const wantsResend = action === 'RESEND_PAYMENT_LINK'
    tx.update(ref, upd)
    return { released, consumed, wantsResend }
  })

  // Reservation deltas are commutative bounded increments — safe outside tx.
  if (result.released || result.consumed) {
    const fresh = await db.collection('orders').doc(orderId).get()
    const its = ((fresh.data() as OrderDoc | undefined)?.items ?? []) as OrderItem[]
    await applyReservation(result.consumed ? 'CONSUME' : 'RELEASE', its)
  }

  if (result.wantsResend) {
    const fresh = await db.collection('orders').doc(orderId).get()
    const o2 = fresh.data() as OrderDoc & { paymentLink?: string | null } | undefined
    if (o2?.paymentLink) {
      await sendText(
        o2.customerWhatsapp ?? o2.customerPhone ?? '',
        `💳 Order #${o2.orderNo}\nTotal: ${money(o2.total)}\n\nSecure payment link:\n${o2.paymentLink}`,
      ).catch(() => undefined)
    }
  }

  await pushAudit(prof.storeId!, uid, `wa_${action}`, orderId, {})
  return { ok: true, message: `${action} done.` }
})

// ---------------------------------------------------------------------------
// 4) Lifecycle notifications — Firestore trigger sends the right template when
// staff/payment flows change an order's status (templates configurable in
// Settings; fallbacks live in notifyStatusChange).
// ---------------------------------------------------------------------------
export const onWaOrderUpdated = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before?.data() as OrderDoc | undefined
  const after = event.data?.after?.data() as OrderDoc | undefined
  if (!before || !after) return
  try {
    await notifyStatusChange(before, after)
  } catch (err) {
    console.error('[wa] notify trigger failed', err) // never throw from triggers
  }
})

// ---------------------------------------------------------------------------
// 5) Unpaid-order expiry — releases reserved inventory and marks EXPIRED.
// Runs every 5 minutes; bounded to 100 orders per pass.
// ---------------------------------------------------------------------------
export const expireStaleWaOrders = onSchedule(
  { schedule: 'every 5 minutes', region: 'us-central1', timeZone: 'Etc/UTC' },
  async () => {
    const storeId = STORE()
    if (!storeId) return // module not provisioned yet — no-op instead of erroring
    const cutoff = Date.now()
    try {
      const snap = await db
        .collection('orders')
        .where('storeId', '==', storeId)
        .where('status', '==', 'AWAITING_PAYMENT')
        .where('expiresAt', '<=', cutoff)
        .limit(100)
        .get()
      for (const d of snap.docs) {
        const o = d.data() as OrderDoc & { packedItemIds?: string[] }
        const cur = o.status as WaStatus
        try {
          assertTransition(cur, 'EXPIRED')
        } catch {
          continue
        }
        const batch = db.batch()
        batch.update(d.ref, {
          status: 'EXPIRED',
          updatedAt: FieldValue.serverTimestamp(),
          timeline: [...(Array.isArray(o.timeline) ? o.timeline : []), { at: cutoff, status: 'EXPIRED' }],
        })
        for (const it of Array.isArray(o.items) ? o.items : []) {
          const delta = reservationDeltas('RELEASE', it.quantity)
          batch.update(db.collection('products').doc(it.productId), {
            waReserved: FieldValue.increment(delta.reservedDelta),
            stock: FieldValue.increment(delta.stockDelta),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        await batch.commit().catch((err: unknown) => console.error('[wa] expire commit failed', err))
        await pushAudit(storeId, 'system:sweeper', 'wa_expired', d.id, { orderNo: String(o.orderNo) })
      }
    } catch (err) {
      console.error('[wa] sweeper failed', err) // scheduler must never crash loudly
    }
  },
)

