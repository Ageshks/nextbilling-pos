import { useCallback, useEffect, useState } from 'react'
import {
  MessageCircle,
  RefreshCw,
  PackageCheck,
  Clock,
  IndianRupee,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, StatCard } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Spinner'
import {
  listWaOrders,
  triggerOrderAction,
  waPerformanceToday,
} from '../../services/waOrderService'
import { friendlyError } from '../../utils/errors'
import { formatMoney, formatNumber, formatDateTime } from '../../utils/format'
import type {
  WaOrder,
  WaOrderItem,
  WaOrderStatus,
  WaPaymentStatus,
  WaPerformance,
} from '../../types'

// ---------------------------------------------------------------------------
// WhatsApp Orders — the POS-side management surface for orders that arrive
// through the Cloud-Function webhook pipeline. The browser NEVER mutates an
// order directly: every action goes through the `orderAction` callable, which
// re-validates the state transition server-side.
// ---------------------------------------------------------------------------

const FILTERS: Array<{ id: WaOrderStatus | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'AWAITING_PAYMENT', label: 'Awaiting payment' },
  { id: 'PAID', label: 'Paid' },
  { id: 'PACKING', label: 'Packing' },
  { id: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'CANCELLED', label: 'Cancelled' },
  { id: 'EXPIRED', label: 'Expired' },
]

function statusBadge(s: WaOrderStatus) {
  const map: Record<WaOrderStatus, { tone: 'emerald' | 'red' | 'amber' | 'sky' | 'slate' | 'violet' | 'indigo'; label: string }> = {
    PENDING: { tone: 'slate', label: 'Draft' },
    AWAITING_PAYMENT: { tone: 'amber', label: 'Awaiting payment' },
    PAID: { tone: 'indigo', label: 'Paid' },
    PACKING: { tone: 'violet', label: 'Packing' },
    READY_FOR_PICKUP: { tone: 'emerald', label: 'Ready for pickup' },
    COMPLETED: { tone: 'sky', label: 'Completed' },
    CANCELLED: { tone: 'red', label: 'Cancelled' },
    EXPIRED: { tone: 'slate', label: 'Expired' },
    REFUNDED: { tone: 'red', label: 'Refunded' },
  }
  const m = map[s] ?? { tone: 'slate' as const, label: s }
  return <Badge tone={m.tone}>{m.label}</Badge>
}

function payBadge(p: WaPaymentStatus) {
  const map: Record<WaPaymentStatus, { tone: 'emerald' | 'red' | 'amber' | 'sky' | 'slate' | 'violet' | 'indigo'; label: string }> = {
    NOT_REQUIRED: { tone: 'slate', label: 'No online payment' },
    LINK_SENT: { tone: 'amber', label: 'Link sent' },
    PAID: { tone: 'emerald', label: 'Payment received' },
    FAILED: { tone: 'red', label: 'Payment failed' },
    CASH_ON_PICKUP: { tone: 'violet', label: 'Cash on pickup' },
    REFUNDED: { tone: 'red', label: 'Refunded' },
  }
  const m = map[p] ?? { tone: 'slate' as const, label: p }
  return <Badge tone={m.tone}>{m.label}</Badge>
}

export default function WhatsAppOrdersPage() {
  const { user } = useAuth()
  const { notify } = useToast()
  const [orders, setOrders] = useState<WaOrder[]>([])
  const [perf, setPerf] = useState<WaPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<WaOrderStatus | 'ALL'>('ALL')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!user) return
      if (!silent) setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const [list, p] = await Promise.all([
          listWaOrders(user.storeId, { max: 150 }),
          waPerformanceToday(user.storeId).catch(() => null),
        ])
        setOrders(list)
        setPerf(p)
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [user],
  )

  useEffect(() => {
    void load()
  }, [load])

  /** Runs a staff action through the server-validated callable then reloads. */
  const act = useCallback(
    async (order: WaOrder, action: Parameters<typeof triggerOrderAction>[1], itemIds?: string[], okMsg?: string) => {
      setBusyOrderId(order.id ?? null)
      try {
        await triggerOrderAction(order.id ?? '', action, itemIds)
        notify({ type: 'success', message: okMsg ?? `${action.replaceAll('_', ' ').toLowerCase()} done for #${order.orderNo}.`, title: 'Order updated' })
        setOpenId((prev) => (prev === order.id && action !== 'TOGGLE_PACK_ITEM' ? null : prev))
        await load(true)
      } catch (err) {
        notify({ type: 'error', message: friendlyError(err), title: `Could not update #${order.orderNo}` })
      } finally {
        setBusyOrderId(null)
      }
    },
    [load, notify],
  )

  const filtered = filter === 'ALL' ? orders : orders.filter((o) => o.status === filter)

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <PageHeader title="WhatsApp Orders" description="Orders placed by customers over WhatsApp" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title="WhatsApp Orders"
        description="Orders customers place by messaging your WhatsApp Business number."
        actions={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={() => void load(true)}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
          <p className="mt-1 text-xs opacity-80">
            Billing, inventory and the rest of the POS are unaffected. WhatsApp ordering needs the Cloud Functions deployed
            (<code>npm run deploy:functions</code>) with WhatsApp/payment credentials configured.
          </p>
        </div>
      )}

      {/* Performance row */}
      {perf && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Orders today" value={String(perf.ordersToday)} hint={`${perf.conversionRate}% paid`} icon={<MessageCircle className="h-5 w-5" />} />
          <StatCard label="Revenue today" value={formatMoney(perf.revenueToday)} hint={`Avg ${formatMoney(perf.avgOrderValue)} / order`} icon={<IndianRupee className="h-5 w-5" />} tone="success" />
          <StatCard label="Pending payment" value={String(perf.pendingPayments)} hint="AWAITING_PAYMENT now" icon={<Clock className="h-5 w-5" />} tone="warning" />
          <StatCard label="Ready for pickup" value={String(perf.readyCount)} hint="Waiting at the store" icon={<PackageCheck className="h-5 w-5" />} tone="success" />
          <StatCard label="Completed pickups" value={String(perf.completedPickupsToday)} hint={`${perf.cancelledCount} cancelled/expired today`} icon={<CheckCircle2 className="h-5 w-5" />} />
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.id === 'ALL' ? orders.length : orders.filter((o) => o.status === f.id).length
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f.id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {f.label}
              <span className={`rounded px-1 text-xs ${filter === f.id ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Orders list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-600">
          <div className="rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
            <MessageCircle className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No WhatsApp orders here yet</p>
          <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Orders appear automatically when customers message your configured WhatsApp Business number.
          </p>
        </div>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === o.id ? null : o.id ?? null)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex min-w-[14rem] items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">#{o.orderNo}</span>
                    {statusBadge(o.status)}
                    {payBadge(o.paymentStatus)}
                  </div>
                  <div className="min-w-0 text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{o.customerName || 'Customer'}</span>
                    <span className="ml-2 text-xs text-slate-400">+{o.customerPhone}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{formatMoney(o.total)}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(o.createdAt)}</p>
                  </div>
                </button>

                {openId === o.id && (
                  <OrderDetail order={o} busy={busyOrderId === o.id} onAction={act} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function OrderDetail({
  order,
  busy,
  onAction,
}: {
  order: WaOrder
  busy: boolean
  onAction: (
    order: WaOrder,
    action:
      | 'START_PACKING'
      | 'TOGGLE_PACK_ITEM'
      | 'MARK_READY'
      | 'COMPLETE_PICKUP'
      | 'CANCEL_ORDER'
      | 'REFUND_ORDER'
      | 'MARK_PAID_CASH_ON_PICKUP'
      | 'RESEND_PAYMENT_LINK',
    itemIds?: string[],
    okMsg?: string,
  ) => Promise<void>
}) {
  const packed = new Set(order.packedItemIds ?? [])
  const allPacked = order.items.length > 0 && order.items.every((it) => packed.has(it.productId))

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        {/* Items / packing */}
        <div>
          {order.status === 'PACKING' && (
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Tick each line as it is packed — “Mark as ready” unlocks when every item is ticked.
            </p>
          )}
          <ul className="space-y-1.5">
            {order.items.map((it) => (
              <PackRow key={it.productId} item={it} order={order} packed={packed.has(it.productId)} busy={busy} onAction={onAction} />
            ))}
          </ul>

          <div className="mt-3 max-w-xs space-y-1 border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
            <Line label="Subtotal" value={formatMoney(order.subtotal)} />
            {order.discount > 0 && <Line label="Discount" value={`− ${formatMoney(order.discount)}`} />}
            {order.tax > 0 && <Line label="GST" value={formatMoney(order.tax)} />}
            <div className="flex items-center justify-between border-t border-slate-200 pt-1 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(order.total)}</span>
            </div>
          </div>
        </div>

        {/* Meta + actions */}
        <div className="space-y-3">
          <div className="rounded-lg bg-white p-2.5 text-xs dark:bg-slate-900">
            <p className="font-medium text-slate-600 dark:text-slate-300">🏪 Store pickup</p>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">Ask for order no. <b>#{order.orderNo}</b> at collection.</p>
            {typeof order.expiresAt === 'number' && order.status === 'AWAITING_PAYMENT' && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">Reservation expires {formatDateTime(order.expiresAt)}</p>
            )}
            {order.paidAt ? <p className="mt-1 text-slate-400">Paid {formatDateTime(order.paidAt)}</p> : null}
          </div>

          {(order.status === 'PACKING' || order.status === 'READY_FOR_PICKUP' || order.status === 'COMPLETED') && (
            <ol className="space-y-1 rounded-lg bg-white p-2.5 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              {[...order.timeline]
                .slice(-5)
                .reverse()
                .map((t, i) => (
                  <li key={`${t.at}-${i}`}>
                    <b>{t.status}</b> · {formatDateTime(t.at)}
                    {t.by ? ` · ${t.by}` : ''}
                  </li>
                ))}
            </ol>
          )}

          <OrderActions order={order} busy={busy} allPacked={allPacked} onAction={onAction} />
        </div>
      </div>
    </div>
  )
}

function OrderActions({
  order,
  busy,
  allPacked,
  onAction,
}: {
  order: WaOrder
  busy: boolean
  allPacked: boolean
  onAction: Parameters<typeof OrderDetail>[0]['onAction']
}) {
  const canCancel = !['COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PENDING'].includes(order.status)
  return (
    <div className="flex flex-wrap gap-1.5">
      {order.status === 'AWAITING_PAYMENT' && (
        <>
          {order.paymentStatus !== 'LINK_SENT' && (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void onAction(order, 'RESEND_PAYMENT_LINK', undefined, `Payment link re-sent for #${order.orderNo}.`)}>
              Resend payment link
            </Button>
          )}
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void onAction(order, 'MARK_PAID_CASH_ON_PICKUP', undefined, `#${order.orderNo} will be collected with cash on pickup.`)}>
            Cash on pickup
          </Button>
        </>
      )}
      {order.status === 'PAID' && (
        <Button size="sm" leftIcon={<PackageCheck className="h-4 w-4" />} loading={busy} onClick={() => void onAction(order, 'START_PACKING', undefined, `Packing started for #${order.orderNo}. Customer notified.`)}>
          Start packing
        </Button>
      )}
      {order.status === 'PACKING' && (
        <Button
          size="sm"
          leftIcon={<CheckCircle2 className="h-4 w-4" />}
          loading={busy}
          disabled={!allPacked}
          title={allPacked ? '' : 'Tick all items first'}
          onClick={() => void onAction(order, 'MARK_READY', undefined, `#${order.orderNo} is ready! Pickup message sent to customer.`)}
        >
          Mark as ready
        </Button>
      )}
      {order.status === 'READY_FOR_PICKUP' && (
        <Button size="sm" leftIcon={<ShoppingBagIcon />} loading={busy} onClick={() => void onAction(order, 'COMPLETE_PICKUP', undefined, `Pickup completed for #${order.orderNo}. Thank-you message sent.`)}>
          Complete pickup
        </Button>
      )}
      {canCancel && (
        <Button size="xs" variant="ghost" leftIcon={<XCircle className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void onAction(order, 'CANCEL_ORDER', undefined, `#${order.orderNo} cancelled and reserved stock released.`)}>
          Cancel
        </Button>
      )}
      {order.status === 'CANCELLED' && order.paymentStatus === 'PAID' && (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => void onAction(order, 'REFUND_ORDER', undefined, `Refund started for #${order.orderNo}.`)}>
          Refund payment
        </Button>
      )}
    </div>
  )
}

function PackRow({
  item,
  order,
  packed,
  busy,
  onAction,
}: {
  item: WaOrderItem
  order: WaOrder
  packed: boolean
  busy: boolean
  onAction: Parameters<typeof OrderDetail>[0]['onAction']
}) {
  return (
    <li className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${packed ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-white dark:bg-slate-900'}`}>
      <label className="flex min-w-0 flex-1 items-center gap-2">
        {order.status === 'PACKING' ? (
          <input
            type="checkbox"
            checked={packed}
            disabled={busy}
            onChange={() => void onAction(order, 'TOGGLE_PACK_ITEM', [item.productId])}
            className="h-4 w-4 shrink-0 accent-emerald-600"
            aria-label={`Mark ${item.productName} as packed`}
          />
        ) : (
          <span className={`shrink-0 ${packed ? 'text-emerald-600' : 'text-slate-300 dark:text-slate-600'}`}>☑</span>
        )}
        <span className={`min-w-0 truncate ${packed ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>
          {item.productName} × {formatNumber(item.quantity)} <span className="text-xs text-slate-400">({item.unit})</span>
        </span>
      </label>
      <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatMoney(item.subtotal)}</span>
    </li>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function ShoppingBagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M6 7V6a6 6 0 1 1 12 0v1" />
      <path d="M4 7h16l-1 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 7z" />
    </svg>
  )
}
