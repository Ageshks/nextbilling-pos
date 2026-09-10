import { useEffect, useMemo, useState } from 'react'
import { Banknote, Smartphone, CreditCard, HelpCircle, Wallet, Ticket, CheckCircle2, XCircle } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatMoney } from '../../utils/format'
import { round2, calculateChange } from '../../utils/calculations'
import { findVoucherByCode } from '../../services/voucherService'
import type { PaymentMethod, SalePayment, Voucher, VoucherRedemption } from '../../types'
import { PAYMENT_METHODS } from '../../types'

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  OTHER: Wallet,
  CREDIT: HelpCircle,
  VOUCHER: Ticket,
}

interface PaymentModalProps {
  open: boolean
  total: number
  currency: string
  storeId: string
  defaultMethod: string
  enableCredit: boolean
  submitting: boolean
  onClose: () => void
  onComplete: (payments: SalePayment[], amountReceived: number, voucher: VoucherRedemption | null) => void
}

export function PaymentModal({ open, total, currency, storeId, defaultMethod, enableCredit, submitting, onClose, onComplete }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [received, setReceived] = useState('')
  const [mixed, setMixed] = useState(false)
  const [cashAlloc, setCashAlloc] = useState('')
  const [otherAlloc, setOtherAlloc] = useState('')
  // ---- Gift voucher tender ----
  const [voucherOn, setVoucherOn] = useState(false)
  const [voucherCode, setVoucherCode] = useState('')
  const [voucherAmt, setVoucherAmt] = useState('')
  const [voucherInfo, setVoucherInfo] = useState<Voucher | null>(null)
  const [voucherError, setVoucherError] = useState('')
  const [voucherChecking, setVoucherChecking] = useState(false)

  useEffect(() => {
    if (open) {
      setMethod(PAYMENT_METHODS.includes(defaultMethod as PaymentMethod) ? (defaultMethod as PaymentMethod) : 'CASH')
      setReceived(String(total))
      setMixed(false)
      setCashAlloc(String(Math.max(0, Math.floor(total / 10) * 10) || total))
      setOtherAlloc('')
      setVoucherOn(false)
      setVoucherCode('')
      setVoucherAmt('')
      setVoucherInfo(null)
      setVoucherError('')
    }
  }, [open, total, defaultMethod])

  const voucherAmount = voucherOn && voucherInfo && parseFloat(voucherAmt) > 0
    ? round2(Math.min(parseFloat(voucherAmt), voucherInfo.balance ?? 0, total))
    : 0
  const remaining = round2(total - voucherAmount)

  const change = useMemo(() => {
    if (mixed || method !== 'CASH') return 0
    const rec = parseFloat(received) || 0
    return calculateChange(rec, remaining)
  }, [mixed, method, received, remaining])

  const checkVoucherCode = async () => {
    const code = voucherCode.trim().toUpperCase()
    setVoucherError('')
    setVoucherInfo(null)
    if (!code) {
      setVoucherError('Enter a voucher code')
      return
    }
    setVoucherChecking(true)
    try {
      const v = await findVoucherByCode(storeId, code)
      if (!v) {
        setVoucherError(`Voucher ${code} not found`)
        return
      }
      if (v.status === 'VOID') {
        setVoucherError(`Voucher ${code} is void`)
        return
      }
      if ((v.balance ?? 0) <= 0) {
        setVoucherError(`Voucher ${code} is fully used`)
        return
      }
      setVoucherInfo(v)
      if (!voucherAmt) setVoucherAmt(String(round2(Math.min(v.balance ?? 0, total))))
    } catch (err) {
      setVoucherError(err instanceof Error ? err.message : 'Could not check voucher')
    } finally {
      setVoucherChecking(false)
    }
  }

  const buildPayments = (): { payments: SalePayment[]; receivedAmount: number } | null => {
    const va = voucherAmount
    if (mixed) {
      const cash = parseFloat(cashAlloc) || 0
      const other = parseFloat(otherAlloc) || 0
      if (Math.abs(round2(cash + other + va) - total) > 0.05) return null
      const payments: SalePayment[] = []
      if (cash > 0) payments.push({ method: 'CASH', amount: cash })
      if (other > 0) {
        const otherMethods: PaymentMethod[] = PAYMENT_METHODS.filter((m) => m !== 'CASH' && m !== 'CREDIT' && m !== 'VOUCHER')
        payments.push({ method: otherMethods.includes(method) ? method : 'UPI', amount: other })
      }
      if (va > 0) payments.push({ method: 'VOUCHER', amount: va })
      return { payments, receivedAmount: cash }
    }
    if (method === 'CREDIT') {
      if (va > 0) return null
      return { payments: [{ method: 'CREDIT', amount: total }], receivedAmount: 0 }
    }
    if (method === 'CASH') {
      const rec = parseFloat(received) || remaining
      if (rec < remaining - 0.05) return null
      const payments: SalePayment[] = []
      if (va > 0) payments.push({ method: 'VOUCHER', amount: va })
      if (remaining > 0) payments.push({ method: 'CASH', amount: Math.min(rec, remaining) })
      return { payments, receivedAmount: rec }
    }
    const payments: SalePayment[] = []
    if (va > 0) payments.push({ method: 'VOUCHER', amount: va })
    if (remaining > 0) payments.push({ method, amount: remaining })
    return { payments, receivedAmount: remaining }
  }

  const handleComplete = () => {
    const built = buildPayments()
    if (!built) return
    const voucher: VoucherRedemption | null =
      voucherOn && voucherInfo && voucherAmount > 0
        ? { voucherId: voucherInfo.id ?? '', code: voucherInfo.code, amount: voucherAmount }
        : null
    onComplete(built.payments, built.receivedAmount, voucher)
  }

  const availMethods = enableCredit
    ? PAYMENT_METHODS.filter((m) => m !== 'VOUCHER')
    : PAYMENT_METHODS.filter((m) => m !== 'CREDIT' && m !== 'VOUCHER')

  const allocationsOk = useMemo(() => {
    if (voucherOn && !voucherInfo) return false
    if (mixed) {
      return Math.abs(round2((parseFloat(cashAlloc) || 0) + (parseFloat(otherAlloc) || 0) + voucherAmount) - total) <= 0.05
    }
    if (method === 'CASH') {
      const rec = parseFloat(received) || remaining
      return rec >= remaining - 0.05
    }
    if (method === 'CREDIT') return voucherAmount === 0
    return true
  }, [voucherOn, voucherInfo, mixed, cashAlloc, otherAlloc, voucherAmount, total, method, received, remaining])

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
          <Button size="lg" onClick={handleComplete} loading={submitting} disabled={total <= 0 || !allocationsOk}>
            Complete sale (F10)
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-700/40">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount due</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(total, currency)}</p>
          {voucherAmount > 0 && (
            <p className="mt-1 text-sm text-violet-700 dark:text-violet-300">
              Voucher pays {formatMoney(voucherAmount, currency)} · to pay {formatMoney(remaining, currency)}
            </p>
          )}
        </div>

        {voucherOn && (
          <div className="space-y-3 rounded-xl border border-violet-300 bg-violet-50 p-4 dark:border-violet-500/40 dark:bg-violet-500/10">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-violet-800 dark:text-violet-200">
                <Ticket className="h-4 w-4" aria-hidden="true" /> Gift voucher
              </p>
              <button type="button" onClick={() => setVoucherOn(false)} aria-label="Remove voucher" className="text-violet-500 hover:text-violet-700">
                <XCircle className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex items-end gap-2">
              <Input
                label="Voucher code"
                value={voucherCode}
                onChange={(e) => {
                  setVoucherCode(e.target.value.toUpperCase())
                  setVoucherInfo(null)
                  setVoucherError('')
                }}
                placeholder="GV-XXXXXXXX"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void checkVoucherCode()
                  }
                }}
              />
              <Button variant="outline" onClick={() => void checkVoucherCode()} disabled={!voucherCode.trim() || voucherChecking}>
                Check
              </Button>
            </div>
            {voucherError && <p className="text-sm text-red-600 dark:text-red-400">{voucherError}</p>}
            {voucherInfo && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Balance {formatMoney(voucherInfo.balance ?? 0, currency)}
                </p>
                <Input
                  label="Amount to use"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={voucherAmt}
                  onChange={(e) => setVoucherAmt(e.target.value)}
                  suffix={<span className="text-xs">{currency}</span>}
                />
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={() => setVoucherOn((v) => !v)} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${voucherOn ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
          <Ticket className="h-4 w-4" aria-hidden="true" />
          {voucherOn ? 'Voucher applied' : 'Use gift voucher'}
        </button>

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
              {round2((parseFloat(cashAlloc) || 0) + (parseFloat(otherAlloc) || 0) + voucherAmount)} of {formatMoney(total, currency)} allocated
            </p>
          </div>
        ) : method === 'CASH' ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-3 gap-1.5">
              {[0, 5, 10, 20, 50, 100].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setReceived(String(remaining + step))}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {step === 0 ? 'Exact' : `+${step}`}
                </button>
              ))}
            </div>
            <Input
              label={voucherAmount > 0 ? `Cash received (cash due ${formatMoney(remaining, currency)})` : 'Amount received'}
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
            {method} of {formatMoney(remaining, currency)} will be collected from the customer.
          </p>
        )}
      </div>
    </Modal>
  )
}