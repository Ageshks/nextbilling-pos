import { describe, expect, it } from 'vitest'
import {
  averageDailySales,
  buildSlowDeadRow,
  calculateConfidence,
  classifyMovement,
  daysSinceLastSale,
  daysUntilStockoutCalc,
  detectAnomaly,
  detectInventoryMismatch,
  forecastDemand,
  nonZeroSaleDays,
  predictStock,
  recommendedReorderQty,
  sliceSeries,
  standardDeviation,
  sum,
  weightedVelocity,
  type ProductMovementInput,
} from './engine'

const THRESHOLDS = {
  leadTimeDays: 7,
  safetyStockDays: 3,
  deadStockDays: 30,
  slowMovingDays: 21,
  anomalyMultiplier: 2,
}

function input(partial: Partial<ProductMovementInput>): ProductMovementInput {
  return {
    productId: 'p1',
    name: 'Milk 1L',
    unit: 'pcs',
    stock: 14,
    purchasePrice: 40,
    sellingPrice: 55,
    active: true,
    minimumStock: 10,
    maximumStock: 200,
    dailySales: [],
    dailyReturns: [],
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

describe('numeric helpers', () => {
  it('sliceSeries takes the most recent N days from a today-first series', () => {
    expect(sliceSeries(3, [4, 5, 6, 7])).toEqual([4, 5, 6])
    expect(sliceSeries(10, [1])).toEqual([1])
  })

  it('sum / standardDeviation', () => {
    expect(sum([1, 2, 3])).toBe(6)
    expect(standardDeviation([5, 5, 5])).toBe(0)
  })

  it('nonZeroSaleDays counts only selling days inside the window', () => {
    expect(nonZeroSaleDays(7, [0, 3, 0, 0, 2, 0, 0, 9, 9])).toBe(2)
  })

  it('daysSinceLastSale returns index of most recent sale and null when never sold', () => {
    expect(daysSinceLastSale([0, 0, 5, 1])).toBe(2)
    expect(daysSinceLastSale([0, 0, 0])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Sales velocity
// ---------------------------------------------------------------------------

describe('averageDailySales', () => {
  it('averages the requested window only', () => {
    const series = [8, 8, 8, 8, 8, 8, 8, 100, 100]
    expect(averageDailySales(7, series)).toBeCloseTo(8)
  })

  it('uses partial windows when history is shorter', () => {
    expect(averageDailySales(7, [10, 0])).toBeCloseTo(5)
    expect(averageDailySales(7, [])).toBe(0)
  })
})

describe('weightedVelocity', () => {
  it('weights recent days (index 0 = today) more than older days', () => {
    const series = [8, 0, 0, 0]
    expect(averageDailySales(4, series)).toBe(2)
    // A burst today pulls the weighted rate well above the plain average…
    expect(weightedVelocity(4, series)).toBeGreaterThan(2)
    // …while an identical burst 3 days ago pulls it below.
    expect(weightedVelocity(4, [0, 0, 0, 8])).toBeLessThan(2)
  })
})

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe('calculateConfidence', () => {
  it('high for long consistent history', () => {
    expect(calculateConfidence(Array(30).fill(3), 30)).toBe('high')
  })

  it('medium for moderate history', () => {
    // 15 selling days of alternating stock levels keeps cv at exactly 1 (≤ 1.1).
    const series = Array(15).fill(0).concat(Array(15).fill(2))
    expect(calculateConfidence(series, 30)).toBe('medium')
  })

  it('low for sparse or short history', () => {
    expect(calculateConfidence([0, 0, 5], 30)).toBe('low')
    expect(calculateConfidence([], 30)).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// Demand forecast & seasonality
// ---------------------------------------------------------------------------

describe('forecastDemand', () => {
  it('projects tomorrow/7d/30d from the lookback window', () => {
    const series = Array(40).fill(2)
    const f = forecastDemand(series, 30)
    expect(f.tomorrow).toBeCloseTo(2)
    expect(f.next7).toBeCloseTo(14)
    expect(f.next30).toBeCloseTo(60)
    expect(f.historyDays).toBe(30)
  })

  it('low confidence with sparse history; rate uses available days only', () => {
    const f = forecastDemand([3, 0, 0], 30)
    expect(f.confidence).toBe('low')
    // 3 units over 3 recorded days → 1/day → 7 units next week.
    expect(f.tomorrow).toBe(1)
    expect(f.next7).toBeCloseTo(7)
  })
})

// ---------------------------------------------------------------------------
// Stockout & reorder math
// ---------------------------------------------------------------------------

describe('daysUntilStockoutCalc', () => {
  it('handles negative inventory as immediate stockout', () => {
    expect(daysUntilStockoutCalc(-5, 8)).toBe(0)
    expect(daysUntilStockoutCalc(0, 8)).toBe(0)
  })
  it('null when there is no demand', () => {
    expect(daysUntilStockoutCalc(14, 0)).toBeNull()
  })
  it('stock divided by daily rate', () => {
    expect(daysUntilStockoutCalc(14, 8)).toBeCloseTo(1.75)
  })
})

describe('recommendedReorderQty (lead time + safety stock − on hand)', () => {
  it('orders demand during lead+safety minus current stock', () => {
    expect(recommendedReorderQty(14, 8, 7, 3, 1)).toBe(66) // ceil(8*10 - 14)
  })
  it('respects minimum order quantity', () => {
    expect(recommendedReorderQty(70, 8, 7, 3, 25)).toBe(25)
  })
  it('no order when stock covers the horizon', () => {
    expect(recommendedReorderQty(100, 8, 7, 3, 1)).toBe(0)
  })
  it('never orders when there is no measurable demand', () => {
    expect(recommendedReorderQty(0, 0, 7, 3, 1)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Full per-product prediction
// ---------------------------------------------------------------------------

describe('predictStock', () => {
  it('flags critical stockout for a fast mover', () => {
    const p = predictStock(input({ dailySales: Array(40).fill(8), stock: 14 }), 30, THRESHOLDS)
    expect(p.currentStock).toBe(14)
    expect(p.avgDaily7).toBeCloseTo(8)
    expect(p.daysUntilStockout as number).toBeLessThanOrEqual(2)
    expect(p.needsReorder).toBe(true)
    expect(p.recommendedOrderQty).toBeGreaterThan(0)
  })

  it('slow mover with healthy stock is not flagged', () => {
    const p = predictStock(input({ dailySales: Array(40).fill(0.5), stock: 90 }), 30, THRESHOLDS)
    expect(p.needsReorder).toBe(false)
  })

  it('zero sales: insufficient data, no invented forecast', () => {
    const p = predictStock(input({ dailySales: Array(40).fill(0), stock: 5 }), 30, THRESHOLDS)
    expect(p.insufficientData).toBe(true)
    expect(p.needsReorder).toBe(false)
    expect(p.recommendedOrderQty).toBe(0)
    expect(p.daysUntilStockout).toBeNull()
    expect(p.confidence).toBe('low')
  })

  it('new product (few selling days) is explicitly marked unreliable', () => {
    const p = predictStock(input({ dailySales: [4, 0, 3], stock: 20 }), 30, THRESHOLDS)
    expect(p.insufficientData).toBe(true)
    expect(p.needsReorder).toBe(false)
  })

  it('negative inventory counts as out of stock, not a crash', () => {
    const p = predictStock(input({ dailySales: Array(30).fill(6), stock: -4 }), 30, THRESHOLDS)
    expect(p.currentStock).toBe(-4)
    expect(p.daysUntilStockout).toBe(0)
    expect(p.needsReorder).toBe(true)
  })

  it('large stock produces a far-out stockout and no reorder', () => {
    const p = predictStock(
      input({ dailySales: Array(30).fill(5), stock: 5000, maximumStock: 8000 }),
      30,
      THRESHOLDS,
    )
    expect(p.daysUntilStockout as number).toBeGreaterThan(300)
    expect(p.needsReorder).toBe(false)
  })

  it('recent weekend surge lifts weighted velocity above the flat average', () => {
    // Index 0 = today: put the surge on the most recent two days.
    const series = [20, 20, ...Array(28).fill(2)]
    const p = predictStock(input({ dailySales: series, stock: 60 }), 30, THRESHOLDS)
    expect(p.weightedDaily).toBeGreaterThan(p.avgDaily30)
    // Stockout arrives sooner than the flat-average estimate would suggest.
    expect(p.daysUntilStockout as number).toBeLessThan(60 / p.avgDaily30)
  })
})

// ---------------------------------------------------------------------------
// Movement classification
// ---------------------------------------------------------------------------

describe('classifyMovement', () => {
  it('dead when no sale within the dead-stock window', () => {
    expect(classifyMovement(0, 45, { slowMovingDays: 21, deadStockDays: 30 })).toBe('DEAD')
  })
  it('slow for tiny volumes', () => {
    expect(classifyMovement(3, 4, { slowMovingDays: 21, deadStockDays: 30 })).toBe('SLOW')
  })
  it('normal otherwise', () => {
    expect(classifyMovement(30, 1, { slowMovingDays: 21, deadStockDays: 30 })).toBe('NORMAL')
  })
})

describe('buildSlowDeadRow', () => {
  it('reports DEAD with stock value and last-sale info', () => {
    const row = buildSlowDeadRow(
      input({ dailySales: [0, ...Array(40).fill(0), 3], stock: 20, purchasePrice: 50 }),
      THRESHOLDS,
    )
    expect(row).not.toBeNull()
    expect(row?.kind).toBe('DEAD')
    expect(row?.stockValue).toBe(1000)
    expect((row?.lastSaleDay ?? 0) >= 41).toBe(true)
  })

  it('excludes products without stock or without any sale record', () => {
    expect(buildSlowDeadRow(input({ dailySales: [0, 0, 0], stock: 0 }), THRESHOLDS)).toBeNull()
    expect(buildSlowDeadRow(input({ dailySales: [], stock: 5 }), THRESHOLDS)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

describe('detectAnomaly', () => {
  it('ignores baselines with too little history (does not guess)', () => {
    expect(detectAnomaly(999, [10, 10], 2, 'PRODUCT_SALES_SPIKE', 'p1', 'Milk', 'up')).toBeNull()
    expect(detectAnomaly(999, [10, 0, 0, 0], 2, 'PRODUCT_SALES_SPIKE', 'p1', 'Milk', 'up')).toBeNull()
  })

  it('flags a sudden sales spike with neutral language', () => {
    const baseline = [10, 10, 10, 10, 10, 10, 10, 10, 0, 0]
    const result = detectAnomaly(42, baseline, 2, 'PRODUCT_SALES_SPIKE', 'p1', 'Milk 1L', 'up')
    expect(result).not.toBeNull()
    expect(result?.severity).toBe('critical') // ratio >> 2 × multiplier
    expect(result?.message).toMatch(/Please review\./)
    expect(result?.message).not.toMatch(/fraud|thief|employee/i)
    expect((result?.support.ratio as number) ?? 0).toBeGreaterThan(4)
  })

  it('flags a sudden sales drop', () => {
    const result = detectAnomaly(0, Array(14).fill(10), 2, 'PRODUCT_SALES_DROP', 'p1', 'Milk 1L', 'down')
    expect(result).not.toBeNull()
    expect(result?.message).toContain('lower')
  })

  it('normal day does not trigger', () => {
    const baseline = [10, 11, 9, 10, 12, 10, 9, 10, 11, 10]
    expect(detectAnomaly(11, baseline, 2, 'DISCOUNT', null, null, 'up')).toBeNull()
  })

  it('store-level discount anomaly carries null product identity', () => {
    const baseline = [500, 520, 480, 510, 495, 505, 500, 490]
    const r = detectAnomaly(3200, baseline, 2, 'DISCOUNT', null, null, 'up')
    expect(r).not.toBeNull()
    expect(r?.productId).toBeNull()
    expect(r?.support.todayValue).toBe(3200)
  })
})

describe('detectInventoryMismatch', () => {
  it('matches ledger exactly → silent', () => {
    expect(detectInventoryMismatch('Milk', 'p1', 42, 42)).toBeNull()
  })
  it('flags difference with transparent explanation', () => {
    const r = detectInventoryMismatch('Milk', 'p1', 37, 42)
    expect(r).not.toBeNull()
    expect(r?.support.difference).toBe(-5)
    expect(r?.message).toContain('-5')
    expect(r?.severity).toBe('warning') // |diff| >= 5
  })
  it('tiny drifts ignored; sub-5 differences are informational', () => {
    expect(detectInventoryMismatch('Milk', 'p1', 42.001, 42)).toBeNull() // rounds to 0
    expect(detectInventoryMismatch('Milk', 'p1', 43, 42)?.severity).toBe('info')
  })
  it('missing ledger data → null (no invented comparison)', () => {
    expect(detectInventoryMismatch('Milk', 'p1', 37, Number.NaN)).toBeNull()
  })
})