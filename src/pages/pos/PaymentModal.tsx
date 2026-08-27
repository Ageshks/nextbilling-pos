import { useEffect, useMemo, useState } from 'react'
import { Banknote, Smartphone, CreditCard, HelpCircle, Wallet } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatMoney } from '../../utils/format'
import { round2, calculateChange } from '../../utils/calculations'
import type { PaymentMethod, SalePayment } from '../../types'
import { PAYMENT_METHODS } from '../../types'

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  OTHER: Wallet,
  CREDIT: HelpCircle,
}

interface PaymentModalProps {
  open: boolean
  total: number
  currency: string
  defaultMethod: string
  enableCredit: boolean
  submitting: boolean
  onClose: () => void
  onComplete: (payments: SalePayment[], amountReceived: number) => void
}

export function PaymentModal({ open, total, currency, defaultMethod, enableCredit, submitting, onClose, onComplete }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [received, setReceived] = useState('')
  const [mixed, setMixed] = useState(false)
  const [cashAlloc, setCashAlloc] = useState('')
  const [otherAlloc, setOtherAlloc] = useState('')

  useEffect(() => {
    if (open) {
      setMethod(PAYMENT_METHODS.includes(defaultMethod as PaymentMethod) ? (defaultMethod as PaymentMethod) : 'CASH')
      setReceived(String(total))
      setMixed(false)
      setCashAlloc(String(Math.max(0, Math.floor(total / 10) * 10) || total))
      setOtherAlloc('')
    }
  }, [open, total, defaultMethod])

  const change = useMemo(() => {
    if (mixed || method !== 'CASH') return 0
    const rec = parseFloat(received) || 0
    return calculateChange(rec, total)
  }, [mixed, method, received, total])

  const buildPayments = (): { payments: SalePayment[]; receivedAmount: number } | null => {
    if (mixed) {
      const cash = parseFloat(cashAlloc) || 0
      const other = parseFloat(otherAlloc) || 0
      if (Math.abs(round2(cash + other) - total) > 0.05) return null
            const payments: SalePayment[] = []
      if (cash > 0) payments.push({ method: 'CASH', amount: cash })
      if (other > 0) {
        const otherMethods: PaymentMethod[] = PAYMENT_METHODS.filter((m) => m !== 'CASH' && m !== 'CREDIT')
        payments.push({ method: otherMethods.includes(method) ? method : 'UPI', amount: other })
      }
      return { payments, receivedAmount: cash }
    }
    if (method === 'CREDIT') {
      return { payments: [{ method: 'CREDIT', amount: total }], receivedAmount: 0 }
    }
    if (method === 'CASH') {
      const rec = parseFloat(received) || total
      return { payments: [{ method: 'CASH', amount: Math.min(rec, total) }], receivedAmount: rec }
    }
    return { payments: [{ method, amount: total }], receivedAmount: total }
  }

  const handleComplete = () => {
    const built = buildPayments()
    if (!built) return
    onComplete(built.payments, built.receivedAmount)
  }

  const availMethods = enableCredit ? PAYMENT_METHODS : PAYMENT_METHODS.filter((m) => m !== 'CREDIT')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payment"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="lg" onClick={handleComplete} loading={submitting} disabled={total <= 0}>
            Complete sale (F10)
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-700/40">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount due</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(total, currency)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {availMethods.map((m) => {
            const Icon = METHOD_ICONS[m]
            const active = !mixed && method === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethod(m)
                  setMixed(false)
                }}
                className={`flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-colors ${
                  active
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:text-slate-300'
                }`}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
                {m}
              </button>
            )
          })}
        </div>

        <button type="button" onClick={() => setMixed((v) => !v)} className="text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
          {mixed ? 'Single payment' : 'Mixed payment (cash + UPI/card/credit)'}
        </button>

        {mixed ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <Input
              label="Cash amount"
              type="number"
              min={0}
              inputMode="decimal"
              value={cashAlloc}
              onChange={(e) => setCashAlloc(e.target.value)}
              suffix={<span className="text-xs">{currency}</span>}
            />
            <Input
              label={method === 'CREDIT' ? 'Credit amount' : `${method} amount`}
              type="number"
              min={0}
              inputMode="decimal"
              value={otherAlloc}
              onChange={(e) => setOtherAlloc(e.target.value)}
              suffix={<span className="text-xs">{currency}</span>}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {round2((parseFloat(cashAlloc) || 0) + (parseFloat(otherAlloc) || 0))} of {formatMoney(total, currency)} allocated
            </p>
          </div>
        ) : method === 'CASH' ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-3 gap-1.5">
              {[0, 5, 10, 20, 50, 100].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setReceived(String(total + step))}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {step === 0 ? 'Exact' : `+${step}`}
                </button>
              ))}
            </div>
            <Input
              label="Amount received"
              type="number"
              min={0}
              inputMode="decimal"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              suffix={<span className="text-xs">{currency}</span>}
              autoFocus
            />
            <div className={`flex justify-between rounded-lg px-3 py-2 text-lg font-bold ${change > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-slate-50 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300'}`}>
              <span>Change to return</span>
              <span>{formatMoney(change, currency)}</span>
            </div>
          </div>
        ) : method === 'CREDIT' ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            The full total will be recorded as credit (udhaar) against the selected customer.
          </p>
        ) : (
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
            {method} of {formatMoney(total, currency)} will be collected from the customer.
          </p>
        )}
      </div>
    </Modal>
  )
}