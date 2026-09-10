import type { PaymentMethod, FirestoreType } from './common'

// ---------------------------------------------------------------------------
// Gift vouchers — prepaid store credit issued/sold by the shop and redeemed
// as tender at POS. `balance` is the remaining redeemable amount.
// ---------------------------------------------------------------------------
export type VoucherStatus = 'ACTIVE' | 'REDEEMED' | 'VOID'

export interface Voucher extends FirestoreType {
  id?: string
  storeId: string
  code: string
  amount: number
  balance: number
  status: VoucherStatus
  /** Payment method used when the voucher was sold (empty when gifted). */
  soldVia: PaymentMethod | ''
  note: string
  soldInvoiceNumber: string
  lastRedeemedAt: number
}

// ---------------------------------------------------------------------------
// Discount coupons — admin-created codes applied at billing.
// ---------------------------------------------------------------------------
export type CouponDiscountType = 'PERCENT' | 'FIXED'

export interface Coupon extends FirestoreType {
  id?: string
  storeId: string
  code: string
  discountType: CouponDiscountType
  discountValue: number
  /** Minimum bill subtotal for the coupon to apply (0 = none). */
  minBillAmount: number
  /** Cap for PERCENT coupons (0 = uncapped). Ignored for FIXED. */
  maxDiscount: number
  /** Maximum redemptions (0 = unlimited). */
  usageLimit: number
  usedCount: number
  active: boolean
  validFrom: number
  /** 0 = never expires. */
  validUntil: number
  note: string
}

/** A voucher used as tender inside a sale. */
export interface VoucherRedemption {
  voucherId: string
  code: string
  amount: number
}

/** A coupon applied to a sale (kept on the sale for the receipt). */
export interface AppliedCoupon {
  couponId: string
  code: string
}

export type VoucherDraft = Omit<Voucher, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>

export type VoucherSoldVia = Extract<PaymentMethod, 'CASH' | 'UPI' | 'CARD' | 'OTHER'> | ''