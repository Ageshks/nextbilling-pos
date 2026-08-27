// ---------------------------------------------------------------------------
// WhatsApp Business Platform (Cloud API) outbound client + webhook signature
// helpers. All credentials come from cfg(); nothing here is ever bundled into
// the browser app.
// ---------------------------------------------------------------------------
import crypto from 'crypto'
import { cfg, isWaConfigured } from './config'

const GRAPH_BASE = 'https://graph.facebook.com'

export interface InboundMessage {
  /** Caller phone in E164 digits only, e.g. 919876543210. */
  fromPhone: string
  name?: string
  body: string
  messageId: string
  receivedAt: number
}

export interface InboundEnvelope {
  messages: InboundMessage[]
  /** Raw payload hashes (message ids) for idempotency. */
}

/** HMAC-SHA256 of the raw request body, hex-encoded — Meta's signing scheme. */
export function signPayload(rawBody: string, appSecret: string): string {
  return crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
}

/** Constant-time compare of X-Hub-Signature-256 against the body we received. */
export function verifySignature(rawBody: string, header: string | undefined): boolean {
  const secret = cfg.waAppSecret()
  if (!secret || !header?.startsWith('sha256=')) return false
  const expected = signPayload(rawBody, secret)
  const got = header.slice('sha256='.length)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(got, 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Webhook subscription handshake (GET hub.challenge echo). */
export function isVerifyRequest(query: Record<string, unknown>): { ok: boolean; challenge: string } {
  const mode = String(query['hub.mode'] ?? '')
  const token = String(query['hub.verify_token'] ?? '')
  const challenge = String(query['hub.challenge'] ?? '')
  return { ok: mode === 'subscribe' && token === cfg.waVerifyToken(), challenge }
}

/** Extracts every text message from a Meta webhook payload (defensively). */
export function parseInbound(payload: unknown): InboundEnvelope {
  const out: InboundMessage[] = []
  try {
    const entry = (payload as { entry?: unknown })?.entry
    if (!Array.isArray(entry)) return { messages: out }
    for (const e of entry) {
      const changes = (e as { changes?: unknown })?.changes
      if (!Array.isArray(changes)) continue
      for (const c of changes) {
        const value = (c as { value?: unknown })?.value as
          | { messages?: Array<Record<string, unknown>>; contacts?: Array<Record<string, unknown>> }
          | undefined
        if (!value || !Array.isArray(value.messages)) continue
        const contactName = Array.isArray(value.contacts)
          ? String((value.contacts[0] as { profile?: { name?: string } })?.profile?.name ?? '')
          : ''
        for (const m of value.messages) {
          if (String(m.type ?? '') !== 'text') continue // interactive/replies land as text after our simple menu approach
          const text = String((m.text as { body?: string } | undefined)?.body ?? '').trim()
          if (!text) continue
          out.push({
            fromPhone: String(m.from ?? ''),
            name: contactName || undefined,
            body: text,
            messageId: String(m.id ?? ''),
            receivedAt: Number(m.timestamp ?? 0) * 1000 || Date.now(),
          })
        }
      }
    }
  } catch {
    // Malformed payloads never crash the webhook.
  }
  return { messages: out }
}

async function graphFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${GRAPH_BASE}/${cfg.graphApiVersion()}/${path}`, init)
}

/** Fire-and-forget friendly send — failures are logged, never thrown upward. */
export async function sendText(phoneDigits: string, text: string): Promise<boolean> {
  if (!isWaConfigured()) {
    console.warn('[wa] not configured; dropping outbound message')
    return false
  }
  try {
    const res = await graphFetch(`${cfg.waPhoneNumberId()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.waAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneDigits,
        type: 'text',
        text: { preview_url: false, body: text.slice(0, 4000) },
      }),
    })
    if (!res.ok) console.error('[wa] send failed', res.status, await res.text().catch(() => ''))
    return res.ok
  } catch (err) {
    console.error('[wa] send error', err)
    return false
  }
}

export async function markRead(messageId: string): Promise<void> {
  if (!isWaConfigured()) return
  try {
    await graphFetch(`${cfg.waPhoneNumberId()}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.waAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    })
  } catch {
    // Non-critical.
  }
}
