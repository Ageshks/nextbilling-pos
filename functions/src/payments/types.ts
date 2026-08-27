// ---------------------------------------------------------------------------
// Payment abstraction. The POS must run even with NO gateway configured
// (provider 'none'): orders simply remain AWAITING_PAYMENT until staff take
// cash-on-pickup. Implementations behind this interface today: Razorpay.
// ---------------------------------------------------------------------------

export interface CreateLinkInput {
  orderNo: string
  /** In minor currency units for Razorpay (paise); implementations convert. */
  amountMajor: number
  currency: string
  customerName?: string
  customerPhone?: string
  callbackUrl?: string
}

export interface CreatedLink {
  linkId: string
  url: string
  provider: string
}

export interface VerifiedPayment {
  orderIdHint: string // receipt/orderNo echo from the gateway
  paymentId: string
  amountPaidMajor: number
  currency: string
  status: 'PAID' | 'FAILED' | 'REFUNDED'
  raw: unknown
}

export interface PaymentProvider {
  readonly name: string
  createPaymentLink(input: CreateLinkInput): Promise<CreatedLink>
  /** Validates the webhook signature over the RAW body; false → reject 400. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean
  parseWebhook(rawBody: string): VerifiedPayment | null
}
