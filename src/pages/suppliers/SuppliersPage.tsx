import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
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
  listSuppliers,
  createSupplier,
  updateSupplier,
  type SupplierDraft,
} from '../../services/supplierService'
import { formatMoney, formatDate } from '../../utils/format'
import { friendlyError } from '../../utils/errors'
import { required, isPhone, isEmail, type FieldErrors } from '../../utils/validation'
import type { Supplier } from '../../types'

type FormState = SupplierDraft & { id?: string }

const EMPTY_FORM: FormState = { name: '', company: '', phone: '', email: '', address: '', gstNumber: '', notes: '' }

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

export default function SuppliersPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await listSuppliers(user.storeId)
      setSuppliers(rows)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load suppliers' })
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const t = searchText.trim().toLowerCase()
    if (!t) return suppliers
    return suppliers.filter(
      (s) => s.name.toLowerCase().includes(t) || s.company.toLowerCase().includes(t) || s.phone.includes(t),
    )
  }, [suppliers, searchText])

  const totalOutstanding = useMemo(() => suppliers.reduce((sum, s) => sum + s.outstandingBalance, 0), [suppliers])

    const openCreate = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setFormOpen(true)
  }

  const openEdit = (s: Supplier) => {
    setForm({ id: s.id, name: s.name, company: s.company, phone: s.phone, email: s.email, address: s.address, gstNumber: s.gstNumber, notes: s.notes })
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
        await updateSupplier(id, draft, user.uid)
        success(`${form.name} updated`, 'Supplier saved')
      } else {
        await createSupplier(user.storeId, draft, user.uid)
        success(`${form.name} added`, 'Supplier saved')
      }
      setFormOpen(false)
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not save supplier')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description={`${visible.length} suppliers · ${formatMoney(totalOutstanding, currency)} payable outstanding`}
        actions={
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Add supplier
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input label="Search" placeholder="Name, company or phone…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
      </div>

      {loading ? (
        <Spinner label="Loading suppliers…" />
      ) : (
        <DataTable<Supplier>
          rowKey={(s) => s.id ?? s.name}
          rows={visible}
          emptyState={<EmptyState title="No suppliers" message="Add suppliers to start recording purchases." />}
          columns={[
            { key: 'name', header: 'Supplier',
              render: (s) => (
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{s.company || '—'}</p>
                </div>
              ) },
            { key: 'phone', header: 'Phone', render: (s) => s.phone || '—' },
            { key: 'gst', header: 'GSTIN', render: (s) => s.gstNumber || '—' },
            { key: 'outstanding', header: 'Payable', className: 'tabular-nums text-right', headerClassName: 'text-right',
              render: (s) =>
                s.outstandingBalance > 0 ? (
                  <Badge tone="red" className="tabular-nums">{formatMoney(s.outstandingBalance, currency)}</Badge>
                ) : (
                  <span className="text-slate-400">—</span>
                ) },
            { key: 'total', header: 'Total purchased', className: 'tabular-nums text-right', headerClassName: 'text-right', render: (s) => formatMoney(s.totalPurchases, currency) },
            { key: 'last', header: 'Last purchase', render: (s) => formatDate(s.lastPurchaseAt) },
            { key: 'actions', header: '', render: (s) => (
              <div className="flex justify-end">
                <Button size="xs" variant="ghost" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => openEdit(s)}>
                  Edit
                </Button>
              </div>
            ) },
          ]}
        />
      )}

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? 'Edit supplier' : 'Add supplier'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={submitForm}>{form.id ? 'Save changes' : 'Add supplier'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoFocus />
          <Input label="Company / firm" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} inputMode="tel" />
          <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} type="email" />
          <div className="sm:col-span-2">
            <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <Input label="GSTIN" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
          <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}