import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import {
  createExpense,
  listExpenses,
  type ExpenseDraft,
} from '../../services/expenseService'
import { formatMoney, formatDateTime, endOfDay, daysAgo, fromDateInputValue, toDateInputValue } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import { downloadCsv } from '../../utils/csv'
import { PAYMENT_METHODS } from '../../types'
import { EXPENSE_CATEGORIES } from '../../types/expense'
import type { Expense } from '../../types'

interface FormState extends Omit<ExpenseDraft, 'storeId' | 'createdBy'> {}

const today = () => toDateInputValue(Date.now())

export default function ExpensesPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [fromDate, setFromDate] = useState(toDateInputValue(daysAgo(29)))
  const [toDate, setToDate] = useState(today())
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>({
    category: 'Other',
    description: '',
    amount: 0,
    paymentMethod: 'CASH',
    date: endOfDay(),
    notes: '',
  })

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await listExpenses({
        storeId: user.storeId,
        from: fromDateInputValue(fromDate),
        to: fromDateInputValue(toDate) + 86399999,
        category: categoryFilter,
      })
      setExpenses(rows)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load expenses' })
    } finally {
      setLoading(false)
    }
  }, [user, fromDate, toDate, categoryFilter, notify])

  useEffect(() => {
    void load()
  }, [load])

  const total = useMemo(() => round2(expenses.reduce((sum, e) => sum + e.amount, 0)), [expenses])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of expenses) map.set(e.category, round2((map.get(e.category) ?? 0) + e.amount))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [expenses])

  const openCreate = () => {
    setForm({ category: 'Other', description: '', amount: 0, paymentMethod: 'CASH', date: endOfDay(), notes: '' })
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!user) return
    if (!form.description.trim()) {
      toastError('Describe what the expense was for', 'Missing description')
      return
    }
    if (form.amount <= 0) {
      toastError('Amount must be greater than zero', 'Invalid amount')
      return
    }
    setSaving(true)
    try {
      await createExpense({ ...form, storeId: user.storeId, createdBy: user.uid })
      success(`${formatMoney(form.amount, currency)} recorded`, 'Expense saved')
      setFormOpen(false)
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not save expense')
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = () => {
    downloadCsv(
      `expenses-${fromDate}-to-${toDate}.csv`,
      expenses.map((e) => ({
        date: formatDateTime(e.date),
        category: e.category,
        description: e.description,
        amount: e.amount,
        method: e.paymentMethod,
        notes: e.notes,
      })),
    )
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        description={`${expenses.length} entries · total ${formatMoney(total, currency)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add expense
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <Select label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <div className="flex items-end">
          <div className="w-full rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
            {byCategory.slice(0, 2).map(([cat, amt]) => (
              <div key={cat} className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
                <span>{cat}</span>
                <span className="tabular-nums">{formatMoney(amt, currency)}</span>
              </div>
            ))}
            {byCategory.length === 0 && <p className="text-xs text-slate-400">No breakdown yet</p>}
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading expenses…" />
      ) : (
        <DataTable<Expense>
          rowKey={(e) => e.id ?? `${e.date}-${e.description}`}
          rows={expenses}
          emptyState={<EmptyState title="No expenses in this period" message="Record shop costs like rent, salaries and electricity here." />}
          columns={[
            { key: 'date', header: 'Date', render: (e) => formatDateTime(e.date) },
            { key: 'category', header: 'Category', render: (e) => <Badge tone="slate">{e.category}</Badge> },
            { key: 'description', header: 'Description', render: (e) => <span className="max-w-xs truncate">{e.description}</span> },
            { key: 'method', header: 'Paid by', render: (e) => e.paymentMethod },
            { key: 'amount', header: 'Amount', className: 'tabular-nums text-right font-semibold', headerClassName: 'text-right',
              render: (e) => formatMoney(e.amount, currency) },
          ]}
        />
      )}

            {/* Add expense modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add expense"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={submitForm}>Save expense</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Category *" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Input
            label="Amount *"
            type="number"
            min={0}
            inputMode="decimal"
            value={String(form.amount)}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) || 0 })}
            suffix={<span className="text-xs">{currency}</span>}
            autoFocus
          />
          <div className="sm:col-span-2">
            <Input label="Description *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Electricity bill for August…" />
          </div>
          <Select label="Paid by" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as ExpenseDraft['paymentMethod'] })}>
            {PAYMENT_METHODS.filter((m) => m !== 'CREDIT').map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
          <Input
            label="Date"
            type="date"
            value={toDateInputValue(form.date)}
            max={today()}
            onChange={(e) => setForm({ ...form, date: fromDateInputValue(e.target.value) })}
          />
          <div className="sm:col-span-2">
            <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}