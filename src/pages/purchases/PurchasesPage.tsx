import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge, statusTone } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import {
  listPurchases,
  createPurchase,
  type PurchaseDraft,
} from '../../services/purchaseService'
import type { PurchaseItem } from '../../types/purchase'
import { createSupplier } from '../../services/supplierService'
import { searchProducts, createProduct } from '../../services/productService'
import { formatMoney, formatDateTime, toDateInputValue, fromDateInputValue } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import { UNITS, type Purchase, type Product, type ProductDraft, type Unit } from '../../types'
import { useSuppliers } from '../../hooks/useSuppliers'
import { aiPurchasePrefillKey } from '../../types/insight'

interface DraftLine {
  productId: string
  name: string
  unit: string
  quantity: number
  purchasePrice: number
  gstRate: number
}

export default function PurchasesPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [fromDate, setFromDate] = useState(toDateInputValue(Date.now() - 29 * 86400000))
  const [toDate, setToDate] = useState(toDateInputValue(Date.now()))

    // New-purchase modal state
  const [open, setOpen] = useState(false)
    const { suppliers, loading: suppliersLoading, error: suppliersError } = useSuppliers(user?.storeId)
  const [supplierId, setSupplierId] = useState('')
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(toDateInputValue(Date.now()))
  const [paidAmount, setPaidAmount] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [searchingProducts, setSearchingProducts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const debounceRef = useRef<number | undefined>(undefined)

  // Quick product creation from within the purchase editor
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickSaving, setQuickSaving] = useState(false)
  const [qName, setQName] = useState('')
  const [qUnit, setQUnit] = useState<Unit>('piece')
  const [qPurchasePrice, setQPurchasePrice] = useState('')
  const [qSellingPrice, setQSellingPrice] = useState('')
  const [qGstRate, setQGstRate] = useState('0')

  // Quick supplier creation from within the purchase editor (replaces system prompt)
  const [newSupOpen, setNewSupOpen] = useState(false)
  const [newSupName, setNewSupName] = useState('')
  const [newSupSaving, setNewSupSaving] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await listPurchases({
        storeId: user.storeId,
        from: fromDateInputValue(fromDate),
        to: fromDateInputValue(toDate) + 86399999,
        max: 200,
      })
      setPurchases(rows)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load purchases' })
    } finally {
      setLoading(false)
    }
  }, [user, fromDate, toDate, notify])

    useEffect(() => {
    void load()
  }, [load])

    // Surface supplier-list failures (live listener) so they are never silent.
  useEffect(() => {
    if (suppliersError) {
      notify({ type: 'error', message: suppliersError, title: 'Could not load suppliers' })
    }
  }, [suppliersError, notify])

  const draftTotals = useMemo(() => {
    let subtotal = 0
    let gst = 0
    for (const l of lines) {
      const taxable = round2(l.purchasePrice * l.quantity)
      const g = round2((taxable * l.gstRate) / 100)
      subtotal = round2(subtotal + taxable)
      gst = round2(gst + g)
    }
    return { subtotal, gst, total: round2(subtotal + gst) }
  }, [lines])

  // Debounced product search inside the purchase editor
  useEffect(() => {
    if (!user) return
    window.clearTimeout(debounceRef.current)
    const text = productQuery.trim()
    if (text.length < 2) {
      setProductResults([])
      return
    }
    debounceRef.current = window.setTimeout(() => {
      setSearchingProducts(true)
      searchProducts(user.storeId, text, true, 200)
        .then(setProductResults)
        .catch(() => setProductResults([]))
        .finally(() => setSearchingProducts(false))
    }, 220)
    return () => window.clearTimeout(debounceRef.current)
  }, [productQuery, user])

  const addLine = (p: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id)
      if (existing) {
        return prev.map((l) => (l.productId === p.id ? { ...l, quantity: round2(l.quantity + 1) } : l))
      }
      return [
        ...prev,
        { productId: p.id ?? '', name: p.name, unit: p.unit, quantity: 1, purchasePrice: p.purchasePrice || 0, gstRate: p.gstRate },
      ]
    })
    setProductQuery('')
    setProductResults([])
  }

  // Creates a minimal catalogue product on the fly and drops it onto this
  // purchase as a line. Barcode/category/brand can be completed later in
  // Products — this only asks for what a stock-in needs.
  const submitQuickProduct = async () => {
    if (!user) return
    const name = qName.trim()
    const purchasePrice = round2(parseFloat(qPurchasePrice) || 0)
    const sellingPrice = round2(parseFloat(qSellingPrice) || 0)
    if (!name) {
      toastError('Product name is required', 'Missing name')
      return
    }
    if (sellingPrice <= 0) {
      toastError('Enter a selling price greater than zero', 'Invalid price')
      return
    }
    setQuickSaving(true)
    try {
      const draft: ProductDraft = {
        name,
        barcode: '',
        sku: '',
        categoryId: '',
        categoryName: '',
        brandId: '',
        brandName: '',
        unit: qUnit,
        purchasePrice,
        sellingPrice,
        mrp: sellingPrice,
        gstRate: parseFloat(qGstRate) || 0,
        minimumStock: 5,
        maximumStock: 0,
        supplierId: supplierId === '__new__' ? '' : supplierId,
        imageUrl: '',
        description: '',
        active: true,
        trackInventory: true,
        expiryTracking: false,
      }
      const id = await createProduct(user.storeId, draft, user.uid)
      addLine({ id, name, unit: qUnit, stock: 0, purchasePrice, gstRate: draft.gstRate } as Product)
      setQuickOpen(false)
      setQName('')
      setQPurchasePrice('')
      setQSellingPrice('')
      setQGstRate('0')
      success(`${name} added to this purchase`, 'Product created')
    } catch (err) {
      toastError(friendlyError(err), 'Could not create product')
    } finally {
      setQuickSaving(false)
    }
  }

  const submitNewSupplier = async () => {
    if (!user) return
    const name = newSupName.trim()
    if (!name) {
      toastError('Enter the supplier name', 'Missing name')
      return
    }
    setNewSupSaving(true)
    try {
      const id = await createSupplier(
        user.storeId,
        { name, company: '', phone: '', email: '', address: '', gstNumber: '', notes: '' },
        user.uid,
      )
      setSupplierId(id) // live useSuppliers listener lists it; select it immediately
      setNewSupOpen(false)
      setNewSupName('')
      success(`${name} is selected for this purchase`, 'Supplier created')
    } catch (err) {
      toastError(friendlyError(err), 'Could not create supplier')
    } finally {
      setNewSupSaving(false)
    }
  }

  const submitPurchase = async () => {
    if (!user) return
    if (lines.length === 0) {
      toastError('Add at least one product line', 'Nothing to purchase')
      return
    }
    const paid = round2(parseFloat(paidAmount) || 0)
    if (paid > draftTotals.total + 0.001) {
      toastError('Paid amount exceeds the purchase total', 'Invalid payment')
      return
    }
    setSubmitting(true)
    try {
      // `__new__` is handled by the quick-create dialog before submit.
      const sid = supplierId === '__new__' ? '' : supplierId
      const supplierName = suppliers.find((s) => s.id === sid)?.name ?? ''
      const items: PurchaseItem[] = lines.map((l) => {
        const taxable = round2(l.purchasePrice * l.quantity)
        const gstAmount = round2((taxable * l.gstRate) / 100)
        return { productId: l.productId, name: l.name, unit: l.unit, quantity: l.quantity, purchasePrice: round2(l.purchasePrice), gstRate: l.gstRate, gstAmount, lineTotal: round2(taxable + gstAmount) }
      })
      const draft: PurchaseDraft = {
        storeId: user.storeId,
        supplierId: sid,
        supplierName,
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        purchaseDate: fromDateInputValue(purchaseDate),
        items,
        subtotal: draftTotals.subtotal,
        discount: 0,
        gstAmount: draftTotals.gst,
        total: draftTotals.total,
        paidAmount: paid,
        notes: '',
        createdBy: user.uid,
      }
      await createPurchase(draft)
      success(`${items.length} products received · stock updated`, 'Purchase saved')
      setOpen(false)
      resetDraft()
            void load()
      // No manual refresh — useSuppliers live-listener reflects new suppliers.
    } catch (err) {
      toastError(friendlyError(err), 'Could not save purchase')
    } finally {
      setSubmitting(false)
    }
  }

  // Consume AI-staged reorder suggestions handed off from AI Insights.
  // They only PRE-FILL the editor below — the real purchase is still created by
  // the user explicitly submitting this form (createPurchase transaction).
  useEffect(() => {
    if (!user?.storeId) return
    const key = aiPurchasePrefillKey(user.storeId)
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {
      return
    }
    if (!raw) return
    localStorage.removeItem(key)
    try {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
      const valid =
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((l) => typeof l.productId === 'string' && l.productId !== '' && Number(l.quantity) > 0)
      if (!valid) throw new Error('invalid staged list')
      setLines(
        parsed.map((l) => ({
          productId: String(l.productId),
          name: String(l.name ?? ''),
          unit: String(l.unit ?? ''),
          quantity: Math.max(1, Math.ceil(Number(l.quantity))),
          purchasePrice: Math.max(0, Number(l.purchasePrice) || 0),
          gstRate: Math.max(0, Number(l.gstRate) || 0),
        })),
      )
      setSupplierId('')
      setSupplierInvoiceNumber('')
      setPaidAmount('')
      setOpen(true)
      notify({
        type: 'info',
        message: `${parsed.length} AI reorder suggestion(s) loaded as draft lines. Pick a supplier, review quantities and confirm to create the purchase.`,
        title: 'From AI Insights',
      })
    } catch {
      notify({ type: 'error', message: 'The staged AI purchase list was unreadable and was skipped.', title: 'AI hand-off' })
    }
  }, [notify, user])

  const openNewPurchase = () => {
    resetDraft()
    setOpen(true)
  }

  const resetDraft = () => {
    setLines([])
    setProductQuery('')
    setProductResults([])
    setPaidAmount('')
    setSupplierInvoiceNumber('')
    setSupplierId(suppliers[0]?.id ?? '')
    setPurchaseDate(toDateInputValue(Date.now()))
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        description={`${purchases.length} purchase orders`}
        actions={
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openNewPurchase}>
            New purchase
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </div>

      {loading ? (
        <Spinner label="Loading purchases…" />
      ) : (
        <DataTable<Purchase>
          rowKey={(p) => p.id ?? p.purchaseNumber}
          rows={purchases}
          emptyState={<EmptyState title="No purchases in this period" message="Record stock you receive from suppliers — inventory updates automatically." />}
          columns={[
            { key: 'number', header: 'PO #', render: (p) => <span className="font-medium tabular-nums">{p.purchaseNumber}</span> },
            { key: 'date', header: 'Date', render: (p) => formatDateTime(p.createdAt ?? p.purchaseDate) },
            { key: 'supplier', header: 'Supplier', render: (p) => p.supplierName || '—' },
            { key: 'invoice', header: 'Their invoice', render: (p) => p.supplierInvoiceNumber || '—' },
            { key: 'total', header: 'Total', className: 'tabular-nums text-right', headerClassName: 'text-right',
              render: (p) => formatMoney(p.total, currency) },
            { key: 'status', header: 'Payment', render: (p) => (
              <div className="flex flex-col items-start gap-1">
                <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                <span className="text-xs text-slate-500 tabular-nums">paid {formatMoney(p.paidAmount, currency)}</span>
              </div>
            ) },
          ]}
        />
      )}

            {/* New purchase modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record purchase (stock in)"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={submitting} onClick={submitPurchase} disabled={lines.length === 0}>
              Save purchase · {formatMoney(draftTotals.total, currency)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
                label="Supplier"
                value={supplierId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewSupOpen(true)
                  } else {
                    setSupplierId(e.target.value)
                  }
                }}
                disabled={suppliersLoading}
              >
                <option value="">— Select —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                <option value="__new__">+ New supplier…</option>
              </Select>
            <Input label="Supplier invoice #" value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} />
            <Input label="Purchase date" type="date" value={purchaseDate} max={toDateInputValue(Date.now())} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>

          {/* Product search + quick create */}
          <div className="relative">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="Find product"
                  placeholder="Search by name, barcode or SKU…"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  suffix={searchingProducts ? <span className="text-xs text-slate-400">…</span> : undefined}
                />
              </div>
              <Button type="button" variant="outline" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setQuickOpen(true)}>
                New product
              </Button>
            </div>
            {productResults.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                {productResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addLine(p)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{p.name}</span>
                        <span className="ml-2 text-xs text-slate-500">{p.barcode || p.sku || ''}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        stock {p.stock} · {formatMoney(p.purchasePrice, currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500 dark:border-slate-600">
              Search and pick products to build this purchase.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2 w-20 text-right">Qty</th>
                    <th className="px-2 py-2 w-28 text-right">Cost/unit</th>
                    <th className="px-2 py-2 w-20 text-right">GST%</th>
                    <th className="px-2 py-2 w-24 text-right">Line total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {lines.map((l, idx) => {
                    const taxable = round2(l.purchasePrice * l.quantity)
                    const gst = round2((taxable * l.gstRate) / 100)
                    return (
                      <tr key={l.productId}>
                        <td className="px-2 py-1.5">{l.name}</td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            value={String(l.quantity)}
                            onChange={(e) =>
                              setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) || 0 } : x)))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            value={String(l.purchasePrice)}
                            onChange={(e) =>
                              setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, purchasePrice: Number(e.target.value) || 0 } : x)))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.gstRate}%</td>
                        <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatMoney(round2(taxable + gst), currency)}</td>
                        <td className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            aria-label={`Remove ${l.name}`}
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals + payment */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="flex justify-between gap-8"><span className="text-slate-500">Taxable</span><span className="tabular-nums">{formatMoney(draftTotals.subtotal, currency)}</span></div>
              <div className="flex justify-between gap-8"><span className="text-slate-500">GST</span><span className="tabular-nums">{formatMoney(draftTotals.gst, currency)}</span></div>
              <div className="flex justify-between gap-8 border-t border-slate-200 pt-1 font-bold dark:border-slate-700"><span>Total</span><span className="tabular-nums">{formatMoney(draftTotals.total, currency)}</span></div>
            </div>
            <Input
              label="Amount paid now"
              type="number"
              min={0}
              inputMode="decimal"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              suffix={<span className="text-xs">{currency}</span>}
              hint={draftTotals.total - (parseFloat(paidAmount) || 0) > 0 ? `${formatMoney(round2(draftTotals.total - (parseFloat(paidAmount) || 0)), currency)} will be added to supplier payable` : 'Fully paid'}
              className="sm:w-56"
            />
          </div>
        </div>
      </Modal>

      {/* Quick product creation (from inside the purchase editor) */}
      <Modal
        open={quickOpen}
        onClose={() => {
          if (!quickSaving) setQuickOpen(false)
        }}
        title="New product"
        footer={
          <>
            <Button variant="outline" disabled={quickSaving} onClick={() => setQuickOpen(false)}>
              Cancel
            </Button>
            <Button loading={quickSaving} onClick={() => void submitQuickProduct()}>
              Create & add line
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Product name" value={qName} onChange={(e) => setQName(e.target.value)} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Purchase price (₹)" type="number" inputMode="decimal" min={0} value={qPurchasePrice} onChange={(e) => setQPurchasePrice(e.target.value)} />
            <Input label="Selling price (₹)" type="number" inputMode="decimal" min={0} value={qSellingPrice} onChange={(e) => setQSellingPrice(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Unit" value={qUnit} onChange={(e) => setQUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
            <Select label="GST rate" value={qGstRate} onChange={(e) => setQGstRate(e.target.value)}>
              {['0', '5', '12', '18', '28'].map((r) => (
                <option key={r} value={r}>{r}%</option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The product is created in your catalogue immediately and added to this purchase with quantity 1 — adjust quantity and cost in the lines table. Barcode, category and brand can be completed later in Products.
          </p>
        </div>
      </Modal>

      {/* New supplier — in-app dialog (replaces the old window.prompt) */}
      <Modal
        open={newSupOpen}
        onClose={() => setNewSupOpen(false)}
        title="New supplier"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewSupOpen(false)}>Cancel</Button>
            <Button loading={newSupSaving} onClick={() => void submitNewSupplier()}>Create supplier</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Supplier name"
            placeholder="e.g. Sri Traders"
            value={newSupName}
            onChange={(e) => setNewSupName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewSupplier()
            }}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The supplier is created and selected for this purchase. Phone, GST and other details can be added later in Suppliers.
          </p>
        </div>
      </Modal>
    </div>
  )
}