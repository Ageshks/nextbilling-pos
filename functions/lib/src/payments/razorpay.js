"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RazorpayProvider = void 0;
exports.getPaymentProvider = getPaymentProvider;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
function authHeader() {
    return `Basic ${Buffer.from(`${config_1.cfg.razorpayKeyId()}:${config_1.cfg.razorpayKeySecret()}`).toString('base64')}`;
}
class RazorpayProvider {
    constructor() {
        this.name = 'razorpay';
    }
    async createPaymentLink(input) {
        const amountPaise = Math.round(input.amountMajor * 100);
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
        });
        if (!res.ok)
            throw new Error(`razorpay link failed (${res.status}): ${await res.text()}`);
        const j = (await res.json());
        return { linkId: j.id, url: j.short_url, provider: this.name };
    }
    /**
     * X-Razorpay-Signature = HMAC_SHA256(webhook_secret, rawBody). We validate
     * over the exact bytes received so nobody can tamper with amounts/status.
     */
    verifyWebhook(rawBody, headers) {
        const sig = headers['x-razorpay-signature'];
        const secret = config_1.cfg.razorpayWebhookSecret();
        if (!sig || !secret)
            return false;
        const expected = crypto_1.default.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        const a = Buffer.from(expected);
        const b = Buffer.from(sig);
        return a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
    }
    parseWebhook(rawBody) {
        try {
            const j = JSON.parse(rawBody);
            const pay = j.payload?.payment?.entity;
            if (j.event === 'refund.processed') {
                return {
                    orderIdHint: String(pay?.receipt ?? pay?.notes?.orderNo ?? ''),
                    paymentId: String(pay?.id ?? ''),
                    amountPaidMajor: 0,
                    currency: String(pay?.currency ?? 'INR'),
                    status: 'REFUNDED',
                    raw: j,
                };
            }
            if (!pay)
                return null;
            const status = String(pay.status ?? '');
            if (!['captured', 'authorized', 'failed'].includes(status))
                return null; // duplicates/pending ignored
            return {
                orderIdHint: String(pay.receipt ?? pay.notes?.orderNo ?? ''),
                paymentId: String(pay.id ?? ''),
                // Gateway amounts are paise → back to major units.
                amountPaidMajor: (pay.amount ?? 0) / 100,
                currency: String(pay.currency ?? 'INR'),
                status: status === 'failed' ? 'FAILED' : 'PAID',
                raw: j,
            };
        }
        catch {
            return null;
        }
    }
}
exports.RazorpayProvider = RazorpayProvider;
function getPaymentProvider() {
    switch (config_1.cfg.paymentProvider()) {
        case 'razorpay':
            return new RazorpayProvider();
        default:
            return null;
    }
}
//# sourceMappingURL=razorpay.js.map