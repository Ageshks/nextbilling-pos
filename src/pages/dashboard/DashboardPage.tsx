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
import { useToast } from '../../context/ToastContext'
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
  const { notify } = useToast()
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

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const todayStart = startOfDay()
      const todayEnd = endOfDay()
      const weekAgo = daysAgo(13, todayStart)

      const [s, day, top, pm, inv, credit, recent] = await Promise.all([
        getSalesSummary(user.storeId, todayStart, todayEnd),
        getSalesByDay(user.storeId, weekAgo, todayEnd),
        getTopProducts(user.storeId, weekAgo, todayEnd, 5),
        getPaymentMethodBreakdown(user.storeId, todayStart, todayEnd),
        getInventoryValuation(user.storeId),
        listCreditCustomers(user.storeId),
        listSales({ storeId: user.storeId, max: 6 }),
      ])
      setSummary(s)
      setByDay(day)
      setTopProducts(top)
      setPayMethods(pm)
      setInventory({ low: inv.lowStockCount, out: inv.outOfStockCount })
      setCreditCustomers(credit.reduce((sum, c) => sum + c.creditBalance, 0))
      setRecentSales(
        recent
          .filter((r) => r.status !== 'CANCELLED')
          .map((r) => ({ id: r.id ?? '', invoiceNumber: r.invoiceNumber, customerName: r.customerName, total: r.total, createdAt: r.createdAt ?? Date.now() })),
      )
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load dashboard' })
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  useEffect(() => {
    void load()
  }, [load])

  if (loading || !summary) {
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

  return (
    <div className="space-y-4">
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