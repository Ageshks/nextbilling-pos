import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Search, RotateCcw, CheckCircle2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge, statusTone } from '../../components/ui/Badge'
import {
  findSaleByInvoice,
  listSales,
  listReturnsForSale,
  processReturn,
  type SaleReturnItemInput,
} from '../../services/salesService'
import { friendlyError } from '../../utils/errors'
import { formatMoney, formatDateTime } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import type { Sale } from '../../types'

interface ReturnLine {
  productId: string
  name: string
  unit: string
  sold: number
  remaining: number
  returnQty: number
  unitRefund: number
  refund: number
}

/**
 * POS sales-return dialog: find a bill by invoice number (scanner-friendly),
 * pick items/quantities still eligible for return, and refund at the billed
 * rate. processReturn restores stock, writes the RETURN ledger entries and
 * marks the original sale — the refund is already reflected in the open cash
 * shift's expected-cash math (cashService reads returnInfo.refundTotal).
 */
export function ReturnModal({
  open,
  onClose,
  storeId,
  currency,
  cashierId,
  cashierName,
  onReturned,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  currency: string
  cashierId: string
  cashierName: string
  onReturned?: (refundAmount: number) => void
}) {
  const [invoiceInput, setInvoiceInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sale, setSale] = useState<Sale | null>(null)
  const [recent, setRecent] = useState<Sale[]>([])
  const [returnedMap, setReturnedMap] = useState<Record<string, number>>({})
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ refundAmount: number } | null>(null)

  const loadSale = useCallback(
    async (invoiceNumber: string) => {
      const inv = invoiceNumber.trim()
      if (!inv || !storeId) return
      setSearching(true)
      setSearchError(null)
      try {
        const found = await findSaleByInvoice(storeId, inv)
        if (!found) {
          setSearchError(`No bill found with number "${inv}".`)
          setSale(null)
          return
        }
        if (found.status === 'CANCELLED') {
          setSearchError('This bill was cancelled — returns are not possible on cancelled bills.')
          setSale(null)
          return
        }
        const prior = await listReturnsForSale(storeId, found.id ?? '')
        const map: Record<string, number> = {}
        for (const r of prior) for (const it of r.items) map[it.productId] = (map[it.productId] ?? 0) + it.quantity
        setReturnedMap(map)
        setQty({})
        setSale(found)
      } catch (err) {
        setSearchError(friendlyError(err))
        setSale(null)
      } finally {
        setSearching(false)
      }
    },
    [storeId],
  )

  // Fresh state + recent bills each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setInvoiceInput('')
    setSearchError(null)
    setSale(null)
    setReturnedMap({})
    setQty({})
    setReason('')
    setSubmitting(false)
    setDone(null)
    if (!storeId) return
    let alive = true
    void listSales({ storeId })
      .then((rows) => {
        if (alive) setRecent(rows.slice(0, 6))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [open, storeId])

  const lines = useMemo<ReturnLine[]>(() => {
    if (!sale) return []
    return (sale.items ?? []).map((it) => {
      const sold = it.quantity || 0
      const already = returnedMap[it.productId] ?? 0
      const remaining = Math.max(0, round2(sold - already))
      const q = Math.min(Math.max(0, qty[it.productId] ?? 0), remaining)
      const unitRefund = sold > 0 ? round2(it.lineTotal / sold) : 0
      return {
        productId: it.productId,
        name: it.name,
        unit: it.unit,
        sold,
        remaining,
        returnQty: q,
        unitRefund,
        refund: round2(unitRefund * q),
      }
    })
  }, [sale, qty, returnedMap])

  const refundTotal = useMemo(() => round2(lines.reduce((s, l) => s + l.refund, 0)), [lines])
  const returnCount = useMemo(() => round2(lines.reduce((s, l) => s + l.returnQty, 0)), [lines])
  const anyEligible = lines.some((l) => l.remaining > 0)

  const submit = async () => {
    if (!sale || !storeId) return
    const items: SaleReturnItemInput[] = lines
      .filter((l) => l.returnQty > 0)
      .map((l) => ({
        productId: l.productId,
        name: l.name,
        // Effective per-unit refund (billed line total ÷ qty sold) so the
        // return document's per-line amounts match the pro-rata refund.
        sellingPrice: l.unitRefund,
        purchasePrice: 0,
        quantity: l.returnQty,
      }))
    if (items.length === 0) return
    setSubmitting(true)
    try {
      await processReturn({
        storeId,
        saleId: sale.id ?? '',
        invoiceNumber: sale.invoiceNumber,
        customerId: sale.customerId,
        cashierId,
        cashierName,
        items,
        refundAmount: refundTotal,
        reason: reason.trim(),
      })
      setDone({ refundAmount: refundTotal })
      onReturned?.(refundTotal)
    } catch (err) {
      setSearchError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const findSubmit = (e: FormEvent) => {
    e.preventDefault()
    void loadSale(invoiceInput)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Return items (customer refund)"
      size="xl"
      footer={
        done ? (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : sale ? (
          <>
            <Button variant="outline" onClick={() => { setSale(null); setSearchError(null) }}>
              Back to search
            </Button>
            <Button loading={submitting} disabled={returnCount <= 0} onClick={() => void submit()}>
              <RotateCcw className="h-4 w-4" />
              Return items · {formatMoney(refundTotal, currency)}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {done ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-600" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Return saved</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Refund <span className="font-semibold tabular-nums">{formatMoney(done.refundAmount, currency)}</span> · stock restored · recorded in the cash shift.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => {
              setSale(null)
              setDone(null)
              setInvoiceInput('')
            }}
          >
            Process another return
          </Button>
        </div>
      ) : !sale ? (
        <div className="space-y-4">
          <form onSubmit={findSubmit} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="Bill / invoice number"
                placeholder="e.g. INV-2026-000123 — scan or type"
                value={invoiceInput}
                onChange={(e) => setInvoiceInput(e.target.value)}
                autoFocus
                aria-label="Bill / invoice number"
                error={searchError ?? undefined}
              />
            </div>
            <Button type="submit" loading={searching} disabled={!invoiceInput.trim()}>
              <Search className="h-4 w-4" />
              Find bill
            </Button>
          </form>

          {recent.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Recent bills</p>
              <div className="flex flex-wrap gap-2">
                {recent.map((b) => (
                  <button
                    key={b.id ?? b.invoiceNumber}
                    type="button"
                    onClick={() => {
                      setInvoiceInput(b.invoiceNumber)
                      void loadSale(b.invoiceNumber)
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-left text-xs transition-colors hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10"
                  >
                    <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{b.invoiceNumber}</span>
                    <span className="ml-2 tabular-nums text-slate-500 dark:text-slate-400">{formatMoney(b.total, currency)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <div>
              <p className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{sale.invoiceNumber}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatDateTime(sale.createdAt ?? undefined)} · {sale.customerName || 'Walk-in'} · billed {formatMoney(sale.total, currency)}
              </p>
            </div>
            <Badge tone={statusTone(sale.status)}>{sale.status.replaceAll('_', ' ')}</Badge>
          </div>

          {!anyEligible ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Every item on this bill has already been returned. Nothing left to refund.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2 text-right">Already returned</th>
                    <th className="px-3 py-2 text-right">Left</th>
                    <th className="px-3 py-2 text-right">Return qty</th>
                    <th className="px-3 py-2 text-right">Refund</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {lines.map((l) => (
                    <tr key={l.productId} className={l.remaining <= 0 ? 'opacity-50' : ''}>
                      <td className="px-3 py-2">
                        <p className="max-w-[16rem] truncate font-medium text-slate-800 dark:text-slate-100">{l.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(l.unitRefund, currency)} / {l.unit} billed rate</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.sold}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.sold - l.remaining}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.remaining}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          max={l.remaining}
                          step="any"
                          inputMode="decimal"
                          value={l.returnQty > 0 ? String(l.returnQty) : ''}
                          placeholder="0"
                          disabled={l.remaining <= 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0
                            setQty((prev) => ({ ...prev, [l.productId]: Math.min(Math.max(0, v), l.remaining) }))
                          }}
                          className="w-24 text-right"
                          aria-label={`Return quantity for ${l.name}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{l.refund > 0 ? formatMoney(l.refund, currency) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Input
            label="Reason (optional)"
            placeholder="e.g. damaged packaging, wrong item"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
          />

          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400">
              {returnCount > 0 ? `${returnCount} unit(s) · refunded at the billed rate · stock returns to inventory` : 'Enter return quantities above'}
            </span>
            <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(refundTotal, currency)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
