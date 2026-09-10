import { useEffect, useRef, useState } from 'react'
import { Ticket, X } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { validateCoupon } from '../../services/couponService'
import type { CartCoupon } from '../../context/CartContext'

interface CouponModalProps {
  open: boolean
  storeId: string
  billAmount: number
  currency: string
  applied: CartCoupon | null
  onApply: (coupon: CartCoupon) => void
  onRemove: () => void
  onClose: () => void
}

export function CouponModal({ open, storeId, billAmount, currency, applied, onApply, onRemove, onClose }: CouponModalProps) {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setMessage('')
      setError(false)
      inputRef.current?.focus()
    }
  }, [open])

  const submit = async () => {
    const normalized = code.trim().toUpperCase()
    if (!normalized) return
    setChecking(true)
    setMessage('')
    try {
      const res = await validateCoupon(storeId, normalized, billAmount)
      if (res.ok && res.coupon) {
        setMessage(`${res.message} — ${res.discount} off`)
        setError(false)
        onApply({ id: res.coupon.id ?? '', code: res.coupon.code, discount: res.discount })
        onClose()
      } else {
        setMessage(res.message)
        setError(true)
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not validate coupon')
      setError(true)
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply coupon"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button loading={checking} onClick={submit} disabled={!code.trim()}>Apply</Button>
        </>
      }
    >
      <div className="space-y-3">
        {applied && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="flex items-center gap-2">
              <Ticket className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">{applied.code}</span> · {applied.discount} off
            </span>
            <button type="button" onClick={onRemove} aria-label="Remove coupon" className="rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-500/20">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <Input
          ref={inputRef}
          label="Coupon code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. SAVE10"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Applies to the current bill of {currency} {billAmount.toFixed(2)} (after item discounts).
        </p>
        {message && (
          <p className={`rounded-lg px-3 py-2 text-sm ${error ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-slate-50 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200'}`}>
            {message}
          </p>
        )}
      </div>
    </Modal>
  )
}
