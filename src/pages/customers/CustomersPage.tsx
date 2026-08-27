import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, IndianRupee } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import {
  listCustomers,
  listCreditCustomers,
  createCustomer,
  updateCustomer,
  recordCreditPayment,
  type CustomerDraft,
} from '../../services/customerService'
import { formatMoney, formatDate } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import { required, isPhone, isEmail, type FieldErrors } from '../../utils/validation'
import type { Customer } from '../../types'

interface FormState extends CustomerDraft {
  id?: string
}

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', address: '', notes: '' }

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {}
  const name = required(form.name, 'Name')
  if (name) errors.name = name
  if (form.phone) {
    const phone = isPhone(form.phone)
    if (phone) errors.phone = phone
  }
  if (form.email) {
    const email = isEmail(form.email)
    if (email) errors.email = email
  }
  return errors
}

export default function CustomersPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [searchText, setSearchText] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const [collectTarget, setCollectTarget] = useState<Customer | null>(null)
  const [collectAmount, setCollectAmount] = useState('')
  const [collecting, setCollecting] = useState(false)

    const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [all, credit] = await Promise.all([listCustomers(user.storeId), listCreditCustomers(user.storeId)])
      // Merge the freshest balances from the indexed credit query.
      const balanceById = new Map(credit.map((c) => [c.id, c.creditBalance]))
      setCustomers(all.map((c) => (c.id && balanceById.has(c.id) ? { ...c, creditBalance: balanceById.get(c.id)! } : c)))
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load customers' })
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const t = searchText.trim().toLowerCase()
    if (!t) return customers
    return customers.filter(
      (c) => c.name.toLowerCase().includes(t) || c.phone.includes(t) || c.email.toLowerCase().includes(t),
    )
  }, [customers, searchText])

  const totalOutstanding = useMemo(() => customers.reduce((sum, c) => sum + c.creditBalance, 0), [customers])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setFormOpen(true)
  }

  const openEdit = (c: Customer) => {
    setForm({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes })
    setErrors({})
    setFormOpen(true)
  }

    const submitForm = async () => {
    if (!user) return
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      const { id, ...draft } = form
      if (id) {
        await updateCustomer(id, draft, user.uid)
        success(`${form.name} updated`, 'Customer saved')
      } else {
        await createCustomer(user.storeId, draft, user.uid)
        success(`${form.name} added`, 'Customer saved')
      }
      setFormOpen(false)
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not save customer')
    } finally {
      setSaving(false)
    }
  }

  const submitCollect = async () => {
    if (!user || !collectTarget?.id) return
    const amount = round2(parseFloat(collectAmount) || 0)
    if (amount <= 0) {
      toastError('Enter an amount greater than zero', 'Invalid amount')
      return
    }
    if (amount > collectTarget.creditBalance + 0.001) {
      toastError('Amount exceeds the outstanding balance', 'Invalid amount')
      return
    }
    setCollecting(true)
    try {
      await recordCreditPayment(collectTarget.id, amount, user.uid)
      success(`${formatMoney(amount, currency)} collected from ${collectTarget.name}`, 'Payment recorded')
      setCollectTarget(null)
      setCollectAmount('')
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not record payment')
    } finally {
      setCollecting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description={`${visible.length} customers · ${formatMoney(totalOutstanding, currency)} udhaar outstanding`}
        actions={
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Add customer
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input label="Search" placeholder="Name, phone or email…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
      </div>

      {loading ? (
        <Spinner label="Loading customers…" />
      ) : (
        <DataTable<Customer>
          rowKey={(c) => c.id ?? c.name}
          rows={visible}
          emptyState={<EmptyState title="No customers" message="Add your regulars to track udhaar and speed up billing." />}
          columns={[
            { key: 'name', header: 'Name', render: (c) => <span className="font-medium">{c.name}</span> },
            { key: 'phone', header: 'Phone', render: (c) => c.phone || '—' },
            {
              key: 'credit',
              header: 'Udhaar',
              className: 'tabular-nums text-right',
              headerClassName: 'text-right',
              render: (c) =>
                c.creditBalance > 0 ? (
                  <Badge tone="amber" className="tabular-nums">{formatMoney(c.creditBalance, currency)}</Badge>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
            },
            { key: 'spent', header: 'Total spent', className: 'tabular-nums text-right', headerClassName: 'text-right', render: (c) => formatMoney(c.totalSpent, currency) },
            { key: 'last', header: 'Last purchase', render: (c) => formatDate(c.lastPurchaseAt) },
            {
              key: 'actions',
              header: '',
              render: (c) => (
                <div className="flex justify-end gap-1">
                  {c.creditBalance > 0 && (
                    <Button size="xs" variant="success" leftIcon={<IndianRupee className="h-3 w-3" />} onClick={() => { setCollectTarget(c); setCollectAmount(String(c.creditBalance)) }}>
                      Collect
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}

            {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? 'Edit customer' : 'Add customer'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={submitForm}>{form.id ? 'Save changes' : 'Add customer'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoFocus />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} inputMode="tel" />
          <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} type="email" />
          <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="sm:col-span-2">
            <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Prefers evening delivery…" />
          </div>
        </div>
      </Modal>

      {/* Collect credit modal */}
      <Modal
        open={collectTarget !== null}
        onClose={() => setCollectTarget(null)}
        title={`Collect udhaar — ${collectTarget?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCollectTarget(null)}>Cancel</Button>
            <Button variant="success" loading={collecting} onClick={submitCollect}>Record payment</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Outstanding: <span className="font-semibold tabular-nums">{formatMoney(collectTarget?.creditBalance ?? 0, currency)}</span>
          </p>
          <Input
            label="Amount received"
            type="number"
            min={0}
            inputMode="decimal"
            value={collectAmount}
            onChange={(e) => setCollectAmount(e.target.value)}
            suffix={<span className="text-xs">{currency}</span>}
            autoFocus
                    />
        </div>
      </Modal>
    </div>
  )
}