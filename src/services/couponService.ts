import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type { Coupon, CouponDiscountType } from '../types'
import { round2 } from '../utils/calculations'

export interface CouponDraft {
  code: string
  discountType: CouponDiscountType
  discountValue: number
  minBillAmount: number
  maxDiscount: number
  usageLimit: number
  active: boolean
  validFrom: number
  validUntil: number
  note: string
}

export async function createCoupon(
  draft: CouponDraft & { storeId: string },
  createdBy: string,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.coupons), {
    ...draft,
    code: draft.code.toUpperCase().trim(),
    usedCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

export async function updateCoupon(id: string, draft: Partial<CouponDraft>, updatedBy: string): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.coupons, id), {
    ...draft,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

export async function listCoupons(storeId: string, max = 300): Promise<Coupon[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.coupons),
    where('storeId', '==', storeId),
    limit(max),
  )
  const snap = await getDocs(q)
  const rows = snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Coupon)
  return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

export interface CouponValidation {
  ok: boolean
  message: string
  discount: number
  coupon: Coupon | null
}

/**
 * Validates a coupon code against the bill subtotal (after line discounts,
 * before bill-level discount). The final authoritative usage increment still
 * happens inside the sale transaction; a coupon may hit its limit between
 * validation and checkout — the sale transaction re-reads it.
 */
export function computeCouponDiscount(coupon: Coupon, billAmount: number): number {
  const raw =
    coupon.discountType === 'PERCENT'
      ? (billAmount * coupon.discountValue) / 100
      : coupon.discountValue
  const capped = coupon.maxDiscount > 0 ? Math.min(raw, coupon.maxDiscount) : raw
  return round2(Math.max(0, Math.min(capped, billAmount)))
}

export async function validateCoupon(
  storeId: string,
  code: string,
  billAmount: number,
): Promise<CouponValidation> {
  const db = getDb()
  const normalized = code.trim().toUpperCase()
  if (!normalized) return { ok: false, message: 'Enter a coupon code', discount: 0, coupon: null }
  const q = query(
    collection(db, COLLECTIONS.coupons),
    where('storeId', '==', storeId),
    where('code', '==', normalized),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) return { ok: false, message: `Coupon ${normalized} not found`, discount: 0, coupon: null }
  const coupon = { ...(snap.docs[0].data() as object), id: snap.docs[0].id } as Coupon

  const now = Date.now()
  if (!coupon.active) return { ok: false, message: `Coupon ${normalized} is inactive`, discount: 0, coupon: null }
  if (coupon.validFrom && now < coupon.validFrom) return { ok: false, message: 'Coupon is not valid yet', discount: 0, coupon: null }
  if (coupon.validUntil && now > coupon.validUntil) return { ok: false, message: 'Coupon has expired', discount: 0, coupon: null }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return { ok: false, message: 'Coupon usage limit reached', discount: 0, coupon: null }
  if (billAmount < coupon.minBillAmount) {
    return { ok: false, message: `Minimum bill of ₹${coupon.minBillAmount} required for this coupon`, discount: 0, coupon: null }
  }
  const discount = computeCouponDiscount(coupon, billAmount)
  if (discount <= 0) return { ok: false, message: 'Coupon gives no discount on this bill', discount: 0, coupon: null }
  return { ok: true, message: `Coupon ${normalized} applied`, discount, coupon }
}