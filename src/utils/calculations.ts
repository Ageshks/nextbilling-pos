// Pure money/calculation helpers.
// All money math is done in rupees with 2-decimal rounding to avoid float drift.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function clampQty(n: number, maxDecimals = 3): number {
  const factor = 10 ** maxDecimals
  return Math.round(n * factor) / factor
}

export interface CartItemDraft {
  unitPrice: number
  quantity: number
  gstRate: number
  discount?: number // item-level discount amount for this line
}

export interface TotalsResult {
  subtotal: number
  itemDiscount: number
  billDiscount: number
  discountTotal: number
  taxableAmount: number
  gstAmount: number
  gstIncluded: boolean
  total: number
}

export interface TaxSplit {
  cgst: number
  sgst: number
}

/**
 * Compute the full totals of a cart.
 *
 * Pricing model assumptions (documented):
 * - `unitPrice` is the price the customer pays for one unit.
 * - When `gstIncluded` is true (retail default) the unit price already
 *   contains GST; `gstAmount` is a notional split used for reporting and
 *   is NOT added to the grand total.
 * - When `gstIncluded` is false, GST is added on top of the discounted
 *   taxable base.
 * - Bill-level discount is applied proportionally across items before tax.
 */
export function calculateTotals(
  items: CartItemDraft[],
  billDiscount: number, // amount in currency
  gstIncluded = true,
): TotalsResult {
  let subtotal = 0
  let itemDiscount = 0

  const adjustedLines = items.map((it) => {
    const lineSubtotal = round2(it.unitPrice * it.quantity)
    const lineDiscount = round2(Math.min(it.discount ?? 0, lineSubtotal))
    const adjusted = round2(lineSubtotal - lineDiscount)
    subtotal = round2(subtotal + lineSubtotal)
    itemDiscount = round2(itemDiscount + lineDiscount)
    return { ...it, lineSubtotal, lineDiscount, adjusted }
  })

  const billDiscountAmt = round2(Math.min(Math.max(billDiscount, 0), subtotal - itemDiscount))
  const base = round2(subtotal - itemDiscount)
  let taxableAmount = 0
  let gstAmount = 0

  adjustedLines.forEach((line) => {
    // Proportional allocation of the bill-level discount across lines.
    const alloc = base > 0 ? line.adjusted / base : 0
    const taxable = round2(line.adjusted - billDiscountAmt * alloc * (base > 0 ? 1 : 0))
    const gst = gstIncluded
      ? round2((taxable * line.gstRate) / (100 + line.gstRate))
      : round2((taxable * line.gstRate) / 100)
    taxableAmount = round2(taxableAmount + taxable)
    gstAmount = round2(gstAmount + gst)
  })

  const discountTotal = round2(itemDiscount + billDiscountAmt)
  const total = round2(
    gstIncluded ? base - billDiscountAmt : taxableAmount + gstAmount,
  )

  return {
    subtotal,
    itemDiscount,
    billDiscount: billDiscountAmt,
    discountTotal,
    taxableAmount,
    gstAmount,
    gstIncluded,
    total,
  }
}

export function calculateSubtotal(items: CartItemDraft[]): number {
  return round2(items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0))
}

export function calculateBillDiscountPercent(discount: number, subtotal: number): number {
  if (subtotal <= 0) return 0
  return Math.min(100, round2((discount / subtotal) * 100))
}

export function calculateChange(received: number, total: number): number {
  return round2(Math.max(0, received - total))
}

export function calculateTax(taxableAmount: number, gstRate: number, gstIncluded = true): number {
  if (gstIncluded) return round2((taxableAmount * gstRate) / (100 + gstRate))
  return round2((taxableAmount * gstRate) / 100)
}

/** CGST/SGST split for an Indian GST invoice (halves per item/line). */
export function splitCgstSgst(gstAmount: number): TaxSplit {
  const half = round2(gstAmount / 2)
  return { cgst: half, sgst: round2(gstAmount - half) }
}

export function calculateStockAfterSale(stock: number, quantity: number): number {
  return round2(stock - quantity)
}
export function calculateStockAfterPurchase(stock: number, quantity: number): number {
  return round2(stock + quantity)
}
export function calculateStockAfterReturn(stock: number, quantity: number): number {
  return round2(stock + quantity)
}

export function calculateReturnableQuantity(purchasedQty: number, returnedQty: number): number {
  return round2(Math.max(0, purchasedQty - returnedQty))
}

export interface ProfitBreakdown {
  grossSales: number
  discounts: number
  netSales: number
  cogs: number
  grossProfit: number
}

/**
 * Estimated profit. Uses purchasePrice stored on the sale line at the time of
 * sale. This is an estimate — it does not account for averaged/weighted COGS.
 */
export function calculateProfit(sale: {
  items: Array<{ quantity: number; sellingPrice: number; purchasePrice: number; discount: number }>
  discount: number
}): ProfitBreakdown {
  let grossSales = 0
  let cogs = 0
  let itemDiscounts = 0
  for (const item of sale.items) {
    grossSales = round2(grossSales + item.sellingPrice * item.quantity)
    cogs = round2(cogs + item.purchasePrice * item.quantity)
    itemDiscounts = round2(itemDiscounts + (item.discount ?? 0))
  }
  const discounts = round2(itemDiscounts + (sale.discount ?? 0))
  const netSales = round2(grossSales - discounts)
  const grossProfit = round2(netSales - cogs)
  return { grossSales, discounts, netSales, cogs, grossProfit }
}