// Layer 1 + 3 wiring for the inventory-intelligence feature.
//
// Loads real Firestore data (products, sales, stock ledger), runs the
// deterministic engine over bounded reads, persists a daily rollup plus
// traceable insight records (audit trail), and answers natural-language
// questions using only the computed numbers — never invented figures.

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import { fetchSalesRange } from './reportService'
import { fetchAllProducts } from './productService'
import { startOfDay, endOfDay, daysAgo } from '../utils/format'
import { DAY_MS, engine, sum, round1 } from '../utils/ai'
import type { Product, Sale, StockMovement } from '../types'
import type {
  AIThresholdOptions,
  InsightBundle,
  InsightRecord,
  AssistantAnswer,
  InsightStatus,
} from '../types/insight'
import { DEFAULT_AI_THRESHOLDS } from '../types/insight'

const LOOKBACK_DAYS = 120

function dailyIndex(ts: number, todayStart: number): number {
  return Math.floor((todayStart - startOfDay(ts)) / DAY_MS)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export interface LoadedAnalyticsData {
  products: Product[]
  sales: Sale[]
  latestLedgerAfterStock: Map<string, number>
}

/** Fetch products + recent sales + latest stock-ledger values (bounded reads). */
export async function loadAnalyticsData(storeId: string): Promise<LoadedAnalyticsData> {
  const db = getDb()
  const [products, sales] = await Promise.all([
    fetchAllProducts(storeId),
    fetchSalesRange(storeId, daysAgo(LOOKBACK_DAYS), endOfDay(), 4000),
  ])

  const latestLedgerAfterStock = new Map<string, number>()
  try {
    const q = query(
      collection(db, COLLECTIONS.stockMovements),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(3000),
    )
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      const m = d.data() as Partial<StockMovement>
      if (m.productId && m.afterStock != null && !latestLedgerAfterStock.has(m.productId)) {
        latestLedgerAfterStock.set(m.productId, m.afterStock)
      }
    }
  } catch {
    // Stock-ledger reconciliation is best-effort; never block insights on it.
  }

  return { products, sales, latestLedgerAfterStock }
}

interface SeriesAccumulator {
  sales: number[]
  returns: number[]
}

function buildSeriesMaps(
  sales: Sale[],
  todayStart: number,
  lookback: number,
): Map<string, SeriesAccumulator> {
  const map = new Map<string, SeriesAccumulator>()
  const acc = (productId: string): SeriesAccumulator => {
    let a = map.get(productId)
    if (!a) {
      a = { sales: new Array(lookback).fill(0), returns: new Array(lookback).fill(0) }
      map.set(productId, a)
    }
    return a
  }
  for (const sale of sales) {
    if (sale.status === 'CANCELLED') continue
    const ts = typeof sale.createdAt === 'number' ? sale.createdAt : Date.now()
    const idx = dailyIndex(ts, todayStart)
    if (idx < 0 || idx >= lookback) continue
    for (const item of sale.items ?? []) {
      if (!item.productId) continue
      const bucket = acc(item.productId)
      bucket.sales[idx] = Math.max(0, Number(bucket.sales[idx] ?? 0) + Number(item.quantity || 0))
    }
  }
  return map
}


// ---------------------------------------------------------------------------
// Compute the full insight bundle from real data
// ---------------------------------------------------------------------------

export type ComputeOptions = AIThresholdOptions

export async function computeInsights(
  storeId: string,
  thresholds?: Partial<ComputeOptions>,
): Promise<InsightBundle> {
  const todayStart = startOfDay()
  const { products, sales, latestLedgerAfterStock } = await loadAnalyticsData(storeId)
  const seriesMap = buildSeriesMaps(sales, todayStart, LOOKBACK_DAYS)
  const t: Required<ComputeOptions> = { ...DEFAULT_AI_THRESHOLDS, ...(thresholds ?? {}) }

  const all: engine.StockPrediction[] = []
  const fastMoving: engine.FastMovingRow[] = []
  const slowDead: engine.SlowDeadRow[] = []
  const salesAnomalies: engine.AnomalyResult[] = []

  for (const product of products) {
    const acc = seriesMap.get(product.id ?? '')
    const dailySales = acc ? acc.sales : new Array(LOOKBACK_DAYS).fill(0)
    const dailyReturns = acc ? acc.returns : new Array(LOOKBACK_DAYS).fill(0)
    const input = {
      productId: product.id ?? '',
      name: product.name,
      unit: product.unit,
      stock: product.stock,
      minimumStock: product.minimumStock,
      maximumStock: product.maximumStock,
      purchasePrice: product.purchasePrice,
      gstRate: product.gstRate,
      sellingPrice: product.sellingPrice,
      active: product.active,
      ageDays:
        typeof product.createdAt === 'number'
          ? Math.max(0, Math.floor((Date.now() - product.createdAt) / DAY_MS))
          : undefined,
      dailySales,
      dailyReturns,
    }
    const prediction = engine.predictStock(input, LOOKBACK_DAYS, t)
    all.push(prediction)

    // Fast movers: meaningful 7-day volume AND enough stock context.
    const sold7 = sum(dailySales.slice(0, 7))
    if (sold7 >= 15) {
      const revenue7 = round2(sold7 * product.sellingPrice)
      const avgDaily = sold7 / 7
      const daysLeft = engine.daysUntilStockoutCalc(product.stock, avgDaily)
      fastMoving.push({
        productId: product.id ?? '',
        name: product.name,
        unit: product.unit,
        sold7d: sold7,
        revenue7d: revenue7,
        avgDaily: round2(avgDaily),
        stock: product.stock,
        daysLeft: daysLeft === null ? null : round1(daysLeft),
        confidence: prediction.confidence,
      })
    }

    // Slow / dead stock.
    const slowDeadRow = engine.buildSlowDeadRow(input, t)
    if (slowDeadRow) slowDead.push(slowDeadRow)

    // Per-product sales anomaly (today vs prior ~28 days).
    const todayQty = dailySales[0] ?? 0
    if (todayQty > 0) {
      const baseline = dailySales.slice(1, 29)
      const spike = engine.detectAnomaly(todayQty, baseline, t.anomalyMultiplier, 'PRODUCT_SALES_SPIKE', input.productId, input.name, 'up')
      if (spike) salesAnomalies.push(spike)
    } else {
      const baseline = dailySales.slice(1, 29)
      const drop = engine.detectAnomaly(0, baseline, t.anomalyMultiplier, 'PRODUCT_SALES_DROP', input.productId, input.name, 'down')
      if (drop && baseline.length >= 7) salesAnomalies.push(drop)
    }

    // Inventory discrepancy vs the stock ledger.
    const ledger = latestLedgerAfterStock.get(input.productId)
    if (Number.isFinite(ledger)) {
      const mismatch = engine.detectInventoryMismatch(input.name, input.productId, input.stock, ledger as number)
      if (mismatch) salesAnomalies.push(mismatch)
    }
  }

  // Network-level discount & refund anomaly (today vs prior ~28 days).
  const discountSeries = dailyTotalSeries(sales, todayStart, (s) => s.discount ?? 0)
  const refundSeries = dailyTotalSeries(sales, todayStart, (s) => s.returnInfo?.refundTotal ?? 0)
  const discAnomaly = engine.detectAnomaly(
    discountSeries[0] ?? 0,
    discountSeries.slice(1, 29),
    t.anomalyMultiplier,
    'DISCOUNT',
    null,
    null,
    'up',
  )
  if (discAnomaly) salesAnomalies.push(discAnomaly)
  const refundAnomaly = engine.detectAnomaly(
    refundSeries[0] ?? 0,
    refundSeries.slice(1, 29),
    t.anomalyMultiplier,
    'REFUND',
    null,
    null,
    'up',
  )
  if (refundAnomaly) salesAnomalies.push(refundAnomaly)

  // Resolve types to plain literals.
  const res = {
    predictions: all,
    fastMoving,
    slowDead,
    anomalies: salesAnomalies,
  }
  return buildBundle(storeId, res, t, sales)
}

function dailyTotalSeries(
  sales: Sale[],
  todayStart: number,
  pick: (s: Sale) => number,
): number[] {
  const out = new Array(LOOKBACK_DAYS).fill(0)
  for (const sale of sales) {
    if (sale.status === 'CANCELLED') continue
    const idx = dailyIndex(typeof sale.createdAt === 'number' ? sale.createdAt : Date.now(), todayStart)
    if (idx < 0 || idx >= LOOKBACK_DAYS) continue
    out[idx] = Math.max(0, out[idx] + Number(pick(sale) || 0))
  }
  return out
}


// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

interface ComputeResult {
  predictions: engine.StockPrediction[]
  fastMoving: engine.FastMovingRow[]
  slowDead: engine.SlowDeadRow[]
  anomalies: engine.AnomalyResult[]
}

function fmtMoney(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function buildBundle(
  storeId: string,
  r: ComputeResult,
  t: Required<AIThresholdOptions>,
  sales: Sale[],
): InsightBundle {
  const todayStart = startOfDay()
  const predictions = r.predictions
  const reorderCandidates = predictions
    .filter((p) => p.needsReorder)
    .sort((a, b) => (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity))

  const deadStock = r.slowDead.filter((s) => s.kind === 'DEAD')
  const deadValue = deadStock.reduce((acc, s) => acc + s.stockValue, 0)
  const fastNames = r.fastMoving.slice(0, 3).map((f) => f.name)
  const imminent = predictions.filter(
    (p) => p.daysUntilStockout !== null && p.daysUntilStockout <= 2 && p.confidence !== 'low',
  )
  const attentionAnomalies = r.anomalies.filter((a) => a.kind !== 'INVENTORY_MISMATCH').length

  const todayNet = sum(
    sales
      .filter((s) => s.status !== 'CANCELLED' && startOfDay(typeof s.createdAt === 'number' ? s.createdAt : 0) === todayStart)
      .map((s) => s.total),
  )
  const yestStart = todayStart - DAY_MS
  const yestNet = sum(
    sales
      .filter((s) => s.status !== 'CANCELLED' && startOfDay(typeof s.createdAt === 'number' ? s.createdAt : 0) === yestStart)
      .map((s) => s.total),
  )
  const pct = yestNet > 0 ? round2(((todayNet - yestNet) / yestNet) * 100) : null

  const hasData = predictions.some((p) => p.daysOfHistory > 0)
  const insufficientProducts = predictions.filter((p) => p.insufficientData).length

  const recommendations: string[] = []
  if (reorderCandidates.length > 0) {
    recommendations.push(
      `Order ${reorderCandidates
        .slice(0, 3)
        .map((p) => `${p.name} (${p.recommendedOrderQty} ${p.unit})`)
        .join(', ')}.`,
    )
  }
  if (r.anomalies.some((a) => a.kind === 'INVENTORY_MISMATCH')) {
    recommendations.push('Review the products flagged for inventory discrepancies.')
  }
  if (deadStock.length >= 4) {
    recommendations.push(`Review ${deadStock.length} slow/dead-stock items worth ${fmtMoney(deadValue)}.`)
  }
  if (attentionAnomalies > 0) {
    recommendations.push(`${attentionAnomalies} unusual activity pattern(s) detected — please review.`)
  }
  if (recommendations.length === 0) {
    recommendations.push('No urgent action needed today. Keep an eye on stock warnings below.')
  }

  return {
    storeId,
    generatedAt: Date.now(),
    currency: 'INR',
    products: predictions,
    fastMoving: r.fastMoving,
    slowDead: r.slowDead,
    reorderCandidates,
    salesAnomalies: r.anomalies,
    summary: {
      generatedFor: String(todayStart),
      sales: {
        label: 'Sales',
        value: pct === null ? `${fmtMoney(todayNet)} today` : `${pct >= 0 ? '+' : ''}${pct}% vs yesterday`,
        detail: `Today ${fmtMoney(todayNet)} · Yesterday ${fmtMoney(yestNet)}`,
      },
      inventory: {
        label: 'Inventory',
        value: `${imminent.length} product(s) likely to run out within 2 days`,
        detail: `${predictions.filter((p) => p.currentStock <= 0).length} out of stock · ${insufficientProducts} with too little history to forecast`,
      },
      fastMovers: fastNames.length
        ? { label: 'Fast movers', value: fastNames.join(', '), detail: 'Highest 7-day sales volume' }
        : { label: 'Fast movers', value: 'Not enough volume yet', detail: 'No product reached the fast-moving threshold' },
      deadStock: {
        label: 'Dead stock',
        value: `${deadStock.length} product(s) unsold in the last ${t.deadStockDays} days`,
        detail: `${fmtMoney(deadValue)} of inventory value`,
      },
      attention: {
        label: 'Attention required',
        value: `${attentionAnomalies} unusual pattern(s)`,
        detail: 'Neutral, data-backed explanations (see Anomalies)',
      },
      recommendations,
    },
    confidenceInfo: true,
    hasData,
    insufficientProducts,
  }
}


// ---------------------------------------------------------------------------
// Persistence (audit trail + daily rollup) — idempotent, best-effort
// ---------------------------------------------------------------------------

function dedupeId(storeId: string, type: string, productId: string, day: number): string {
  const key = `${day}_${type}_${productId}`
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return `i_${h.toString(36)}_${storeId.slice(-6)}`
}

function formatDays(d: number | null): string {
  if (d === null) return 'unknown (no sales history)'
  const n = Math.ceil(d)
  return `approximately ${n} day${n === 1 ? '' : 's'}`
}

export async function persistInsightRecords(
  bundle: InsightBundle,
  opts?: Partial<AIThresholdOptions>,
): Promise<void> {
  const db = getDb()
  const day = startOfDay()
  void opts

  type Write = { id: string; record: Omit<InsightRecord, 'id'> }
  const writes: Write[] = []
  for (const p of bundle.reorderCandidates.slice(0, 8)) {
    writes.push({
      id: dedupeId(bundle.storeId, 'REORDER', p.productId, day),
      record: {
        storeId: bundle.storeId,
        productId: p.productId,
        productName: p.name,
        type: 'REORDER',
        severity: p.daysUntilStockout !== null && p.daysUntilStockout <= 2 ? 'critical' : 'warning',
        confidence: p.confidence,
        status: 'new',
        message: `${p.name} may run out in ${formatDays(p.daysUntilStockout)}.`,
        recommendation: `Recommended action: order ${p.recommendedOrderQty} ${p.unit}(s).`,
        supportingMetrics: {
          currentStock: p.currentStock,
          avgDaily7: p.avgDaily7,
          avgDaily30: p.avgDaily30,
          weightedDaily: p.weightedDaily,
          daysUntilStockout: p.daysUntilStockout,
          confidence: p.confidence,
          recommendedOrderQty: p.recommendedOrderQty,
        },
        generatedAt: Date.now(),
      },
    })
  }
  for (const a of bundle.salesAnomalies.slice(0, 8)) {
    writes.push({
      id: dedupeId(bundle.storeId, a.kind, a.productId ?? 'store', day),
      record: {
        storeId: bundle.storeId,
        productId: a.productId,
        productName: a.productName,
        type: a.kind,
        severity: a.severity,
        confidence: 'medium',
        status: 'new',
        message: a.message,
        recommendation: 'Please review the supporting metrics below.',
        supportingMetrics: a.support,
        generatedAt: Date.now(),
      },
    })
  }

  for (const w of writes) {
    try {
      await setDoc(doc(db, COLLECTIONS.aiInsights, w.id), {
        ...w.record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch {
      // Persisting the audit trail is best-effort; never fail insights compute.
    }
  }
}


/** Persist a compact daily rollup (single small doc, cost-optimised history). */
export async function storeDailyRollup(bundle: InsightBundle): Promise<void> {
  const db = getDb()
  try {
    await setDoc(doc(db, COLLECTIONS.dailyInsights, bundle.storeId), {
      storeId: bundle.storeId,
      day: startOfDay(),
      generatedAt: serverTimestamp(),
      reorderCount: bundle.reorderCandidates.length,
      anomalyCount: bundle.salesAnomalies.length,
      fastMoverCount: bundle.fastMoving.length,
      deadStockCount: bundle.slowDead.filter((s) => s.kind === 'DEAD').length,
      updatedAt: serverTimestamp(),
    })
  } catch {
    // Best-effort; insights never depend on persistence succeeding.
  }
}

export async function updateInsightStatus(id: string, status: InsightStatus): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.aiInsights, id), {
    status,
    updatedAt: serverTimestamp(),
  })
}

export async function listInsights(storeId: string, max = 50): Promise<InsightRecord[]> {
  const db = getDb()
  try {
    const q = query(
      collection(db, COLLECTIONS.aiInsights),
      where('storeId', '==', storeId),
      orderBy('generatedAt', 'desc'),
      limit(max),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) } as unknown as InsightRecord))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Natural-language assistant (rule-based, deterministic, never invents data)
// ---------------------------------------------------------------------------

export function answerAssistant(question: string, bundle: InsightBundle): AssistantAnswer {
  const q = question.toLowerCase()

  if (!bundle.hasData) {
    return { ok: true, claimedData: false, reply: "I don't have enough data to answer that reliably." }
  }

  const join = (arr: string[], fallback: string): string => (arr.length ? arr.join('\n') : fallback)

  if (/\b(order|reorder|re-stock|restock|buy|stock up)\b/.test(q)) {
    const ids = bundle.reorderCandidates.filter((p) => !p.insufficientData).slice(0, 6)
    if (ids.length === 0) return { ok: true, claimedData: true, reply: 'No products currently need reordering based on today\'s data.' }
    return {
      ok: true,
      claimedData: true,
      reply: join(
        ids.map(
          (p) =>
            `${p.name}: order ${p.recommendedOrderQty} ${p.unit}(s) — about ${p.daysUntilStockout === null ? '?' : Math.ceil(p.daysUntilStockout)} days of stock left.`,
        ),
        'No reorder candidates today.',
      ),
    }
  }

  if (/fastest|selling fastest|fast mov|top seller/.test(q)) {
    return {
      ok: true,
      claimedData: true,
      reply: join(
        bundle.fastMoving
          .slice(0, 5)
          .map((f) => `${f.name} — ${f.sold7d} sold in 7 days, ${fmtMoney(f.revenue7d)} revenue`),
        'No fast-moving products detected yet.',
      ),
    }
  }

  if (/not moving|slow|dead|stale/.test(q)) {
    const rows = bundle.slowDead.slice(0, 8)
    if (rows.length === 0) return { ok: true, claimedData: true, reply: 'No slow or dead-stock products were detected.' }
    const total = rows.reduce((a, r) => a + r.stockValue, 0)
    return {
      ok: true,
      claimedData: true,
      reply: `${rows.length} slow/dead-stock product(s) worth ${fmtMoney(total)} in stock:\n${rows
        .map((r) => `${r.name} — ${r.kind === 'DEAD' ? 'no sale in the detection window' : 'slow velocity'}, ${r.stock} in stock`)
        .join('\n')}`,
    }
  }

  if (/tied up|inventory.*(slow|dead)|value.*(slow|dead)|how much.*stock/.test(q)) {
    const total = bundle.slowDead.reduce((a, r) => a + r.stockValue, 0)
    return {
      ok: true,
      claimedData: true,
      reply: `${bundle.slowDead.length} slow/dead-stock product(s) tie up ${fmtMoney(total)} in inventory value.`,
    }
  }

  if (/run out|stockout|stock.*(week|half)/.test(q)) {
    const soon = bundle.products.filter((p) => p.daysUntilStockout !== null && p.daysUntilStockout <= 7)
    if (soon.length === 0) return { ok: true, claimedData: true, reply: 'No products are expected to run out within the next week.' }
    return {
      ok: true,
      claimedData: true,
      reply: join(
        soon
          .slice(0, 8)
          .map((p) => `${p.name} — about ${Math.ceil(p.daysUntilStockout as number)} days left (${p.currentStock} in stock)`),
        '',
      ),
    }
  }

  if (/unusual|anomal|suspicious|strange|attention/.test(q)) {
    const a = bundle.salesAnomalies
    if (a.length === 0) return { ok: true, claimedData: true, reply: 'No unusual activity detected in today\'s data.' }
    return { ok: true, claimedData: true, reply: join(a.slice(0, 6).map((x) => x.message), '') }
  }

  if (/sales (increase|up|rise|jump)|why.*sales|today.*sales/.test(q)) {
    return { ok: true, claimedData: true, reply: bundle.summary.sales.detail }
  }

  if (/confidence|reliable/.test(q)) {
    return {
      ok: true,
      claimedData: true,
      reply:
        "Each prediction shows a confidence level (high/medium/low). Low confidence means there is too little or too erratic sales history to make a reliable call.",
    }
  }

  return {
    ok: true,
    claimedData: false,
    reply:
      "Try asking: 'What should I order today?', 'Which products are selling fastest?', 'Which products are not moving?', 'Which products might run out this week?', 'Show me unusual activity today.', or 'How much inventory is tied up in slow-moving products?'",
  }
}

