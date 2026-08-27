// AI / Inventory intelligence types.
//
// These describe the *structured* analytics that the intelligence engine
// produces. Everything here is derived from real Firestore transaction data
// (bounded reads) and is deterministic — no externally-sourced numbers.

export type Confidence = 'high' | 'medium' | 'low'

export type InsightSeverity = 'info' | 'warning' | 'critical'

export type InsightStatus = 'new' | 'reviewed' | 'dismissed' | 'actioned'

export type ProductClass = 'FAST' | 'NORMAL' | 'SLOW' | 'DEAD'

export interface ProductMovementInput {
  productId: string
  name: string
  unit: string
  stock: number // current stock (may be negative)
  minimumStock: number
  maximumStock: number
  purchasePrice: number // cost per unit
  sellingPrice: number // price per unit
  active: boolean
  // Units sold per calendar day, indexed so index 0 = today.
  dailySales: number[]
  // Units returned per day (index 0 = today).
  dailyReturns: number[]
}

export interface StockPrediction {
  productId: string
  name: string
  unit: string
  currentStock: number
  minStock: number
  maxStock: number
  avgDaily7: number
  avgDaily30: number
  weightedDaily: number // recent-weighted velocity
  daysOfHistory: number
  confidence: Confidence
  daysUntilStockout: number | null // null = insufficient data (no sales)
  demandNext1: number
  demandNext7: number
  demandNext30: number
  recommendedOrderQty: number
  needsReorder: boolean
  insufficientData: boolean // not enough sales history for a reliable call
  /** Static product data carried through for draft-purchase-order prefill. */
  purchasePrice: number
  gstRate: number
}

export interface FastMovingRow {
  productId: string
  name: string
  unit: string
  sold7d: number
  revenue7d: number
  avgDaily: number
  stock: number
  daysLeft: number | null
  confidence: Confidence
}

export interface SlowDeadRow {
  productId: string
  name: string
  unit: string
  stock: number
  stockValue: number
  daysSinceLastSale: number
  lastSaleDay: number | null
  kind: 'SLOW' | 'DEAD'
}

export type AnomalyKind = 'PRODUCT_SALES_SPIKE' | 'PRODUCT_SALES_DROP' | 'DISCOUNT' | 'REFUND' | 'INVENTORY_MISMATCH'

export interface SalesAnomaly {
  kind: AnomalyKind
  severity: InsightSeverity
  productId: string | null
  productName: string | null
  message: string
  support: Record<string, string | number | boolean | null>
  todayValue: number
  baselineAvg: number
  ratio: number | null
}

export interface BusinessSummaryPart {
  label: string
  value: string
  detail: string
}

export interface ChargedSummary {
  generatedFor: string
  sales: BusinessSummaryPart
  inventory: BusinessSummaryPart
  fastMovers: BusinessSummaryPart
  deadStock: BusinessSummaryPart
  attention: BusinessSummaryPart
  recommendations: string[]
}

export interface InsightBundle {
  storeId: string
  generatedAt: number
  currency: string
  products: StockPrediction[]
  fastMoving: FastMovingRow[]
  slowDead: SlowDeadRow[]
  reorderCandidates: StockPrediction[]
  salesAnomalies: SalesAnomaly[]
  summary: ChargedSummary
  confidenceInfo: boolean
  hasData: boolean
  insufficientProducts: number
}

export interface AIThresholdOptions {
  leadTimeDays: number
  safetyStockDays: number
  deadStockDays: number
  slowMovingDays: number
  anomalyMultiplier: number
}

export const DEFAULT_AI_THRESHOLDS: AIThresholdOptions = {
  leadTimeDays: 7,
  safetyStockDays: 3,
  deadStockDays: 30,
  slowMovingDays: 21,
  anomalyMultiplier: 2,
}

/**
 * Hand-off contract between AI Insights and the Purchases page: staged reorder
 * lines are passed through sessionStorage-style localStorage so the user can
 * review and explicitly confirm the real purchase. Nothing is written to the
 * `purchases` collection until the user submits the normal editor.
 */
export interface PurchasePrefillLine {
  productId: string
  name: string
  unit: string
  quantity: number
  purchasePrice: number
  gstRate: number
}

export const aiPurchasePrefillKey = (storeId: string): string => `ai_purchase_prefill_${storeId}`

export interface InsightRecord {
  id?: string
  storeId: string
  productId: string | null
  productName: string | null
  type: string // e.g. 'REORDER', 'LOW_STOCK', 'SALES_ANOMALY'
  severity: InsightSeverity
  confidence: Confidence
  status: InsightStatus
  message: string
  recommendation: string
  supportingMetrics: Record<string, string | number | boolean | null>
  generatedAt: number
  snoozeUntil?: number | null
}

export interface AssistantAnswer {
  ok: boolean
  claimedData: boolean
  reply: string
}