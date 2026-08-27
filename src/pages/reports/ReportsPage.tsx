import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { StatCard } from '../../components/ui/Card'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import { Badge } from '../../components/ui/Badge'
import {
  getSalesSummary,
  getTopProducts,
  getTopCategories,
  getPaymentMethodBreakdown,
  getCashierSales,
  getExpensesSummary,
  getInventoryValuation,
} from '../../services/reportService'
import type {
  SalesSummary,
  ProductSalesRow,
  CategorySalesRow,
  PaymentMethodRow,
  CashierSalesRow,
} from '../../types/report'
import { formatMoney, formatNumber, startOfDay, endOfDay, daysAgo, startOfMonth, fromDateInputValue, toDateInputValue } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import { downloadCsv } from '../../utils/csv'

type Period = 'today' | '7d' | '30d' | 'month' | 'custom'

function periodRange(period: Period, customFrom: string, customTo: string): { from: number; to: number } | null {
  if (period === 'today') return { from: startOfDay(), to: endOfDay() }
  if (period === '7d') return { from: daysAgo(6, startOfDay()), to: endOfDay() }
  if (period === '30d') return { from: daysAgo(29, startOfDay()), to: endOfDay() }
  if (period === 'month') return { from: startOfMonth(), to: endOfDay() }
  if (!customFrom || !customTo) return null
  return { from: fromDateInputValue(customFrom), to: fromDateInputValue(customTo) + 86399999 }
}

export default function ReportsPage() {
  const { user, can } = useAuth()
  const { settings } = useStore()
  const { notify } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [period, setPeriod] = useState<Period>('30d')
  const [customFrom, setCustomFrom] = useState(toDateInputValue(daysAgo(29)))
  const [customTo, setCustomTo] = useState(toDateInputValue(Date.now()))
  const [loading, setLoading] = useState(true)

  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [topProducts, setTopProducts] = useState<ProductSalesRow[]>([])
  const [topCategories, setTopCategories] = useState<CategorySalesRow[]>([])
  const [payMethods, setPayMethods] = useState<PaymentMethodRow[]>([])
  const [cashiers, setCashiers] = useState<CashierSalesRow[]>([])
  const [expensesTotal, setExpensesTotal] = useState(0)
  const [inventory, setInventory] = useState<{ totalValue: number; itemCount: number; lowStockCount: number; outOfStockCount: number } | null>(null)

  const load = useCallback(async () => {
    if (!user || !can('reports')) return
    const range = periodRange(period, customFrom, customTo)
    if (!range) {
      notify({ type: 'warning', message: 'Pick a from and to date.', title: 'Custom range' })
      return
    }
    setLoading(true)
    try {
      const [s, tp, tc, pm, cs, ex, inv] = await Promise.all([
        getSalesSummary(user.storeId, range.from, range.to),
        getTopProducts(user.storeId, range.from, range.to, 10),
        getTopCategories(user.storeId, range.from, range.to, 8),
        getPaymentMethodBreakdown(user.storeId, range.from, range.to),
        getCashierSales(user.storeId, range.from, range.to),
        getExpensesSummary(user.storeId, range.from, range.to),
        getInventoryValuation(user.storeId),
      ])
      setSummary(s)
      setTopProducts(tp)
      setTopCategories(tc)
      setPayMethods(pm)
      setCashiers(cs)
      setExpensesTotal(ex.total)
      setInventory(inv)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not build report' })
    } finally {
      setLoading(false)
    }
  }, [user, can, period, customFrom, customTo, notify])

  useEffect(() => {
    void load()
  }, [load])

  const netProfit = useMemo(() => round2((summary?.profit ?? 0) - expensesTotal), [summary, expensesTotal])

  const exportSummary = () => {
    if (!summary) return
    downloadCsv(`report-${period}-${Date.now()}.csv`, [
      { metric: 'Bills', value: summary.salesCount },
      { metric: 'Gross sales', value: summary.grossSales },
      { metric: 'Discounts', value: summary.discounts },
      { metric: 'Net sales', value: summary.netSales },
      { metric: 'COGS', value: summary.costOfGoods },
      { metric: 'Gross profit', value: summary.profit },
      { metric: 'Expenses', value: expensesTotal },
      { metric: 'Net profit (after expenses)', value: netProfit },
      { metric: 'Refunds', value: summary.refundAmount },
      { metric: 'Items sold', value: summary.itemsSold },
      { metric: 'Credit sales', value: summary.creditSales },
      { metric: 'Stock value', value: inventory?.totalValue ?? 0 },
    ])
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="On-demand business reports — reads sales for the chosen window."
        actions={
          <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={exportSummary} disabled={!summary}>
            Export summary CSV
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="custom">Custom range</option>
        </Select>
        {period === 'custom' && (
          <>
            <Input label="From" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <Input label="To" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
      </div>

      {loading || !summary ? (
        <Spinner label="Crunching numbers…" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Net sales" value={formatMoney(summary.netSales, currency)} hint={`${summary.salesCount} bills`} />
            <StatCard label="Gross profit" value={formatMoney(summary.profit, currency)} hint={`COGS ${formatMoney(summary.costOfGoods, currency)}`} tone="success" />
            <StatCard label="Expenses" value={formatMoney(expensesTotal, currency)} />
            <StatCard label="Net profit" value={formatMoney(netProfit, currency)} hint="after expenses" tone={netProfit >= 0 ? 'success' : 'danger'} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Cash collected" value={formatMoney(summary.cashSales, currency)} />
            <StatCard label="UPI collected" value={formatMoney(summary.upiSales, currency)} />
            <StatCard label="Credit given" value={formatMoney(summary.creditSales, currency)} tone="warning" />
            <StatCard label="Refunds" value={formatMoney(summary.refundAmount, currency)} tone="danger" />
          </div>

                    <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Top products</h2>
            <DataTable<ProductSalesRow>
              rowKey={(r) => r.productId}
              rows={topProducts}
              emptyState={<EmptyState title="No product sales in this period" />}
              columns={[
                { key: 'name', header: 'Product', render: (r) => <span className="font-medium">{r.name}</span> },
                { key: 'qty', header: 'Qty sold', className: 'tabular-nums text-right', headerClassName: 'text-right', render: (r) => formatNumber(r.quantity) },
                { key: 'net', header: 'Net', className: 'tabular-nums text-right', headerClassName: 'text-right', render: (r) => formatMoney(r.net, currency) },
                { key: 'profit', header: 'Profit', className: 'tabular-nums text-right', headerClassName: 'text-right',
                  render: (r) => <Badge tone={r.profit >= 0 ? 'emerald' : 'red'}>{formatMoney(r.profit, currency)}</Badge> },
              ]}
            />
          </section>

                    <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Payment methods</h2>
              {payMethods.length === 0 ? (
                <EmptyState title="No payments in this period" />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white p-2 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/60">
                  {payMethods.map((m) => {
                    const total = payMethods.reduce((sum, x) => sum + x.amount, 0) || 1
                    return (
                      <li key={m.method} className="py-2">
                        <div className="flex justify-between text-sm">
                          <span>{m.method} · {m.count}×</span>
                          <span className="tabular-nums">{formatMoney(m.amount, currency)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(m.amount / total) * 100}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Top categories</h2>
              {topCategories.length === 0 ? (
                <EmptyState title="No category data" />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/60">
                  {topCategories.map((c) => (
                    <li key={c.categoryName} className="flex justify-between py-2 text-sm">
                      <span>{c.categoryName || 'Uncategorised'}</span>
                      <span className="tabular-nums">{formatMoney(c.net, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Cashier performance</h2>
              {cashiers.length === 0 ? (
                <EmptyState title="No cashier sales in this period" />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-3 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800/60">
                  {cashiers.map((c) => (
                    <li key={c.cashierId} className="flex justify-between py-2 text-sm">
                      <span>{c.cashierName}</span>
                      <span className="tabular-nums">
                        {c.count} bills · {formatMoney(c.net, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Inventory snapshot (current)</h2>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Stock value" value={formatMoney(inventory?.totalValue ?? 0, currency)} hint={`${inventory?.itemCount ?? 0} products`} />
                <StatCard label="Low / out of stock" value={`${inventory?.lowStockCount ?? 0} / ${inventory?.outOfStockCount ?? 0}`} tone="warning" />
              </div>
            </section>
          </div>

          <p className="text-xs text-slate-400">
            Reports are computed on demand from the sales collection. For very large histories they may take a few seconds and consume one read per sale document.
          </p>
        </div>
      )}
    </div>
  )
}