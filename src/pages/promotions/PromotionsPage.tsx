import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Ticket, Gift, Printer } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import { Select } from '../../components/ui/Select'
import {
  listCoupons,
  createCoupon,
  updateCoupon,
  computeCouponDiscount,
  type CouponDraft,
} from '../../services/couponService'
import {
  listVouchers,
  createVoucher,
  voidVoucher,
  voucherSummary,
} from '../../services/voucherService'
import { formatMoney, formatDate } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import { required, positive, minZero, type FieldErrors } from '../../utils/validation'
import type { Coupon, Voucher, CouponDiscountType, VoucherSoldVia } from '../../types'

type Tab = 'coupons' | 'vouchers'

const EMPTY_COUPON: CouponDraft = {
  code: '',
  discountType: 'PERCENT',
  discountValue: 10,
  minBillAmount: 0,
  maxDiscount: 0,
  usageLimit: 0,
  active: true,
  validFrom: 0,
  validUntil: 0,
  note: '',
}

function validateCouponForm(f: CouponDraft): FieldErrors {
  const errors: FieldErrors = {}
  const code = required(f.code, 'Code')
  if (code) errors.code = code
  const v = positive(f.discountValue, 'Discount value')
  if (v) errors.discountValue = v
  const m = minZero(f.minBillAmount, 'Minimum bill')
  if (m) errors.minBillAmount = m
  if (f.discountType === 'PERCENT' && f.discountValue > 100) errors.discountValue = 'Percent cannot exceed 100'
  return errors
}

function validateVoucherForm(amount: string, code: string): FieldErrors {
  const errors: FieldErrors = {}
  const a = positive(parseFloat(amount) || 0, 'Amount')
  if (a) errors.amount = a
  if (code && code.trim().length < 4) errors.code = 'Code must be at least 4 characters'
  return errors
}

export default function PromotionsPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [tab, setTab] = useState<Tab>('coupons')
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [loading, setLoading] = useState(true)

  const [couponFormOpen, setCouponFormOpen] = useState(false)
  const [couponForm, setCouponForm] = useState<CouponDraft>(EMPTY_COUPON)
  const [couponErrors, setCouponErrors] = useState<FieldErrors>({})
  const [savingCoupon, setSavingCoupon] = useState(false)

  const [voucherOpen, setVoucherOpen] = useState(false)
  const [voucherAmount, setVoucherAmount] = useState('')
  const [voucherCode, setVoucherCode] = useState('')
  const [voucherSoldVia, setVoucherSoldVia] = useState<VoucherSoldVia>('CASH')
  const [voucherNote, setVoucherNote] = useState('')
  const [voucherErrors, setVoucherErrors] = useState<FieldErrors>({})
  const [issuing, setIssuing] = useState(false)
  const [lastIssued, setLastIssued] = useState<Voucher | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [c, v] = await Promise.all([listCoupons(user.storeId), listVouchers(user.storeId)])
      setCoupons(c)
      setVouchers(v)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load promotions' })
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => voucherSummary(vouchers), [vouchers])

  const submitCoupon = async () => {
    const errors = validateCouponForm(couponForm)
    setCouponErrors(errors)
    if (Object.keys(errors).length > 0 || !user) return
    setSavingCoupon(true)
    try {
      await createCoupon(
        { ...couponForm, code: couponForm.code.trim().toUpperCase(), storeId: user.storeId },
        user.uid,
      )
      success(`Coupon ${couponForm.code.toUpperCase()} created`, 'Coupon saved')
      setCouponFormOpen(false)
      setCouponForm(EMPTY_COUPON)
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not save coupon')
    } finally {
      setSavingCoupon(false)
    }
  }

  const toggleCoupon = async (c: Coupon) => {
    try {
      await updateCoupon(c.id ?? '', { active: !c.active }, user?.uid ?? '')
      success(`Coupon ${c.code} ${c.active ? 'deactivated' : 'activated'}`, 'Updated')
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not update coupon')
    }
  }

  const issueVoucher = async () => {
    const errors = validateVoucherForm(voucherAmount, voucherCode)
    setVoucherErrors(errors)
    if (Object.keys(errors).length > 0 || !user) return
    setIssuing(true)
    try {
      const amount = round2(parseFloat(voucherAmount))
      await createVoucher(
        {
          storeId: user.storeId,
          code: voucherCode.trim().toUpperCase(),
          amount,
          balance: amount,
          status: 'ACTIVE',
          soldVia: voucherSoldVia,
          note: voucherNote,
          soldInvoiceNumber: '',
          lastRedeemedAt: 0,
        },
        user.uid,
      )
      const fresh = await listVouchers(user.storeId)
      const created = fresh.find((v) => v.code === voucherCode.trim().toUpperCase()) ?? null
      setLastIssued(created)
      setVouchers(fresh)
      success('Voucher issued', 'Gift voucher')
      setVoucherAmount('')
      setVoucherCode('')
      setVoucherNote('')
      setVoucherSoldVia('CASH')
    } catch (err) {
      toastError(friendlyError(err), 'Could not issue voucher')
    } finally {
      setIssuing(false)
    }
  }

  const doVoidVoucher = async (v: Voucher) => {
    try {
      await voidVoucher(v.id ?? '', user?.uid ?? '')
      success(`Voucher ${v.code} voided`, 'Voucher updated')
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not void voucher')
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Coupons & Vouchers"
        description="Discount codes for billing and gift vouchers redeemable at POS"
        actions={
          <div className="flex gap-2">
            {tab === 'coupons' ? (
              <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setCouponForm(EMPTY_COUPON); setCouponErrors({}); setCouponFormOpen(true) }}>
                New coupon
              </Button>
            ) : (
              <Button leftIcon={<Gift className="h-4 w-4" />} onClick={() => { setVoucherOpen(true); setLastIssued(null) }}>
                Issue voucher
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 p-1 dark:border-slate-700">
        {(['coupons', 'vouchers'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}
          >
            {t === 'coupons' ? <Ticket className="h-4 w-4" aria-hidden="true" /> : <Gift className="h-4 w-4" aria-hidden="true" />}
            {t === 'coupons' ? 'Coupons' : 'Gift vouchers'}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading promotions…" />
      ) : tab === 'coupons' ? (
        coupons.length === 0 ? (
          <EmptyState icon={<Ticket className="h-8 w-8" />} title="No coupons yet" message="Create a discount code like SAVE10 for 10% off." />
        ) : (
          <DataTable
            rowKey={(c) => c.id ?? c.code}
            columns={[
              { key: 'code', header: 'Code', render: (c) => <span className="font-mono font-semibold">{c.code}</span> },
              {
                key: 'value',
                header: 'Discount',
                render: (c) =>
                  c.discountType === 'PERCENT'
                    ? `${c.discountValue}%${c.maxDiscount > 0 ? ` (max ${formatMoney(c.maxDiscount, currency)})` : ''}`
                    : formatMoney(c.discountValue, currency),
              },
              { key: 'min', header: 'Min bill', render: (c) => (c.minBillAmount > 0 ? formatMoney(c.minBillAmount, currency) : '—') },
              {
                key: 'usage',
                header: 'Used',
                render: (c) => (c.usageLimit > 0 ? `${c.usedCount} / ${c.usageLimit}` : `${c.usedCount}`),
              },
              { key: 'valid', header: 'Valid until', render: (c) => (c.validUntil ? formatDate(c.validUntil) : 'No expiry') },
              {
                key: 'status',
                header: 'Status',
                render: (c) => <Badge tone={c.active ? 'emerald' : 'slate'}>{c.active ? 'Active' : 'Inactive'}</Badge>,
              },
              {
                key: 'actions',
                header: '',
                render: (c) => (
                  <Button size="xs" variant="ghost" onClick={() => void toggleCoupon(c)}>
                    {c.active ? 'Deactivate' : 'Activate'}
                  </Button>
                ),
              },
            ]}
            rows={coupons}
          />
        )
      ) : vouchers.length === 0 ? (
        <EmptyState icon={<Gift className="h-8 w-8" />} title="No vouchers yet" message="Issue a gift voucher — customers can redeem it as payment at POS." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge tone="emerald">Issued value: {formatMoney(summary.issued, currency)}</Badge>
            <Badge tone="sky">Outstanding balance: {formatMoney(summary.outstanding, currency)}</Badge>
          </div>
          <DataTable
            rowKey={(v) => v.id ?? v.code}
            columns={[
              { key: 'code', header: 'Code', render: (v) => <span className="font-mono font-semibold">{v.code}</span> },
              { key: 'amount', header: 'Face value', render: (v) => formatMoney(v.amount, currency) },
              { key: 'balance', header: 'Balance', render: (v) => formatMoney(v.balance, currency) },
              {
                key: 'status',
                header: 'Status',
                render: (v) => (
                  <Badge tone={v.status === 'ACTIVE' ? 'emerald' : v.status === 'VOID' ? 'red' : 'slate'}>
                    {v.status}
                  </Badge>
                ),
              },
              { key: 'soldVia', header: 'Sold via', render: (v) => v.soldVia || 'Gifted' },
              { key: 'created', header: 'Issued', render: (v) => formatDate(v.createdAt) },
              {
                key: 'actions',
                header: '',
                render: (v) =>
                  v.status === 'ACTIVE' ? (
                    <Button size="xs" variant="ghost" onClick={() => void doVoidVoucher(v)}>
                      Void
                    </Button>
                  ) : null,
              },
            ]}
            rows={vouchers}
          />
        </div>
      )}

      {/* New coupon modal */}
      <Modal
        open={couponFormOpen}
        onClose={() => setCouponFormOpen(false)}
        title="New coupon"
        footer={
          <>
            <Button variant="outline" onClick={() => setCouponFormOpen(false)}>Cancel</Button>
            <Button loading={savingCoupon} onClick={submitCoupon}>Create coupon</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Code *" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} error={couponErrors.code} placeholder="SAVE10" autoFocus />
          <Select label="Discount type" value={couponForm.discountType} onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value as CouponDiscountType })}>
            <option value="PERCENT">Percent (%)</option>
            <option value="FIXED">Flat amount</option>
          </Select>
          <Input label="Discount value *" type="number" min={0} inputMode="decimal" value={couponForm.discountValue} onChange={(e) => setCouponForm({ ...couponForm, discountValue: parseFloat(e.target.value) || 0 })} error={couponErrors.discountValue} />
          {couponForm.discountType === 'PERCENT' && (
            <Input label="Max discount cap (0 = none)" type="number" min={0} inputMode="decimal" value={couponForm.maxDiscount} onChange={(e) => setCouponForm({ ...couponForm, maxDiscount: parseFloat(e.target.value) || 0 })} />
          )}
          <Input label="Minimum bill (0 = none)" type="number" min={0} inputMode="decimal" value={couponForm.minBillAmount} onChange={(e) => setCouponForm({ ...couponForm, minBillAmount: parseFloat(e.target.value) || 0 })} error={couponErrors.minBillAmount} />
          <Input label="Usage limit (0 = unlimited)" type="number" min={0} inputMode="decimal" value={couponForm.usageLimit} onChange={(e) => setCouponForm({ ...couponForm, usageLimit: Math.floor(parseFloat(e.target.value) || 0) })} />
          <Input label="Valid from" type="date" value={couponForm.validFrom ? new Date(couponForm.validFrom).toISOString().slice(0, 10) : ''} onChange={(e) => setCouponForm({ ...couponForm, validFrom: e.target.value ? new Date(e.target.value).getTime() : 0 })} />
          <Input label="Valid until (blank = never)" type="date" value={couponForm.validUntil ? new Date(couponForm.validUntil).toISOString().slice(0, 10) : ''} onChange={(e) => setCouponForm({ ...couponForm, validUntil: e.target.value ? new Date(`${e.target.value}T23:59:59`).getTime() : 0 })} />
          <div className="sm:col-span-2">
            <Input label="Note" value={couponForm.note} onChange={(e) => setCouponForm({ ...couponForm, note: e.target.value })} placeholder="Diwali offer…" />
          </div>
          {couponForm.code.trim() && (
            <div className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
              Preview on a ₹1,000 bill: <span className="font-semibold">{formatMoney(computeCouponDiscount({ ...couponForm, code: couponForm.code.toUpperCase(), storeId: user?.storeId ?? '', usedCount: 0 }, 1000), currency)}</span> off
            </div>
          )}
        </div>
      </Modal>

      {/* Issue voucher modal */}
      <Modal
        open={voucherOpen}
        onClose={() => setVoucherOpen(false)}
        title="Issue gift voucher"
        footer={
          <>
            <Button variant="outline" onClick={() => setVoucherOpen(false)}>Close</Button>
            <Button loading={issuing} onClick={issueVoucher}>Issue voucher</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Amount *" type="number" min={0} inputMode="decimal" value={voucherAmount} onChange={(e) => setVoucherAmount(e.target.value)} error={voucherErrors.amount} suffix={<span className="text-xs">{currency}</span>} autoFocus />
          <Input label="Code (blank = auto)" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} error={voucherErrors.code} placeholder="GV-…" />
          <Select label="Payment received via" value={voucherSoldVia} onChange={(e) => setVoucherSoldVia(e.target.value as VoucherSoldVia)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
            <option value="">Gifted (free)</option>
          </Select>
          <Input label="Note" value={voucherNote} onChange={(e) => setVoucherNote(e.target.value)} placeholder="Customer name / occasion…" />
        </div>
        {lastIssued && (
          <div className="mt-4 rounded-xl border-2 border-dashed border-violet-300 p-4 text-center dark:border-violet-500/40">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Gift voucher</p>
            <p className="my-1 font-mono text-2xl font-bold tracking-widest text-violet-700 dark:text-violet-300">{lastIssued.code}</p>
            <p className="text-sm font-semibold">{formatMoney(lastIssued.amount, currency)}</p>
            <Button size="sm" variant="outline" className="mt-2" leftIcon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
