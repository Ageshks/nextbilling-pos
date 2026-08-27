import { Clock, Trash2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { formatMoney, formatDateTime, formatNumber } from '../../utils/format'
import type { HeldBill } from '../../types'

interface HeldBillsModalProps {
  open: boolean
  currency: string
  bills: HeldBill[]
  loading: boolean
  deletingId: string | null
  onResume: (bill: HeldBill) => void
  onDelete: (bill: HeldBill) => void
  onClose: () => void
}

export function HeldBillsModal({ open, currency, bills, loading, deletingId, onResume, onDelete, onClose }: HeldBillsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Held bills" size="lg">
      {loading ? (
        <div className="space-y-2 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
          ))}
        </div>
      ) : bills.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-slate-500">
          <Clock className="h-6 w-6 text-slate-400" aria-hidden="true" />
          <span>No bills on hold.</span>
        </div>
      ) : (
        <ul className="-mx-4 space-y-2">
          {bills.map((bill) => (
            <li key={bill.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Held bill by {bill.userName || 'Cashier'} · {formatDateTime(bill.heldAt)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatNumber(bill.items?.length ?? 0)} items · {bill.customerName ? `for ${bill.customerName}` : 'Cash'}
                  </p>
                </div>
                <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(bill.total, currency)}</span>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => onResume(bill)}>
                  Resume
                </Button>
                                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  loading={deletingId === bill.id}
                  onClick={() => onDelete(bill)}
                  aria-label={`Delete held bill ${bill.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
