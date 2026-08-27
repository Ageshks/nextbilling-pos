import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { saveSettings, ensureSettings } from '../../services/settingsService'
import { logAudit } from '../../services/auditService'
import { required, type FieldErrors } from '../../utils/validation'
import { friendlyError } from '../../utils/errors'
import { PAYMENT_METHODS } from '../../types'

export default function SettingsPage() {
  const { user } = useAuth()
  const { settings, reloadSettings } = useStore()
  const { success, error: toastError } = useToast()

  const [form, setForm] = useState({
    name: '',
    logoUrl: '',
    address: '',
    phone: '',
    email: '',
    gstNumber: '',
    currency: 'INR',
    gstIncluded: true,
    invoicePrefix: 'SM',
    receiptFooter: '',
    defaultTax: 0,
    enableCreditSales: true,
    enableNegativeStock: false,
    defaultReceiptType: 'thermal' as 'a4' | 'thermal',
    posAutoFocusBarcode: true,
    posAutoPrintReceipt: false,
    posSoundOnScan: true,
    posShowStock: true,
    defaultPaymentMethod: 'CASH',
    // WhatsApp commerce / pickup
    waEnabled: false,
    waNumberDisplay: '',
    pickupAddress: '',
    pickupInstructions: '',
    businessHours: '',
    paymentProvider: 'none' as 'none' | 'razorpay',
    paymentTimeoutMinutes: 15,
    reservationTimeoutMinutes: 15,
    waGreetingTemplate: '',
    waPaymentSuccessTemplate: '',
    waPackingTemplate: '',
    waReadyTemplate: '',
    waCompletedTemplate: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name ?? '',
        logoUrl: settings.logoUrl ?? '',
        address: settings.address ?? '',
        phone: settings.phone ?? '',
        email: settings.email ?? '',
        gstNumber: settings.gstNumber ?? '',
        currency: settings.currency || 'INR',
        gstIncluded: settings.gstIncluded ?? true,
        invoicePrefix: settings.invoicePrefix || 'SM',
        receiptFooter: settings.receiptFooter ?? '',
        defaultTax: settings.defaultTax ?? 0,
        enableCreditSales: settings.enableCreditSales ?? true,
        enableNegativeStock: settings.enableNegativeStock ?? false,
        defaultReceiptType: settings.defaultReceiptType ?? 'thermal',
        posAutoFocusBarcode: settings.posAutoFocusBarcode ?? true,
        posAutoPrintReceipt: settings.posAutoPrintReceipt ?? false,
        posSoundOnScan: settings.posSoundOnScan ?? true,
        posShowStock: settings.posShowStock ?? true,
        defaultPaymentMethod: settings.defaultPaymentMethod || 'CASH',
        waEnabled: settings.waEnabled ?? false,
        waNumberDisplay: settings.waNumberDisplay ?? '',
        pickupAddress: settings.pickupAddress ?? '',
        pickupInstructions: settings.pickupInstructions ?? '',
        businessHours: settings.businessHours ?? '',
        paymentProvider: settings.paymentProvider ?? 'none',
        paymentTimeoutMinutes: settings.paymentTimeoutMinutes ?? 15,
        reservationTimeoutMinutes: settings.reservationTimeoutMinutes ?? 15,
        waGreetingTemplate: settings.waGreetingTemplate ?? '',
        waPaymentSuccessTemplate: settings.waPaymentSuccessTemplate ?? '',
        waPackingTemplate: settings.waPackingTemplate ?? '',
        waReadyTemplate: settings.waReadyTemplate ?? '',
        waCompletedTemplate: settings.waCompletedTemplate ?? '',
      })
      setDirty(false)
    }
  }, [settings])

  const patch = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const submit = async () => {
    if (!user || !settings?.storeId) return
    const errs: FieldErrors = {}
    const name = required(form.name, 'Store name')
    if (name) errs.name = name
    if (form.invoicePrefix.trim().length < 1) errs.invoicePrefix = 'Invoice prefix is required'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      await ensureSettings(settings.storeId)
      await saveSettings(
        settings.storeId,
        { ...form, invoicePrefix: form.invoicePrefix.trim().toUpperCase(), defaultTax: Number(form.defaultTax) || 0 },
        user.uid,
      )
      await logAudit({
        storeId: settings.storeId,
        userId: user.uid,
        userName: user.name,
        action: 'SETTINGS_CHANGED',
        entityType: 'settings',
        entityId: settings.storeId,
        metadata: {},
      })
      await reloadSettings()
      success('Settings saved. They apply immediately across the app.', 'Saved')
      setDirty(false)
    } catch (err) {
      toastError(friendlyError(err), 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Store profile, tax and billing behaviour"
        actions={
          <Button leftIcon={<Save className="h-4 w-4" />} loading={saving} onClick={submit} disabled={!dirty}>
            Save changes
          </Button>
        }
      />

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Store profile</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Store name *" value={form.name} onChange={(e) => patch('name', e.target.value)} error={errors.name} />
            <Input label="Phone" value={form.phone} onChange={(e) => patch('phone', e.target.value)} inputMode="tel" />
            <Input label="Email" value={form.email} onChange={(e) => patch('email', e.target.value)} type="email" />
            <Input label="GSTIN" value={form.gstNumber} onChange={(e) => patch('gstNumber', e.target.value.toUpperCase())} />
            <div className="sm:col-span-2">
              <Input label="Address" value={form.address} onChange={(e) => patch('address', e.target.value)} placeholder="Printed on invoices…" />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Billing & tax</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Currency" value={form.currency} onChange={(e) => patch('currency', e.target.value)}>
              <option value="INR">INR ₹</option>
              <option value="USD">USD $</option>
              <option value="AED">AED</option>
            </Select>
            <Input
              label="Invoice prefix *"
              value={form.invoicePrefix}
              onChange={(e) => patch('invoicePrefix', e.target.value.toUpperCase())}
              error={errors.invoicePrefix}
              hint="Invoices look like SM-2025-000001"
            />
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.gstIncluded} onChange={(e) => patch('gstIncluded', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Prices already include GST (retail default)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.enableCreditSales} onChange={(e) => patch('enableCreditSales', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Allow credit (udhaar) sales at POS
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.enableNegativeStock} onChange={(e) => patch('enableNegativeStock', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Allow selling when stock is zero
            </label>
            <Select label="Default payment method" value={form.defaultPaymentMethod} onChange={(e) => patch('defaultPaymentMethod', e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Receipts</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Default receipt type" value={form.defaultReceiptType} onChange={(e) => patch('defaultReceiptType', e.target.value as 'a4' | 'thermal')}>
              <option value="thermal">Thermal (58/80mm)</option>
              <option value="a4">A4 invoice</option>
            </Select>
            <div className="sm:col-span-2">
              <Input label="Receipt footer message" value={form.receiptFooter} onChange={(e) => patch('receiptFooter', e.target.value)} placeholder="Thank you for shopping with us" />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">POS behaviour</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.posAutoFocusBarcode} onChange={(e) => patch('posAutoFocusBarcode', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Keep barcode field focused automatically
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.posAutoPrintReceipt} onChange={(e) => patch('posAutoPrintReceipt', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Auto-open print dialog after each sale
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.posSoundOnScan} onChange={(e) => patch('posSoundOnScan', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Beep on successful scan
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.posShowStock} onChange={(e) => patch('posShowStock', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Show low-stock hints in POS search
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <h2 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-200">WhatsApp orders & pickup</h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Customer-facing configuration for store pickup over WhatsApp. Secrets (API tokens, webhook
            verification keys) are never stored here — they live only in Cloud Functions server config.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 dark:text-slate-300">
              <input type="checkbox" checked={form.waEnabled} onChange={(e) => patch('waEnabled', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Enable WhatsApp ordering &amp; store pickup
            </label>
            <Input label="WhatsApp business number (display)" value={form.waNumberDisplay} onChange={(e) => patch('waNumberDisplay', e.target.value)} placeholder="+91 98765 43210" />
            <Select label="Payment provider" value={form.paymentProvider} onChange={(e) => patch('paymentProvider', e.target.value as 'none' | 'razorpay')}>
              <option value="none">None (pay at counter)</option>
              <option value="razorpay">Razorpay</option>
            </Select>
            <div className="sm:col-span-2">
              <Input label="Pickup address" value={form.pickupAddress} onChange={(e) => patch('pickupAddress', e.target.value)} placeholder="Store address shown to customers" />
            </div>
            <Input label="Business hours" value={form.businessHours} onChange={(e) => patch('businessHours', e.target.value)} placeholder="Mon–Sun · 8am – 10pm" />
            <div className="sm:col-span-2">
              <Input label="Pickup instructions" value={form.pickupInstructions} onChange={(e) => patch('pickupInstructions', e.target.value)} placeholder="Show your order number at the billing counter" />
            </div>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Payment timeout (minutes)
              <NumberField value={form.paymentTimeoutMinutes} min={5} max={120} onChange={(v) => patch('paymentTimeoutMinutes', v)} />
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Reservation hold timeout (minutes)
              <NumberField value={form.reservationTimeoutMinutes} min={5} max={240} onChange={(v) => patch('reservationTimeoutMinutes', v)} />
            </label>

            <details className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Message templates</summary>
              <p className="mt-1 text-xs text-slate-400">Placeholders: {'{store}'}, {'{orderNo}'}, {'{total}'}, {'{address}'}, {'{instructions}'}. Leave blank to use built-in defaults.</p>
              <div className="mt-2 grid gap-3">
                <TextArea label="Greeting" value={form.waGreetingTemplate} onChange={(v) => patch('waGreetingTemplate', v)} rows={4} />
                <TextArea label="Payment received" value={form.waPaymentSuccessTemplate} onChange={(v) => patch('waPaymentSuccessTemplate', v)} rows={4} />
                <TextArea label="Packing started" value={form.waPackingTemplate} onChange={(v) => patch('waPackingTemplate', v)} rows={3} />
                <TextArea label="Ready for pickup" value={form.waReadyTemplate} onChange={(v) => patch('waReadyTemplate', v)} rows={5} />
                <TextArea label="Order completed" value={form.waCompletedTemplate} onChange={(v) => patch('waCompletedTemplate', v)} rows={3} />
              </div>
            </details>
          </div>
        </section>

        <p className="text-xs text-slate-400">
          Security note: these settings are stored per-store in Firestore. Restrict who can read/write the
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-700">settings</code> collection with Firestore Security Rules.
        </p>
      </div>
    </div>
  )
}

function NumberField({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))))
      }}
      className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
    />
  )
}

function TextArea({ label, value, rows, onChange }: { label: string; value: string; rows: number; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-slate-700 dark:text-slate-300">
      {label}
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
    </label>
  )
}