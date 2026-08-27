// ---------------------------------------------------------------------------
// Deterministic NLU for WhatsApp messages. Pure functions only (unit-tested).
// Extracts intents + quantities without any AI dependency; an optional LLM may
// be layered on top later but prices/stock/inventory ALWAYS come from Firestore.
// ---------------------------------------------------------------------------

export type Intent =
  | 'GREETING'
  | 'MENU_1_ORDER'
  | 'MENU_2_TRACK'
  | 'MENU_3_INFO'
  | 'MENU_4_CONTACT'
  | 'ADD_ITEMS'
  | 'REMOVE_ITEM'
  | 'PRICE_QUERY'
  | 'STOCK_QUERY'
  | 'VIEW_CART'
  | 'CHECKOUT'
  | 'CONFIRM'
  | 'CANCEL'
  | 'YES'
  | 'NO'
  | 'TRACK'
  | 'UNKNOWN'

export interface ParsedLineItem {
  quantity: number
  /** Free-text product phrase with the leading quantity words stripped. */
  text: string
  /** Unit mentioned by customer ("kg", "packet"…), or null. */
  unit?: string
}

const UNIT_WORDS = ['kg', 'kgs', 'kilogram', 'kilograms', 'g', 'gram', 'grams', 'litre', 'liter', 'ltr', 'l', 'ml', 'packet', 'packets', 'pack', 'piece', 'pieces', 'pcs', 'box', 'boxes', 'dozen', 'bottle', 'bottles', 'units']
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }

/**
 * Conversational filler stripped before quantity parsing so that natural
 * sentences like "I want 2 milk and 3 breads" parse exactly like "2 milk,
 * 3 breads". Never consumes number words — quantities survive intact.
 */
const FILLER_RE =
  /^\s*(?:(?:i|we|you|u|pls|plz|please|kindly|me)\s+)*(?:(?:would|i'd|id)\s+like|wanna|want|wanted|need|needed|looking\s+for|get\s+me|give\s+me|send\s+me|bring\s+me|grab|pick|can\s+you|could\s+you|may\s+i|can\s+i|shall\s+i|let\s+me|do\s+you\s+have|do\s+u\s+have|does\s+the\s+store\s+have|have\s+you\s+got|got\s+any|any)(?:\s+(?:get|have|add|buy))?\b[\s,:;-]*/

function stripFiller(segment: string): string {
  let cur = segment.trim()
  for (let i = 0; i < 4; i++) {
    const m = cur.match(FILLER_RE)
    if (!m || m[0].length === 0) break
    cur = cur.slice(m[0].length).trim()
  }
  return cur
}

export const normPhone = (raw: string): string => raw.replace(/\D/g, '')

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** "2 packets of Aashirvaad atta", "5 Coca Cola 1L", "milk x 10", "bread 2" */
export function parseQuantityPhrase(raw: string): ParsedLineItem[] {
  const text = normalize(raw)
  if (!text) return []
  const segments = splitOnConjunctions(text)
  const items: ParsedLineItem[] = []

  for (const segRaw of segments) {
    const seg = stripFiller(segRaw)
    if (!seg) continue
    let quantity = 1
    let unit: string | undefined
    let rest = seg

    // Leading quantity: number word, digit, or trailing "x N"/"N x".
    const leadWord = rest.match(/^([a-z]+)\b/)
    if (leadWord && leadWord[1] in NUM_WORDS) {
      quantity = NUM_WORDS[leadWord[1]]
      rest = rest.slice(leadWord[0].length).trim()
    } else {
      const leadNum = rest.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)?\s*(.+)$/)
      if (leadNum) {
        quantity = parseFloat(leadNum[1])
        if (leadNum[2]) unit = singular(leadNum[2])
        rest = leadNum[3].trim()
      }
    }
    // Fillers directly after the quantity.
    rest = rest.replace(/^(of|some|the|please)\s+/, '')

    if (rest && !unit) {
      const u = rest.match(/^([a-z]+)\s+/)
      if (u && UNIT_WORDS.includes(u[1])) {
        unit = singular(u[1])
        rest = rest.slice(u[0].length).trim()
      }
    }
    rest = rest.replace(/\bof\b/g, ' ').trim()

    // Trailing forms: "… milk x 10" / "… milk ×10" / "… milk 10"
    const trailX = rest.match(/\s*[x×]\s*(\d+(?:\.\d+)?)$/)
    if (trailX) {
      quantity = parseFloat(trailX[1])
      rest = rest.slice(0, trailX.index).trim()
    } else {
      const trailNum = rest.match(/\s+(\d+(?:\.\d+)?)\s*([a-z]{1,7})?$/)
      if (trailNum && trailNum.index !== undefined && /\s/.test(rest.slice(0, trailNum.index + 1))) {
        quantity = parseFloat(trailNum[1])
        if (trailNum[2] && UNIT_WORDS.includes(trailNum[2])) unit = singular(trailNum[2])
        rest = rest.slice(0, trailNum.index).trim()
      }
    }

    if (quantity <= 0 || !Number.isFinite(quantity)) continue
    if (!rest) continue
    items.push({ quantity, text: rest.replace(/[?!.]+$/, '').trim(), unit })
  }
  return items
}

function splitOnConjunctions(text: string): string[] {
  return text
    .split(/\band\b|,|\+|&|also\b|then\b/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

function singular(unit: string): string | undefined {
  if (!UNIT_WORDS.includes(unit)) return undefined
  return unit.replace(/s$/, '') || unit
}

export function detectIntent(raw: string): Intent {
  const t = normalize(raw)
  if (!t) return 'UNKNOWN'
  if (/^(hi|hii+|hello|hey|namaste|good\s?(morning|evening|afternoon)|start|menu)\b/.test(t)) return 'GREETING'
  if (/^[1️⃣]|^1$/.test(t)) return 'MENU_1_ORDER'
  if (/^[2️⃣]|^2$/.test(t)) return 'MENU_2_TRACK'
  if (/^[3️⃣]|^3$/.test(t)) return 'MENU_3_INFO'
  if (/^[4️⃣]|^4$/.test(t)) return 'MENU_4_CONTACT'
  if (/\b(remove|delete|drop)\b/.test(t)) return 'REMOVE_ITEM'
  if (/\b(cart|what do i have|my order details)\b/.test(t) && !/\bcheckout\b/.test(t)) return 'VIEW_CART'
  if (/\b(checkout|confirm|place the order|pay now|proceed)\b/.test(t)) return 'CHECKOUT'
  if (/^(yes|yep|yeah|ok|okay|sure|haan|ji haan)\b/.test(t)) return 'YES'
  if (/^(no|nope|nahi|cancel it|cancel)\b/.test(t)) return t.includes('cancel') ? 'CANCEL' : 'NO'
  if (/\b(track|where is my order|order status|status of)\b/.test(t) || /^#?ord-?\d+$/i.test(t)) return 'TRACK'
  // Stock availability questions ("do you have milk?") must win over the
  // generic ADD_ITEMS catch-all, but never hijack explicit order requests or
  // price questions.
  if (
    /\b(do you have|have you got|in stock|available|availability)\b/.test(t) &&
    !/\b(add|i want|i need|give me)\b/.test(t) &&
    !/\b(price|cost|how much|rate)\b/.test(t)
  )
    return 'STOCK_QUERY'
  if (/\b(price|cost|how much|rate)\b/.test(t) && !/\b(add|i want|i need|give me)\b/.test(t)) return 'PRICE_QUERY'
  if (/\b(confirm)\b/.test(t)) return 'CONFIRM'
  if (/\b(add|want|need|get me|give me|looking for|do you have|have you got|order)\b/.test(t)) return 'ADD_ITEMS'
  // Bare product mentions ("milk") → treat as add/search.
  if (t.split(' ').length <= 6) return 'ADD_ITEMS'
  return 'ADD_ITEMS'
}

/** Strips qty wording for price-queries so "how much is 1kg sugar" → "sugar". */
export function stripPriceNoise(text: string): string {
  return normalize(text)
    .replace(/how much (is|are|for)?|what('| i)?s the price of|price of|cost of|rate of|what does .* cost|price|cost|rate|\?/g, '')
    .replace(/^\s*\d+(\.\d+)?\s*(kg|g|gm|l|ml|litre|liter|packets?|pieces?|pcs)?\s*(of|from)?\s*/, '')
    .trim()
}
