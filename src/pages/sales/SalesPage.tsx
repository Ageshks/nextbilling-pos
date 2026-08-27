import { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, Undo2, Ban, Download } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge, statusTone } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import { ReceiptPrintView } from '../../components/billing/ReceiptPrint'
import {
  listSales,
  processReturn,
  cancelSale,
  type SaleReturnItemInput,
} from '../../services/salesService'
import { formatMoney, formatDateTime, startOfDay, endOfDay, daysAgo } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import { downloadCsv } from '../../utils/csv'
import { PAYMENT_METHODS } from '../../types'
import type { Sale } from '../../types'

type Preset = 'today' | '7d' | '30d' | 'all'

function presetRange(preset: Preset): { from?: number; to?: number } {
  if (preset === 'today') return { from: startOfDay(), to: endOfDay() }
  if (preset === '7d') return { from: daysAgo(6, startOfDay()), to: endOfDay() }
  if (preset === '30d') return { from: daysAgo(29, startOfDay()), to: endOfDay() }
  return {}
}

export default function SalesPage() {
  const { user, can } = useAuth()
  const { settings } = useStore()
  const { notify, success, error } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [preset, setPreset] = useState<Preset>('7d')
  const [method, setMethod] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchText, setSearchText] = useState('')
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)

  const [detail, setDetail] = useState<Sale | null>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [returnQty, setReturnQty] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [returning, setReturning] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const range = presetRange(preset)
      const rows = await listSales({
        storeId: user.storeId,
        from: range.from,
        to: range.to,
        paymentMethod: method as never,
        search: searchText.trim() || undefined,
        max: 200,
      })
      setSales(rows)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load sales' })
    } finally {
      setLoading(false)
    }
  }, [user, preset, method, searchText, notify])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (statusFilter === 'all' ? sales : sales.filter((s) => s.status === statusFilter)),
    [sales, statusFilter],
  )

        const exportCsv = () => {
    downloadCsv(
      `sales-${new Date().toISOString().slice(0, 10)}.csv`,
      visible.map((s) => ({
        invoice: s.invoiceNumber,
        date: formatDateTime(s.createdAt),
        customer: s.customerName,
        items: s.items.length,
        total: s.total,
        credit: s.creditAmount,
        status: s.status,
      })),
    )
  }

  const submitReturn = async () => {
    if (!user || !detail) return
    const items: SaleReturnItemInput[] = []
    for (const item of detail.items) {
      const qty = Math.floor(returnQty[item.productId] ?? 0)
      if (qty > 0) {
        items.push({
          productId: item.productId,
          name: item.name,
          quantity: Math.min(qty, item.quantity),
          sellingPrice: item.sellingPrice,
          purchasePrice: item.purchasePrice,
        })
      }
    }
    if (items.length === 0) {
      error('Enter at least one quantity to return', 'Nothing to return')
      return
    }
    setReturning(true)
    try {
      await processReturn({
        storeId: user.storeId,
        saleId: detail.id ?? '',
        invoiceNumber: detail.invoiceNumber,
        customerId: detail.customerId,
        cashierId: user.uid,
        cashierName: user.name,
        items,
        refundAmount: round2(items.reduce((sum, it) => sum + it.sellingPrice * it.quantity, 0)),
        reason: returnReason.trim() || 'Customer return',
      })
      success('Return processed and stock restored', 'Return complete')
      setDetail(null)
      void load()
    } catch (err) {
      error(friendlyError(err), 'Return failed')
    } finally {
      setReturning(false)
    }
  }

  const submitVoid = async () => {
    if (!user || !detail) return
    setVoiding(true)
    try {
      await cancelSale(detail.id ?? '', user.storeId, user.uid, voidReason.trim() || 'Voided at counter')
      success(`${detail.invoiceNumber} voided and stock restored`, 'Sale cancelled')
      setVoidOpen(false)
      setVoidReason('')
      setDetail(null)
      void load()
    } catch (err) {
      error(friendlyError(err), 'Cancel failed')
    } finally {
      setVoiding(false)
    }
  }

    const netTotal = round2(
    visible.filter((s) => s.status !== 'CANCELLED').reduce((sum, s) => sum + s.total - (s.returnInfo?.refundTotal ?? 0), 0),
  )

  return (
    <div>
      <PageHeader
        title="Sales"
        description={`${visible.length} bills · net ${formatMoney(netTotal, currency)}`}
        actions={
          <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </Select>
        <Select label="Payment" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="all">All methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </Select>
        <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="COMPLETED">Completed</option>
          <option value="PARTIALLY_RETURNED">Partially returned</option>
          <option value="RETURNED">Returned</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <div className="sm:col-span-2">
          <Input
            label="Search"
            placeholder="Invoice no. or customer name…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading sales…" />
      ) : (
        <DataTable<Sale>
          rowKey={(s) => s.id ?? s.invoiceNumber}
          rows={visible}
          onRowClick={(s) => setDetail(s)}
          emptyState={<EmptyState title="No sales found" message="Try widening the period or clearing filters." />}
          columns={[
            { key: 'invoice', header: 'Invoice', render: (s) => <span className="font-medium tabular-nums">{s.invoiceNumber}</span> },
            { key: 'date', header: 'Date', render: (s) => formatDateTime(s.createdAt) },
            { key: 'customer', header: 'Customer', render: (s) => s.customerName },
            { key: 'items', header: 'Items', render: (s) => String(s.items.length), className: 'tabular-nums' },
            {
              key: 'total',
              header: 'Total',
              className: 'tabular-nums text-right',
              headerClassName: 'text-right',
              render: (s) => <span className="font-semibold">{formatMoney(s.total, currency)}</span>,
            },
            { key: 'status', header: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status.replaceAll('_', ' ')}</Badge> },
          ]}
        />
      )}

            {/* Detail / return modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={`Invoice ${detail?.invoiceNumber ?? ''}`}
        size="lg"
        footer={
          detail && detail.status !== 'CANCELLED' ? (
            <>
              <Button variant="outline" leftIcon={<Printer className="h-4 w-4" />} onClick={() => setReceipt(detail)}>
                Receipt
              </Button>
              {can('canCancelSales') && (
                <Button variant="danger" leftIcon={<Ban className="h-4 w-4" />} onClick={() => setVoidOpen(true)} disabled={voiding}>
                  Void sale
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span>{formatDateTime(detail.createdAt)}</span>
              <span>{detail.customerName}</span>
              <span>Cashier: {detail.cashierName}</span>
              <Badge tone={statusTone(detail.status)}>{detail.status.replaceAll('_', ' ')}</Badge>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {detail.items.map((it) => (
                    <tr key={it.productId}>
                      <td className="px-3 py-2">{it.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(it.sellingPrice, currency)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={it.quantity}
                          inputMode="numeric"
                          className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          value={String(returnQty[it.productId] ?? '')}
                          onChange={(e) =>
                            setReturnQty((prev) => ({ ...prev, [it.productId]: Math.min(Number(e.target.value) || 0, it.quantity) }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-700/40">
              <span className="text-slate-600 dark:text-slate-300">Total</span>
              <span className="font-bold tabular-nums">{formatMoney(detail.total, currency)}</span>
            </div>
            <Input label="Return reason (optional)" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Damaged packaging…" />
            <div className="flex justify-end">
              <Button leftIcon={<Undo2 className="h-4 w-4" />} onClick={submitReturn} loading={returning}>
                Process return
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm void */}
      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title="Void this sale?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>Back</Button>
            <Button variant="danger" loading={voiding} onClick={submitVoid}>Yes, void it</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            The bill is marked cancelled, stock is restored and any credit is reversed. This cannot be undone.
          </p>
          <Input label="Reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Wrong entry…" autoFocus />
        </div>
      </Modal>

      {/* Reprint receipt */}
      {receipt && settings && (
        <ReceiptPrintView
          data={{ sale: receipt, settings, cashierName: receipt.cashierName }}
                    onClose={() => setReceipt(null)}
        />
      )}
    </div>
  )
}