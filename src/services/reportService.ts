import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  type DocumentSnapshot,
} from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type {
  Sale,
  SalesSummary,
  SalesByDay,
  ProductSalesRow,
  CategorySalesRow,
  PaymentMethodRow,
  CashierSalesRow,
} from '../types'
import { round2, calculateProfit } from '../utils/calculations'
import { startOfDay } from '../utils/format'
import { listPurchases } from './purchaseService'
import { listExpenses } from './expenseService'
import { listInventory } from './inventoryService'

const PAGE = 1000

/**
 * Fetches all sales in a date range using cursor pagination. Documented cost:
 * one read per sale document, capped at `max` (default 5000) to stay within the
 * free tier. Reports are intentionally on-demand, not realtime.
 */
export async function fetchSalesRange(
  storeId: string,
  from: number,
  to: number,
  max = 5000,
): Promise<Sale[]> {
  const db = getDb()
  const sales: Sale[] = []
  let lastDoc: DocumentSnapshot | undefined
  let total = 0
  for (;;) {
    let q = query(
      collection(db, COLLECTIONS.sales),
      where('storeId', '==', storeId),
      where('createdAt', '>=', Timestamp.fromMillis(from)),
      where('createdAt', '<=', Timestamp.fromMillis(to)),
      orderBy('createdAt', 'desc'),
      limit(PAGE),
    )
    if (lastDoc) q = query(q, startAfter(lastDoc))
    const snap = await getDocs(q)
    if (snap.empty) break
    for (const d of snap.docs) sales.push({ ...(d.data() as object), id: d.id } as Sale)
    total += snap.docs.length
    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < PAGE || total >= max) break
  }
  return sales
}

export async function getSalesSummary(
  storeId: string,
  from: number,
  to: number,
): Promise<SalesSummary> {
  const sales = await fetchSalesRange(storeId, from, to)
  const active = sales.filter((s) => s.status !== 'CANCELLED')
  const summary: SalesSummary = {
    salesCount: active.length,
    grossSales: 0,
    discounts: 0,
    netSales: 0,
    costOfGoods: 0,
    profit: 0,
    cashSales: 0,
    upiSales: 0,
    cardSales: 0,
    otherSales: 0,
    creditSales: 0,
    refundAmount: 0,
    itemsSold: 0,
  }
  for (const s of active) {
    const profit = calculateProfit(s)
    summary.grossSales = round2(summary.grossSales + profit.grossSales)
    summary.discounts = round2(summary.discounts + profit.discounts)
    summary.netSales = round2(summary.netSales + profit.netSales)
    summary.costOfGoods = round2(summary.costOfGoods + profit.cogs)
    summary.profit = round2(summary.profit + profit.grossProfit)
    summary.refundAmount = round2(summary.refundAmount + (s.returnInfo?.refundTotal ?? 0))
    summary.itemsSold += round2(s.items.reduce((sum, it) => sum + it.quantity, 0))
    for (const p of s.payments ?? []) {
      if (p.method === 'CASH') summary.cashSales = round2(summary.cashSales + p.amount)
      else if (p.method === 'UPI') summary.upiSales = round2(summary.upiSales + p.amount)
      else if (p.method === 'CARD') summary.cardSales = round2(summary.cardSales + p.amount)
      else if (p.method === 'CREDIT') summary.creditSales = round2(summary.creditSales + p.amount)
      else summary.otherSales = round2(summary.otherSales + p.amount)
    }
  }
  return summary
}

export async function getSalesByDay(
  storeId: string,
  from: number,
  to: number,
): Promise<SalesByDay[]> {
  const sales = await fetchSalesRange(storeId, from, to)
  const byDay = new Map<string, SalesByDay>()
  for (const s of sales) {
    if (s.status === 'CANCELLED') continue
    const day = new Date(s.createdAt ?? Date.now())
    const key = startOfDay(day.getTime()).toString()
    const label = day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    const existing = byDay.get(key) ?? { day: key, label, count: 0, total: 0, profit: 0 }
    existing.count += 1
    existing.total = round2(existing.total + s.total)
    existing.profit = round2(existing.profit + calculateProfit(s).grossProfit)
    byDay.set(key, existing)
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
}

export async function getProductSales(
  storeId: string,
  from: number,
  to: number,
): Promise<ProductSalesRow[]> {
  const sales = await fetchSalesRange(storeId, from, to)
  const byProduct = new Map<string, ProductSalesRow>()
  for (const s of sales) {
    if (s.status === 'CANCELLED') continue
    for (const it of s.items) {
      const existing = byProduct.get(it.productId) ?? {
        productId: it.productId,
        name: it.name,
        quantity: 0,
        gross: 0,
        discount: 0,
        net: 0,
        cogs: 0,
        profit: 0,
      }
      const gross = round2(it.sellingPrice * it.quantity)
      existing.quantity = round2(existing.quantity + it.quantity)
      existing.gross = round2(existing.gross + gross)
      existing.discount = round2(existing.discount + (it.discount ?? 0))
      existing.net = round2(existing.net + gross - (it.discount ?? 0))
      existing.cogs = round2(existing.cogs + it.purchasePrice * it.quantity)
      existing.profit = round2(existing.profit + gross - (it.discount ?? 0) - it.purchasePrice * it.quantity)
      byProduct.set(it.productId, existing)
    }
  }
  return Array.from(byProduct.values()).sort((a, b) => b.net - a.net)
}

export async function getCategorySales(
  storeId: string,
  from: number,
  to: number,
): Promise<CategorySalesRow[]> {
  const productSales = await getProductSales(storeId, from, to)
  const byCategory = new Map<string, CategorySalesRow>()
  for (const row of productSales) {
    const existing = byCategory.get(row.name) ?? { categoryName: row.name, quantity: 0, net: 0 }
    existing.quantity = round2(existing.quantity + row.quantity)
    existing.net = round2(existing.net + row.net)
    byCategory.set(row.name, existing)
  }
  return Array.from(byCategory.values()).sort((a, b) => b.net - a.net)
}

export async function getPaymentMethodBreakdown(
  storeId: string,
  from: number,
  to: number,
): Promise<PaymentMethodRow[]> {
  const sales = await fetchSalesRange(storeId, from, to)
  const byMethod = new Map<string, PaymentMethodRow>()
  for (const s of sales) {
    if (s.status === 'CANCELLED') continue
    for (const p of s.payments ?? []) {
      const existing = byMethod.get(p.method) ?? { method: p.method, amount: 0, count: 0 }
      existing.amount = round2(existing.amount + p.amount)
      existing.count += 1
      byMethod.set(p.method, existing)
    }
  }
  return Array.from(byMethod.values())
}

export async function getCashierSales(
  storeId: string,
  from: number,
  to: number,
): Promise<CashierSalesRow[]> {
  const sales = await fetchSalesRange(storeId, from, to)
  const byCashier = new Map<string, CashierSalesRow>()
  for (const s of sales) {
    if (s.status === 'CANCELLED') continue
    const existing = byCashier.get(s.cashierId) ?? {
      cashierId: s.cashierId,
      cashierName: s.cashierName || 'Unknown',
      count: 0,
      net: 0,
    }
    existing.count += 1
    existing.net = round2(existing.net + s.total)
    byCashier.set(s.cashierId, existing)
  }
  return Array.from(byCashier.values()).sort((a, b) => b.net - a.net)
}

export async function getExpensesSummary(
  storeId: string,
  from: number,
  to: number,
): Promise<{ total: number; byCategory: Array<{ category: string; amount: number }> }> {
  const expenses = await listExpenses({ storeId, from, to })
  const byCategory = new Map<string, number>()
  let total = 0
  for (const e of expenses) {
    total = round2(total + e.amount)
    byCategory.set(e.category, round2((byCategory.get(e.category) ?? 0) + e.amount))
  }
  return {
    total,
    byCategory: Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
  }
}

export async function getInventoryValuation(storeId: string): Promise<{
  totalValue: number
  itemCount: number
  lowStockCount: number
  outOfStockCount: number
}> {
  const inventory = await listInventory(storeId)
  return {
    totalValue: round2(inventory.reduce((sum, i) => sum + i.stockValue, 0)),
    itemCount: inventory.length,
    lowStockCount: inventory.filter((i) => i.status === 'LOW_STOCK').length,
    outOfStockCount: inventory.filter((i) => i.status === 'OUT_OF_STOCK').length,
  }
}

export async function getPurchaseTotals(
  storeId: string,
  from: number,
  to: number,
): Promise<{ total: number; count: number }> {
  const purchases = await listPurchases({ storeId, from, to })
  return {
    total: round2(purchases.reduce((sum, p) => sum + p.total, 0)),
    count: purchases.length,
  }
}

export async function getTopProducts(
  storeId: string,
  from: number,
  to: number,
  n = 5,
): Promise<ProductSalesRow[]> {
  const rows = await getProductSales(storeId, from, to)
  return rows.slice(0, n)
}

export async function getTopCategories(
  storeId: string,
  from: number,
  to: number,
  n = 5,
): Promise<CategorySalesRow[]> {
  const rows = await getCategorySales(storeId, from, to)
  return rows.slice(0, n)
}