import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IndianRupee,
  ReceiptText,
  TrendingUp,
  Banknote,
  Smartphone,
  CreditCard,
  AlertTriangle,
  PackageX,
  Users,
  ArrowRight,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { StatCard } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { SkeletonRows, EmptyState } from '../../components/ui/Spinner'
import {
  getSalesSummary,
  getSalesByDay,
  getTopProducts,
  getPaymentMethodBreakdown,
  getInventoryValuation,
} from '../../services/reportService'
import { listSales } from '../../services/salesService'
import { listCreditCustomers } from '../../services/customerService'
import { formatMoney, startOfDay, endOfDay, daysAgo, formatDateTime, formatNumber } from '../../utils/format'
import type { SalesSummary, SalesByDay, ProductSalesRow, PaymentMethodRow } from '../../types'
import { friendlyError } from '../../utils/errors'

function MiniBarChart({ data }: { data: SalesByDay[] }) {
  const max = Math.max(...data.map((d) => d.total), 1)
  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${formatMoney(d.total)}`}>
          <div
            className="w-full rounded-t bg-emerald-500/80 transition-colors group-hover:bg-emerald-600"
            style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }}
          />
          <span className="text-[9px] text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function MethodList({ rows }: { rows: PaymentMethodRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.amount, 0) || 1
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.method}>
          <div className="flex justify-between text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">{row.method}</span>
            <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatMoney(row.amount)}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(row.amount / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const navigate = useNavigate()
  const currency = settings?.currency ?? 'INR'

  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [byDay, setByDay] = useState<SalesByDay[]>([])
  const [topProducts, setTopProducts] = useState<ProductSalesRow[]>([])
  const [payMethods, setPayMethods] = useState<PaymentMethodRow[]>([])
  const [inventory, setInventory] = useState<{ low: number; out: number } | null>(null)
  const [creditCustomers, setCreditCustomers] = useState(0)
  const [recentSales, setRecentSales] = useState<Array<{ id: string; invoiceNumber: string; customerName: string; total: number; createdAt: number }>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setLoadError(null)
    const todayStart = startOfDay()
    const todayEnd = endOfDay()
    const weekAgo = daysAgo(13, todayStart)

    // Resilient load: every widget fetches independently so one failing query
    // (flaky network, a denied read, an index hiccup) can never blank the whole
    // dashboard. Partial data still renders; failures surface a banner + retry.
    const [sRes, dayRes, topRes, pmRes, invRes, creditRes, recentRes] = await Promise.allSettled([
      getSalesSummary(user.storeId, todayStart, todayEnd),
      getSalesByDay(user.storeId, weekAgo, todayEnd),
      getTopProducts(user.storeId, weekAgo, todayEnd, 5),
      getPaymentMethodBreakdown(user.storeId, todayStart, todayEnd),
      getInventoryValuation(user.storeId),
      listCreditCustomers(user.storeId),
      listSales({ storeId: user.storeId, max: 6 }),
    ])

    if (sRes.status === 'fulfilled') setSummary(sRes.value)
    if (dayRes.status === 'fulfilled') setByDay(dayRes.value)
    if (topRes.status === 'fulfilled') setTopProducts(topRes.value)
    if (pmRes.status === 'fulfilled') setPayMethods(pmRes.value)
    if (invRes.status === 'fulfilled')
      setInventory({ low: invRes.value.lowStockCount, out: invRes.value.outOfStockCount })
    if (creditRes.status === 'fulfilled')
      setCreditCustomers(creditRes.value.reduce((sum, c) => sum + c.creditBalance, 0))
    if (recentRes.status === 'fulfilled') {
      setRecentSales(
        recentRes.value
          .filter((r) => r.status !== 'CANCELLED')
          .map((r) => ({ id: r.id ?? '', invoiceNumber: r.invoiceNumber, customerName: r.customerName, total: r.total, createdAt: r.createdAt ?? Date.now() })),
      )
    }

    const failed = [sRes, dayRes, topRes, pmRes, invRes, creditRes, recentRes].filter(
      (r) => r.status === 'rejected',
    )
    if (failed.length > 0) {
      const first = (failed[0] as PromiseRejectedResult).reason
      console.error('[DASHBOARD] failed queries:', failed.length, first)
      setLoadError(friendlyError(first))
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
          ))}
        </div>
        <SkeletonRows rows={8} />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800/60">
        <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Dashboard couldn't load</h2>
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
          {loadError ?? 'Something went wrong while loading your data.'} Billing and sales are unaffected — this only affects the summary screen.
        </p>
        <Button variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <span>Some sections couldn't load: {loadError}</span>
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Good day, {user?.name?.split(' ')[0]} 👋</h1>
        <Button variant="outline" size="sm" leftIcon={<ReceiptText className="h-4 w-4" />} onClick={() => navigate('/sales')}>
          View all sales
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Today's Sales" value={formatMoney(summary.netSales, currency)} hint={`${summary.salesCount} bills`} icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Today's Profit" value={formatMoney(summary.profit, currency)} hint="estimated" icon={<TrendingUp className="h-5 w-5" />} tone="success" />
        <StatCard label="Cash" value={formatMoney(summary.cashSales, currency)} icon={<Banknote className="h-5 w-5" />} />
        <StatCard label="UPI" value={formatMoney(summary.upiSales, currency)} icon={<Smartphone className="h-5 w-5" />} />
        <StatCard label="Card" value={formatMoney(summary.cardSales, currency)} icon={<CreditCard className="h-5 w-5" />} />
        <StatCard label="Low stock" value={String(inventory?.low ?? 0)} hint="products" icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
        <StatCard label="Out of stock" value={String(inventory?.out ?? 0)} hint="products" icon={<PackageX className="h-5 w-5" />} tone="danger" />
        <StatCard label="Customer credit" value={formatMoney(creditCustomers, currency)} hint="outstanding" icon={<Users className="h-5 w-5" />} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Sales — last 14 days</h2>
          {byDay.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sales in this period yet.</p>
          ) : (
            <MiniBarChart data={byDay} />
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Payment methods today</h2>
          {payMethods.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No payments yet.</p>
          ) : (
            <MethodList rows={payMethods} />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Top products (14 days)</h2>
            <button type="button" onClick={() => navigate('/reports')} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400">
              Reports <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {topProducts.length === 0 ? (
            <EmptyState title="No product sales yet" message="Sales will appear here as customers buy." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {topProducts.map((p) => (
                <li key={p.productId} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatNumber(p.quantity)} units · {formatMoney(p.net, currency)}
                    </p>
                  </div>
                  <Badge tone="emerald">{formatMoney(p.profit, currency)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Recent sales</h2>
          {recentSales.length === 0 ? (
            <EmptyState title="No sales yet" message="Head to the POS to ring up the first bill." actionLabel="Open POS" onAction={() => navigate('/pos')} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {recentSales.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{s.invoiceNumber}</p>
                    <p className="truncate text-xs text-slate-500">
                      {s.customerName} · {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{formatMoney(s.total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}