import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  type Transaction,
  type Firestore,
  type DocumentReference,
  type DocumentData,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import { ensureSettings } from './settingsService'
import type { MovementType } from '../types/common'
import type { Product } from '../types/product'
import {
  INVENTORY_RETURN_TRANSITIONS,
  INVENTORY_RETURN_TERMINAL,
} from '../types/inventoryReturn'
import type {
  InventoryReturn,
  InventoryReturnKind,
  InventoryReturnReason,
  InventoryCondition,
  InventoryReturnStatus,
  InventoryReturnTimelineEvent,
  CreateInventoryReturnInput,
  ActorInput,
  ExpiryBucket,
  InventoryObservation,
} from '../types/inventoryReturn'
import { round2 } from '../utils/calculations'
import { formatInvoiceNumber } from '../utils/invoice'

/**
 * Inventory Returns service — damage / expiry / quarantine / supplier-return /
 * write-off. Every stock change happens inside a Firestore transaction that
 * ALSO writes an immutable stockMovements row, so a bucket change can never
 * exist without its ledger entry. Customer sales/refunds are never touched.
 */

// condition → (movement type, product bucket field)
const CONDITION_MAP: Record<InventoryCondition, { type: MovementType; field: BucketField }> = {
  DAMAGED: { type: 'DAMAGE', field: 'stockDamaged' },
  EXPIRED: { type: 'EXPIRED', field: 'stockExpired' },
  QUARANTINED: { type: 'QUARANTINE', field: 'stockQuarantined' },
  SUPPLIER_RETURN: { type: 'SUPPLIER_RETURN', field: 'stockSupplierReturn' },
  WRITTEN_OFF: { type: 'WRITE_OFF', field: 'stockWrittenOff' },
}

type BucketField = 'stockDamaged' | 'stockExpired' | 'stockQuarantined' | 'stockSupplierReturn' | 'stockWrittenOff'

function timelineEvent(action: string, actor: ActorInput, note?: string): InventoryReturnTimelineEvent {
  return { action, by: actor.uid, byName: actor.name, at: Date.now(), ...(note ? { note } : {}) }
}

/** Validation shared by create; throws with a user-safe message. */
function validateInput(input: CreateInventoryReturnInput): void {
  if (!input.productId) throw new Error('Select a product.')
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Quantity must be at least 1.')
  if (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0) throw new Error('Purchase price is invalid.')
  if (input.reason === 'OTHER' && !input.notes.trim()) {
    throw new Error('A note is required when the reason is "Other".')
  }
  if (input.kind === 'SUPPLIER_RETURN' && !input.supplierId) {
    throw new Error('Supplier returns need a supplier.')
  }
}

export interface ApprovalDecision {
  required: boolean
  threshold: number
  reason: string
}

/**
 * Threshold gate — reads the store's configurable limits (never hard-coded).
 * Value at or below the threshold is processed immediately by inventory staff;
 * anything above waits for a manager.
 */
export async function decideApproval(
  storeId: string,
  kind: InventoryReturnKind,
  value: number,
): Promise<ApprovalDecision> {
  const settings = await ensureSettings(storeId)
  if (kind === 'SUPPLIER_RETURN') {
    const t = settings.supplierReturnApprovalThreshold ?? 2000
    return { required: value > t, threshold: t, reason: `supplier return threshold ₹${t}` }
  }
  if (kind === 'WRITE_OFF') {
    const t = settings.inventoryWriteOffApprovalThreshold ?? 500
    return { required: value > t, threshold: t, reason: `write-off threshold ₹${t}` }
  }
  const t = settings.inventoryReturnApprovalThreshold ?? 500
  return { required: value > t, threshold: t, reason: `inventory return threshold ₹${t}` }
}

/**
 * THE atomic stock operation: decrements SELLABLE stock, increments the
 * destination bucket, and writes the immutable ledger row — all in one
 * transaction. Throws if the product lacks sufficient sellable stock.
 */
function moveStockToBucket(
  tx: Transaction,
  db: Firestore,
  productRef: DocumentReference<DocumentData>,
  product: Product,
  condition: InventoryCondition,
  quantity: number,
  meta: { storeId: string; returnNumber: string; reason: InventoryReturnReason; actor: ActorInput; returnId: string },
): void {
  const { field, type } = CONDITION_MAP[condition]
  const stock = product.stock ?? 0
  if (stock < quantity) {
    throw new Error(`Only ${stock} sellable unit(s) of ${product.name} — cannot remove ${quantity}.`)
  }
  const after = stock - quantity
  tx.update(productRef, {
    stock: after,
    [field]: (product[field] ?? 0) + quantity,
    updatedAt: serverTimestamp(),
  })
  tx.set(doc(collection(db, COLLECTIONS.stockMovements)), {
    storeId: meta.storeId,
    productId: product.id ?? '',
    productName: product.name,
    type,
    quantity: -quantity, // signed delta: sellable stock OUT to a non-sellable bucket
    beforeStock: stock,
    afterStock: after,
    referenceType: 'INVENTORY_RETURN',
    referenceId: meta.returnId,
    notes: `${meta.returnNumber} · ${condition} · ${meta.reason.replaceAll('_', ' ')}`,
    createdBy: meta.actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Creates an inventory return. Value is computed from the entered purchase
 * price but re-validated against the live product; approval gating reads the
 * store's configurable thresholds. Within threshold → auto-processed, stock
 * moves immediately. Above → PENDING_APPROVAL until a manager approves.
 */
export async function createInventoryReturn(input: CreateInventoryReturnInput): Promise<string> {
  validateInput(input)
  const db = getDb()
  const productSnap = await getDoc(doc(db, COLLECTIONS.products, input.productId))
  if (!productSnap.exists()) throw new Error('Product not found')

  const value = round2(input.purchasePrice * input.quantity)
  const decision = await decideApproval(input.storeId, input.kind, value)

  const returnRef = doc(collection(db, COLLECTIONS.inventoryReturns))
  const returnId = returnRef.id

  await runTransaction(db, async (tx) => {
    const counterRef = doc(db, COLLECTIONS.stores, input.storeId, 'counters', 'inventoryReturns')
    const counterSnap = await tx.get(counterRef)
    const next = ((counterSnap.data()?.current as number) || 0) + 1
    const returnNumber = formatInvoiceNumber('INV-RET', new Date().getFullYear(), next)

    // Re-read inside the transaction so the stock check is race-free.
    const fresh = await tx.get(doc(db, COLLECTIONS.products, input.productId))
    if (!fresh.exists()) throw new Error('Product not found')
    const current = { ...(fresh.data() as object), id: fresh.id } as Product

    const record = {
      storeId: input.storeId,
      returnNumber,
      kind: input.kind,
      status: decision.required ? 'PENDING_APPROVAL' : 'APPROVED',
      productId: input.productId,
      productName: input.productName || current.name,
      sku: input.sku || current.sku || '',
      categoryId: input.categoryId || current.categoryId || '',
      categoryName: input.categoryName || current.categoryName || '',
      batchNumber: input.batchNumber || current.batchNumber || '',
      expiryDate: input.expiryDate ?? (current.expiryDate ?? null),
      purchaseDate: input.purchaseDate,
      supplierId: input.supplierId || current.supplierId || '',
      supplierName: input.supplierName || '',
      quantity: input.quantity,
      purchasePrice: input.purchasePrice,
      value,
      reason: input.reason,
      condition: input.condition,
      notes: input.notes.trim(),
      evidenceUrls: input.evidenceUrls,
      supplierReference: '',
      creditNoteNumber: '',
      replacementReceived: false,
      returnDate: input.returnDate,
      createdBy: input.actor.uid,
      createdByName: input.actor.name,
      approvedBy: decision.required ? null : input.actor.uid,
      approvedByName: decision.required ? null : input.actor.name,
      approvedAt: decision.required ? null : Date.now(),
      approvalReason: decision.required
        ? ''
        : `Auto-processed: value ₹${value} ≤ configured ${decision.reason}`,
      rejectionReason: '',
      stockMovedAt: null,
      completedAt: null,
      timeline: [
        timelineEvent('INVENTORY_RETURN_CREATED', input.actor, `${input.quantity} × ${current.name}`),
        ...(decision.required
          ? []
          : [timelineEvent('AUTO_APPROVED_WITHIN_THRESHOLD', input.actor, decision.reason)]),
      ] as InventoryReturnTimelineEvent[],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>

    tx.set(returnRef, record)
    tx.set(counterRef, { current: next, updatedAt: serverTimestamp() })

    if (!decision.required) {
      moveStockToBucket(tx, db, doc(db, COLLECTIONS.products, input.productId), current, input.condition, input.quantity, {
        storeId: input.storeId,
        returnNumber,
        reason: input.reason,
        actor: input.actor,
        returnId,
      })
      record.stockMovedAt = Date.now()
      ;(record.timeline as InventoryReturnTimelineEvent[]).push(
        timelineEvent(`STOCK_MOVED_TO_${input.condition}`, input.actor),
      )
      tx.set(returnRef, record)
    }
  })

  return returnId
}

/**
 * Manager approval. Moves the stock atomically in the same transaction that
 * records the approval — self-approval is rejected here AND in the security
 * rules, so it can never happen even if the UI were bypassed.
 */
export async function approveInventoryReturn(
  id: string,
  approver: ActorInput,
  approvalReason: string,
): Promise<void> {
  if (!approvalReason.trim()) throw new Error('An approval reason is required.')
  const db = getDb()
  const ref = doc(db, COLLECTIONS.inventoryReturns, id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Inventory return not found')
    const record = snap.data() as InventoryReturn
    if (record.status !== 'PENDING_APPROVAL') {
      throw new Error(`Cannot approve a return in status ${record.status}.`)
    }
    if (record.createdBy === approver.uid) {
      throw new Error('You cannot approve your own inventory return.')
    }
    const productRef = doc(db, COLLECTIONS.products, record.productId)
    const productSnap = await tx.get(productRef)
    if (!productSnap.exists()) throw new Error('Product no longer exists')
    const product = { ...(productSnap.data() as object), id: productSnap.id } as Product

    moveStockToBucket(tx, db, productRef, product, record.condition, record.quantity, {
      storeId: record.storeId,
      returnNumber: record.returnNumber,
      reason: record.reason,
      actor: approver,
      returnId: id,
    })

    tx.update(ref, {
      status: 'APPROVED',
      approvedBy: approver.uid,
      approvedByName: approver.name,
      approvedAt: Date.now(),
      approvalReason: approvalReason.trim(),
      stockMovedAt: Date.now(),
      updatedAt: serverTimestamp(),
      timeline: [
        ...record.timeline,
        timelineEvent('INVENTORY_RETURN_APPROVED', approver, approvalReason.trim()),
        timelineEvent(`STOCK_MOVED_TO_${record.condition}`, approver),
      ],
    })
  })
}

/** Manager rejection / correction request. Reason is mandatory. */
export async function rejectInventoryReturn(
  id: string,
  approver: ActorInput,
  rejectionReason: string,
): Promise<void> {
  if (!rejectionReason.trim()) throw new Error('A rejection reason is required.')
  const db = getDb()
  const ref = doc(db, COLLECTIONS.inventoryReturns, id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Inventory return not found')
    const record = snap.data() as InventoryReturn
    if (record.status !== 'PENDING_APPROVAL') {
      throw new Error(`Cannot reject a return in status ${record.status}.`)
    }
    if (record.createdBy === approver.uid) {
      throw new Error('You cannot decide on your own inventory return.')
    }
    tx.update(ref, {
      status: 'REJECTED',
      rejectionReason: rejectionReason.trim(),
      approvedBy: approver.uid,
      approvedByName: approver.name,
      approvedAt: Date.now(),
      updatedAt: serverTimestamp(),
      timeline: [...record.timeline, timelineEvent('INVENTORY_RETURN_REJECTED', approver, rejectionReason.trim())],
    })
  })
}

export interface SupplierProgressPatch {
  supplierReference?: string
  creditNoteNumber?: string
  replacementReceived?: boolean
  note?: string
}

/**
 * Progresses the supplier-return lifecycle (SENT_TO_SUPPLIER → … → COMPLETED).
 * Only valid transitions are accepted; stock already left SELLABLE at approval,
 * so lifecycle steps never touch stock again.
 */
export async function progressInventoryReturn(
  id: string,
  toStatus: InventoryReturnStatus,
  actor: ActorInput,
  patch: SupplierProgressPatch = {},
): Promise<void> {
  if (toStatus === 'APPROVED' || toStatus === 'REJECTED') {
    throw new Error('Use the dedicated approve/reject actions.')
  }
  const db = getDb()
  const ref = doc(db, COLLECTIONS.inventoryReturns, id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Inventory return not found')
    const record = snap.data() as InventoryReturn
    if (INVENTORY_RETURN_TERMINAL.includes(record.status)) {
      throw new Error('This record is complete and can no longer be modified.')
    }
    if (!INVENTORY_RETURN_TRANSITIONS[record.status].includes(toStatus)) {
      throw new Error(`Invalid transition ${record.status} → ${toStatus}.`)
    }
    if (toStatus === 'SENT_TO_SUPPLIER' && !patch.supplierReference?.trim()) {
      throw new Error('Supplier reference is required when sending to the supplier.')
    }
    if (toStatus === 'CREDIT_RECEIVED' && !patch.creditNoteNumber?.trim()) {
      throw new Error('Credit note number is required to record credit received.')
    }

    const update: Record<string, unknown> = {
      status: toStatus,
      updatedAt: serverTimestamp(),
      timeline: [...record.timeline, timelineEvent(toStatus, actor, patch.note)],
    }
    if (toStatus === 'COMPLETED') update.completedAt = Date.now()
    if (patch.supplierReference) update.supplierReference = patch.supplierReference.trim()
    if (patch.creditNoteNumber) update.creditNoteNumber = patch.creditNoteNumber.trim()
    if (patch.replacementReceived !== undefined) update.replacementReceived = patch.replacementReceived
    tx.update(ref, update)
  })
}

/** Cancels a pending record. Impossible once stock has moved — the ledger must stay intact. */
export async function cancelInventoryReturn(id: string, actor: ActorInput, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('A cancellation reason is required.')
  const db = getDb()
  const ref = doc(db, COLLECTIONS.inventoryReturns, id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Inventory return not found')
    const record = snap.data() as InventoryReturn
    if (record.stockMovedAt) {
      throw new Error('Stock has already been moved — cancelling now would break the ledger.')
    }
    if (!INVENTORY_RETURN_TRANSITIONS[record.status].includes('CANCELLED')) {
      throw new Error(`Cannot cancel a return in status ${record.status}.`)
    }
    tx.update(ref, {
      status: 'CANCELLED',
      updatedAt: serverTimestamp(),
      timeline: [...record.timeline, timelineEvent('CANCELLED', actor, reason.trim())],
    })
  })
}

// ---------------------------------------------------------------------------
// Query / observation helpers
// ---------------------------------------------------------------------------

export interface InventoryReturnFilter {
  storeId: string
  status?: InventoryReturnStatus
  kind?: InventoryReturnKind
  reason?: InventoryReturnReason
  from?: number
  to?: number
  max?: number
}

/** Lists inventory returns for a store, newest first, with optional filters. */
export async function listInventoryReturns(filter: InventoryReturnFilter): Promise<InventoryReturn[]> {
  const db = getDb()
  const base = collection(db, COLLECTIONS.inventoryReturns)
  const clauses: Array<ReturnType<typeof where>> = [where('storeId', '==', filter.storeId)]
  if (filter.status) clauses.push(where('status', '==', filter.status))
  if (filter.kind) clauses.push(where('kind', '==', filter.kind))
  if (filter.reason) clauses.push(where('reason', '==', filter.reason))
  if (filter.from) clauses.push(where('createdAt', '>=', filter.from))
  if (filter.to) clauses.push(where('createdAt', '<=', filter.to))
  const snap = await getDocs(query(base, ...clauses, orderBy('createdAt', 'desc'), limit(filter.max ?? 100)))
  return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as InventoryReturn)
}

export async function getInventoryReturn(id: string): Promise<InventoryReturn | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.inventoryReturns, id))
  if (!snap.exists()) return null
  return { ...(snap.data() as object), id: snap.id } as InventoryReturn
}

/**
 * Pure helper — buckets a store's products by expiry proximity for the
 * Expiry Management dashboard. Products without an expiry date are skipped.
 * Reads the live product list; never mutates anything.
 */
export function bucketByExpiry(
  products: Array<{ id: string; name: string; sku: string; stock: number; expiryDate?: number | null; purchasePrice?: number }>,
  now = Date.now(),
): ExpiryBucket[] {
  const day = 86400000
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()

  const buckets: ExpiryBucket[] = [
    { key: 'EXPIRED', title: 'Expired', products: [] },
    { key: 'TODAY', title: 'Expiring today', products: [] },
    { key: 'D3', title: 'Expiring in ≤ 3 days', products: [] },
    { key: 'D7', title: 'Expiring in ≤ 7 days', products: [] },
    { key: 'D30', title: 'Expiring in ≤ 30 days', products: [] },
  ]
  const indexOf: Record<string, number> = { EXPIRED: 0, TODAY: 1, D3: 2, D7: 3, D30: 4 }

  for (const p of products) {
    const exp = p.expiryDate
    if (!exp) continue
    const value = (p.purchasePrice ?? 0) * p.stock
    const entry = { id: p.id, name: p.name, sku: p.sku, stock: p.stock, expiryDate: exp, value }
    const diff = exp - todayMs
    let key: ExpiryBucket['key']
    if (diff < 0) key = 'EXPIRED'
    else if (diff === 0) key = 'TODAY'
    else if (diff <= 3 * day) key = 'D3'
    else if (diff <= 7 * day) key = 'D7'
    else if (diff <= 30 * day) key = 'D30'
    else continue
    buckets[indexOf[key]].products.push(entry)
  }
  return buckets
}

/**
 * Pure helper — data-driven observations for the dashboard. AI-like pattern
 * spotting on real inventory data. Never auto-acts; only surfaces signals.
 */
export function observeInventory(
  returns: InventoryReturn[],
  expiryBuckets: ExpiryBucket[],
): InventoryObservation[] {
  const observations: InventoryObservation[] = []

  const expired = expiryBuckets.find((b) => b.key === 'EXPIRED')
  if (expired && expired.products.length > 0) {
    const totalValue = round2(expired.products.reduce((s, p) => s + p.value, 0))
    observations.push({
      severity: 'critical',
      message: `${expired.products.length} product(s) have expired, tying up ₹${totalValue.toLocaleString('en-IN')} in inventory.`,
    })
  }

  const d7 = expiryBuckets.find((b) => b.key === 'D7')
  if (d7 && d7.products.length > 0) {
    observations.push({
      severity: 'warning',
      message: `${d7.products.length} product(s) will expire within the next 7 days.`,
    })
  }

  if (returns.length > 0) {
    const byReason: Record<string, number> = {}
    for (const r of returns) {
      const label = r.reason.replaceAll('_', ' ')
      byReason[label] = (byReason[label] ?? 0) + r.quantity
    }
    const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]
    if (top) {
      observations.push({
        severity: 'info',
        message: `Most common removal reason this period: ${top[0]} (${top[1]} units).`,
      })
    }
  }

  return observations
}