"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signPayload = signPayload;
exports.verifySignature = verifySignature;
exports.isVerifyRequest = isVerifyRequest;
exports.parseInbound = parseInbound;
exports.sendText = sendText;
exports.markRead = markRead;
// ---------------------------------------------------------------------------
// WhatsApp Business Platform (Cloud API) outbound client + webhook signature
// helpers. All credentials come from cfg(); nothing here is ever bundled into
// the browser app.
// ---------------------------------------------------------------------------
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("./config");
const GRAPH_BASE = 'https://graph.facebook.com';
/** HMAC-SHA256 of the raw request body, hex-encoded — Meta's signing scheme. */
function signPayload(rawBody, appSecret) {
    return crypto_1.default.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
}
/** Constant-time compare of X-Hub-Signature-256 against the body we received. */
function verifySignature(rawBody, header) {
    const secret = config_1.cfg.waAppSecret();
    if (!secret || !header?.startsWith('sha256='))
        return false;
    const expected = signPayload(rawBody, secret);
    const got = header.slice('sha256='.length);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(got, 'utf8');
    return a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
}
/** Webhook subscription handshake (GET hub.challenge echo). */
function isVerifyRequest(query) {
    const mode = String(query['hub.mode'] ?? '');
    const token = String(query['hub.verify_token'] ?? '');
    const challenge = String(query['hub.challenge'] ?? '');
    return { ok: mode === 'subscribe' && token === config_1.cfg.waVerifyToken(), challenge };
}
/** Extracts every text message from a Meta webhook payload (defensively). */
function parseInbound(payload) {
    const out = [];
    try {
        const entry = payload?.entry;
        if (!Array.isArray(entry))
            return { messages: out };
        for (const e of entry) {
            const changes = e?.changes;
            if (!Array.isArray(changes))
                continue;
            for (const c of changes) {
                const value = c?.value;
                if (!value || !Array.isArray(value.messages))
                    continue;
                const contactName = Array.isArray(value.contacts)
                    ? String(value.contacts[0]?.profile?.name ?? '')
                    : '';
                for (const m of value.messages) {
                    if (String(m.type ?? '') !== 'text')
                        continue; // interactive/replies land as text after our simple menu approach
                    const text = String(m.text?.body ?? '').trim();
                    if (!text)
                        continue;
                    out.push({
                        fromPhone: String(m.from ?? ''),
                        name: contactName || undefined,
                        body: text,
                        messageId: String(m.id ?? ''),
                        receivedAt: Number(m.timestamp ?? 0) * 1000 || Date.now(),
                    });
                }
            }
        }
    }
    catch {
        // Malformed payloads never crash the webhook.
    }
    return { messages: out };
}
async function graphFetch(path, init) {
    return fetch(`${GRAPH_BASE}/${config_1.cfg.graphApiVersion()}/${path}`, init);
}
/** Fire-and-forget friendly send — failures are logged, never thrown upward. */
async function sendText(phoneDigits, text) {
    if (!(0, config_1.isWaConfigured)()) {
        console.warn('[wa] not configured; dropping outbound message');
        return false;
    }
    try {
        const res = await graphFetch(`${config_1.cfg.waPhoneNumberId()}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config_1.cfg.waAccessToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: phoneDigits,
                type: 'text',
                text: { preview_url: false, body: text.slice(0, 4000) },
            }),
        });
        if (!res.ok)
            console.error('[wa] send failed', res.status, await res.text().catch(() => ''));
        return res.ok;
    }
    catch (err) {
        console.error('[wa] send error', err);
        return false;
    }
}
async function markRead(messageId) {
    if (!(0, config_1.isWaConfigured)())
        return;
    try {
        await graphFetch(`${config_1.cfg.waPhoneNumberId()}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config_1.cfg.waAccessToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
        });
    }
    catch {
        // Non-critical.
    }
}
//# sourceMappingURL=whatsapp.js.map