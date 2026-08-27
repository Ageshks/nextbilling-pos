import type { SlowDeadRow } from '../../types/insight'

// Re-export so consumers using the `engine.*` namespace can reference this row
// type without importing from the types module directly.
export type { SlowDeadRow }

// Deterministic, testable inventory-intelligence engine.
//
// Layer 2 (intelligence) of the AI feature. All functions are pure and operate
// on plain numeric daily series (index 0 = today). Nothing here reads/writes
// Firestore or calls an external service, so the engine is fully unit-testable
// and the POS never depends on an external AI being available.

export const DAY_MS = 86400000

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0)
}
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return sum(values) / values.length
}
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length
  return Math.sqrt(variance)
}
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
/** Last `days` values of the series (index 0 = today). */
export function sliceSeries(days: number, series: number[]): number[] {
  return series.slice(0, Math.max(0, days))
}
/** Days within `days` that had sales > 0. */
export function nonZeroSaleDays(days: number, series: number[]): number {
  return sliceSeries(days, series).filter((v) => v > 0).length
}
/** Days since the most recent sale (index 0 = today), or null if none. */
export function daysSinceLastSale(series: number[]): number | null {
  for (let i = 0; i < series.length; i++) {
    if (series[i] > 0) return i
  }
  return null
}

// ---------------------------------------------------------------------------
// Confidence & sales velocity
// ---------------------------------------------------------------------------

export function calculateConfidence(
  series: number[],
  days: number,
  minDays = 5,
): 'high' | 'medium' | 'low' {
  const window = sliceSeries(days, series)
  const sold = window.filter((v) => v > 0).length
  if (sold < minDays) return 'low'
  const avg = mean(window)
  if (avg <= 0) return 'low'
  const cv = standardDeviation(window) / avg
  if (sold >= 20 && cv <= 0.6) return 'high'
  if (sold >= 10 && cv <= 1.1) return 'medium'
  return 'low'
}

export function averageDailySales(days: number, series: number[]): number {
  const window = sliceSeries(days, series)
  if (window.length === 0) return 0
  return sum(window) / window.length
}

/** Recent-weighted average daily sales (fresh demand weighted more). */
export function weightedVelocity(days: number, series: number[]): number {
  const window = sliceSeries(days, series)
  if (window.length === 0) return 0
  let totalWeight = 0
  let weightedSum = 0
  for (let i = 0; i < window.length; i++) {
    const weight = window.length - i // index 0 (today) gets the most weight
    totalWeight += weight
    weightedSum += window[i] * weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

// ---------------------------------------------------------------------------
// Demand forecast
// ---------------------------------------------------------------------------

export function forecastDemand(
  series: number[],
  lookback: number,
): { tomorrow: number; next7: number; next30: number; confidence: 'high' | 'medium' | 'low'; historyDays: number } {
  const window = sliceSeries(lookback, series)
  const historyDays = window.length
  const baseVelocity = historyDays > 0 ? sum(window) / historyDays : 0
  const filtered = window.filter((v) => v > 0)
  const confidence: 'high' | 'medium' | 'low' =
    filtered.length >= 20 ? 'high' : filtered.length >= 10 ? 'medium' : 'low'
  return {
    tomorrow: round1(baseVelocity),
    next7: round1(baseVelocity * 7),
    next30: round1(baseVelocity * 30),
    confidence,
    historyDays,
  }
}

/**
 * Optional day-of-week factor; 1 when history is too short to model reliably.
 * Only active for >= 28 days of history.
 */
export function dayOfWeekFactor(series: number[], todayDow: number): number {
  if (series.length < 28) return 1
  const totals = new Array(7).fill(0)
  const counts = new Array(7).fill(0)
  for (let i = 0; i < series.length; i++) {
    const dow = (((todayDow - i) % 7) + 7) % 7
    totals[dow] += series[i]
    counts[dow] += 1
  }
  const weekdayAvg = totals.map((t, idx) => (counts[idx] > 0 ? t / counts[idx] : 0))
  const overall = weekdayAvg.reduce((a, b) => a + b, 0) / 7 || 1
  const todayAvg = weekdayAvg[todayDow]
  return todayAvg > 0 ? todayAvg / overall : 1
}

// ---------------------------------------------------------------------------
// Stockout & reorder math
// ---------------------------------------------------------------------------

export function daysUntilStockoutCalc(stock: number, avgDaily: number): number | null {
  if (stock <= 0) return 0
  if (avgDaily <= 0) return null
  return stock / avgDaily
}

export function recommendedReorderQty(
  stock: number,
  avgDailyVelocity: number,
  leadTimeDays: number,
  safetyStockDays: number,
  minOrderQty: number,
): number {
  if (avgDailyVelocity <= 0) return 0
  const demand = avgDailyVelocity * (leadTimeDays + safetyStockDays)
  const qty = Math.max(0, Math.ceil(demand - stock))
  if (qty <= 0) return 0
  return Math.max(qty, minOrderQty)
}

// ---------------------------------------------------------------------------
// Product-level stock prediction
// ---------------------------------------------------------------------------

export interface ProductMovementInput {
  productId: string
  name: string
  unit: string
  stock: number
  minimumStock: number
  maximumStock: number
  purchasePrice: number
  sellingPrice: number
  active: boolean
  dailySales: number[] // index 0 = today
  dailyReturns: number[]
  /** Product GST rate (%) — surfaced so reorder rows can prefill purchase-order lines. */
  gstRate?: number
  /** Age of the product listing in days — enables dead-stock detection for never-sold products. */
  ageDays?: number
}

export function predictStock(
  product: ProductMovementInput,
  lookbackDays: number,
  thresholds: {
    leadTimeDays: number
    safetyStockDays: number
    deadStockDays: number
    slowMovingDays: number
    anomalyMultiplier: number
  },
): {
  productId: string
  name: string
  unit: string
  currentStock: number
  minStock: number
  maxStock: number
  avgDaily7: number
  avgDaily30: number
  weightedDaily: number
  daysOfHistory: number
  confidence: 'high' | 'medium' | 'low'
  daysUntilStockout: number | null
  demandNext1: number
  demandNext7: number
  demandNext30: number
  recommendedOrderQty: number
  needsReorder: boolean
  insufficientData: boolean
  /** Static product data carried through for draft-purchase-order prefill. */
  purchasePrice: number
  gstRate: number
} {
  const series = product.dailySales
  const avgDaily7 = round2(averageDailySales(7, series))
  const avgDaily30 = round2(averageDailySales(30, series))
  const weighted = round2(weightedVelocity(lookbackDays, series))
  const confidence = calculateConfidence(series, lookbackDays)
  const soldDays = nonZeroSaleDays(lookbackDays, series)
  const sufficient = soldDays >= 5

  const forecast = forecastDemand(series, lookbackDays)
  const dailyRate = sufficient ? (weighted > 0 ? weighted : avgDaily30) : 0
  const daysUntil = daysUntilStockoutCalc(product.stock, dailyRate)

  const lowOrOut = product.stock <= product.minimumStock
  const imminent = daysUntil !== null && daysUntil <= thresholds.leadTimeDays + thresholds.safetyStockDays
  const recommendedOrderQty = sufficient
    ? recommendedReorderQty(product.stock, dailyRate, thresholds.leadTimeDays, thresholds.safetyStockDays, 1)
    : 0

  return {
    productId: product.productId,
    name: product.name,
    unit: product.unit,
    currentStock: product.stock,
    minStock: product.minimumStock,
    maxStock: product.maximumStock,
    avgDaily7,
    avgDaily30,
    weightedDaily: weighted,
    daysOfHistory: Math.min(series.length, lookbackDays),
    confidence,
    daysUntilStockout: daysUntil === null ? null : round1(daysUntil),
    demandNext1: forecast.tomorrow,
    demandNext7: forecast.next7,
    demandNext30: forecast.next30,
    recommendedOrderQty,
    needsReorder: sufficient && (lowOrOut || imminent) && recommendedOrderQty > 0,
    insufficientData: !sufficient,
    purchasePrice: product.purchasePrice,
    gstRate: product.gstRate ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Fast / slow / dead stock classification
// ---------------------------------------------------------------------------

export function classifyMovement(
  soldUnits7d: number,
  daysSinceLast: number | null,
  thresholds: { slowMovingDays: number; deadStockDays: number },
): 'FAST' | 'NORMAL' | 'SLOW' | 'DEAD' {
  if (daysSinceLast !== null && daysSinceLast >= thresholds.deadStockDays) return 'DEAD'
  if (soldUnits7d > 0 && soldUnits7d < 5) return 'SLOW'
  return 'NORMAL'
}

export function buildSlowDeadRow(
  product: ProductMovementInput,
  thresholds: { slowMovingDays: number; deadStockDays: number },
): SlowDeadRow | null {
  // Only report products that actually sit on stock.
  if (product.stock <= 0) return null
  const soldDays = nonZeroSaleDays(product.dailySales.length, product.dailySales)
  const daysSince = daysSinceLastSale(product.dailySales)
  let kind: 'DEAD' | 'SLOW' | null
  if (daysSince !== null && daysSince >= thresholds.deadStockDays) {
    kind = 'DEAD'
  } else if (
    daysSince === null &&
    (product.ageDays ?? 0) >= thresholds.deadStockDays
  ) {
    // Listed longer than the dead-stock window yet has never sold a unit.
    kind = 'DEAD'
  } else if (daysSince !== null && daysSince >= thresholds.slowMovingDays && soldDays > 0) {
    // Has sold at least once historically but nothing within the slow-moving window.
    kind = 'SLOW'
  } else {
    return null
  }
  return {
    productId: product.productId,
    name: product.name,
    unit: product.unit,
    stock: product.stock,
    stockValue: round2(product.purchasePrice * product.stock),
    daysSinceLastSale: daysSince === null ? 0 : daysSince,
    lastSaleDay: daysSince === null ? null : daysSince,
    kind,
  }

// ---------------------------------------------------------------------------
// Anomaly detection (sales, discounts, refunds, inventory)
// ---------------------------------------------------------------------------
}

export interface AnomalyResult {
  kind: 'PRODUCT_SALES_SPIKE' | 'PRODUCT_SALES_DROP' | 'DISCOUNT' | 'REFUND' | 'INVENTORY_MISMATCH'
  severity: 'info' | 'warning' | 'critical'
  productId: string | null
  productName: string | null
  message: string
  support: Record<string, string | number | boolean | null>
  todayValue: number
  baselineAvg: number
  ratio: number | null
}

/**
 * Compares today's value against a baseline of prior days using a z-score
 * threshold (multiplier = number of standard deviations). Only flags when the
 * baseline has enough non-zero history to be meaningful, otherwise returns null
 * (we do not guess).
 */
export function detectAnomaly(
  todayValue: number,
  baseline: number[],
  multiplier: number,
  kind: AnomalyResult['kind'],
  productId: string | null,
  productName: string | null,
  direction: 'up' | 'down',
): AnomalyResult | null {
  const nonZero = baseline.filter((v) => v > 0)
  if (nonZero.length < 5) return null // not enough history
  const avg = mean(baseline)
  const sd = standardDeviation(baseline)
  if (avg <= 0) return null
  const threshold = sd > 0 ? avg + multiplier * sd : avg * (multiplier + 1)
  const isAnomalous = direction === 'up' ? todayValue > threshold : todayValue < avg - (sd > 0 ? multiplier * sd : 0)
  if (!isAnomalous) return null

  const ratio = avg > 0 ? todayValue / avg : null
  const severity: AnomalyResult['severity'] = ratio !== null && ratio >= multiplier * 2 ? 'critical' : 'warning'
  const trendWord = direction === 'up' ? 'higher' : 'lower'
  const message = productName
    ? `${productName}: today's value is ${trendWord} than usual. Normal range: ~${round1(avg)}. Please review.`
    : `Today's activity is ${trendWord} than usual (${round1(todayValue)} vs typical ~${round1(avg)}). Please review.`

  return {
    kind,
    severity,
    productId,
    productName,
    message,
    support: {
      todayValue: round1(todayValue),
      baselineAvg: round1(avg),
      baselineStdDev: sd > 0 ? round1(sd) : null,
      ratio: ratio !== null ? round2(ratio) : null,
      historyDays: baseline.length,
    },
    todayValue,
    baselineAvg: avg,
    ratio,
  }
}

/**
 * Inventory discrepancy: compares the product's recorded stock against the most
 * recent value written to the stock ledger (stockMovements.afterStock). A
 * meaningful difference signals the stock was changed outside the tracked
 * movement flow (e.g. a manual correction) and is worth a review.
 */
export function detectInventoryMismatch(
  productName: string,
  productId: string,
  currentStock: number,
  latestLedgerAfterStock: number,
): AnomalyResult | null {
  if (!Number.isFinite(latestLedgerAfterStock)) return null
  const diff = round2(currentStock - latestLedgerAfterStock)
  if (Math.abs(diff) < 0.01) return null
  return {
    kind: 'INVENTORY_MISMATCH',
    severity: Math.abs(diff) >= 5 ? 'warning' : 'info',
    productId,
    productName,
    message: `${productName}: recorded stock (${round1(currentStock)}) differs from the latest ledger value (${round1(latestLedgerAfterStock)}). Difference: ${diff < 0 ? '' : '+'}${round2(diff)}. Please review inventory adjustments and recent transactions.`,
    support: {
      currentStock: round1(currentStock),
      ledgerStock: round1(latestLedgerAfterStock),
      difference: round2(diff),
    },
    todayValue: currentStock,
    baselineAvg: latestLedgerAfterStock,
    ratio: null,
  }
}

// ---------------------------------------------------------------------------
// Daily business summary
// ---------------------------------------------------------------------------

export function buildSummaryPart(label: string, value: string, detail: string) {
  return { label, value, detail }
}

export function fmtMoney(n: number): string {
  return `₹${round2(n).toLocaleString('en-IN')}`
}


// ---------------------------------------------------------------------------
// Exported result types (used by the service layer and page)
// ---------------------------------------------------------------------------

export type StockPrediction = ReturnType<typeof predictStock>

export interface FastMovingRow {
  productId: string
  name: string
  unit: string
  sold7d: number
  revenue7d: number
  avgDaily: number
  stock: number
  daysLeft: number | null
  confidence: ReturnType<typeof calculateConfidence>
}