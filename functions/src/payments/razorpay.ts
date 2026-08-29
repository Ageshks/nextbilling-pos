import crypto from 'crypto'
import type {
  CreatedLink,
  CreateLinkInput,
  PaymentProvider,
  VerifiedPayment,
} from './types'
import { cfg } from '../config'

interface RzpEntity {
  id?: string
  status?: string
  amount?: number
  currency?: string
  order_id?: string
  receipt?: string
  notes?: Record<string, string>
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${cfg.razorpayKeyId()}:${cfg.razorpayKeySecret()}`).toString('base64')}`
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay'

  async createPaymentLink(input: CreateLinkInput): Promise<CreatedLink> {
    const amountPaise = Math.round(input.amountMajor * 100)
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountPaise,
        currency: input.currency,
        accept_partial: false,
        reference_id: input.orderNo,
                description: `Nextbilling order ${input.orderNo}`,
        customer: { name: input.customerName, contact: input.customerPhone },
        notify: { sms: false, email: false },
        ...(input.callbackUrl ? { callback_url: input.callbackUrl, callback_method: 'get' } : {}),
      }),
    })
    if (!res.ok) throw new Error(`razorpay link failed (${res.status}): ${await res.text()}`)
    const j = (await res.json()) as { id: string; short_url: string }
    return { linkId: j.id, url: j.short_url, provider: this.name }
  }

  /**
   * X-Razorpay-Signature = HMAC_SHA256(webhook_secret, rawBody). We validate
   * over the exact bytes received so nobody can tamper with amounts/status.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean {
    const sig = headers['x-razorpay-signature']
    const secret = cfg.razorpayWebhookSecret()
    if (!sig || !secret) return false
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(sig)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  parseWebhook(rawBody: string): VerifiedPayment | null {
    try {
      const j = JSON.parse(rawBody) as {
        event?: string
        payload?: { payment?: { entity?: RzpEntity }; refund?: { entity?: RzpEntity } }
      }
      const pay = j.payload?.payment?.entity
      if (j.event === 'refund.processed') {
        return {
          orderIdHint: String(pay?.receipt ?? pay?.notes?.orderNo ?? ''),
          paymentId: String(pay?.id ?? ''),
          amountPaidMajor: 0,
          currency: String(pay?.currency ?? 'INR'),
          status: 'REFUNDED',
          raw: j,
        }
      }
      if (!pay) return null
      const status = String(pay.status ?? '')
      if (!['captured', 'authorized', 'failed'].includes(status)) return null // duplicates/pending ignored
      return {
        orderIdHint: String(pay.receipt ?? pay.notes?.orderNo ?? ''),
        paymentId: String(pay.id ?? ''),
        // Gateway amounts are paise → back to major units.
        amountPaidMajor: (pay.amount ?? 0) / 100,
        currency: String(pay.currency ?? 'INR'),
        status: status === 'failed' ? 'FAILED' : 'PAID',
        raw: j,
      }
    } catch {
      return null
    }
  }
}

export function getPaymentProvider(): PaymentProvider | null {
  switch (cfg.paymentProvider()) {
    case 'razorpay':
      return new RazorpayProvider()
    default:
      return null
  }
}
