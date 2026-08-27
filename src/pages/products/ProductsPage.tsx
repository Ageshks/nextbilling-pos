import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Upload, Power, FileDown } from 'lucide-react'
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
  listProducts,
  createProduct,
  updateProduct,
  setProductActive,
  listCategories,
  listBrands,
  createCategory,
  createBrand,
    parseProductCsv,
  importProducts,
  buildProductCsvTemplate,
  type ImportResult,
} from '../../services/productService'
import { formatMoney } from '../../utils/format'
import { friendlyError } from '../../utils/errors'
import { downloadCsv } from '../../utils/csv'
import { validateProduct, type FieldErrors } from '../../utils/validation'
import { UNITS } from '../../types'
import type { Product, ProductDraft, Category, Brand } from '../../types'

const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28]

interface FormState extends ProductDraft {}

const EMPTY_FORM: FormState = {
  name: '',
  barcode: '',
  sku: '',
  categoryId: '',
  categoryName: '',
  brandId: '',
  brandName: '',
  unit: 'piece',
  purchasePrice: 0,
  sellingPrice: 0,
  mrp: 0,
  gstRate: 0,
  minimumStock: 0,
  maximumStock: 0,
  supplierId: '',
  imageUrl: '',
  description: '',
  active: true,
  trackInventory: true,
  expiryTracking: false,
}

export default function ProductsPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'
  const canEditPrices = user?.role === 'OWNER' || user?.role === 'ADMIN'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cursorRef = useRef<Parameters<typeof listProducts>[2]>(undefined)

  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

    const load = useCallback(
    async (append = false) => {
      if (!user) return
      setLoading(true)
      try {
        const page = await listProducts(user.storeId, 50, append ? cursorRef.current : undefined, !showInactive)
        cursorRef.current = page.lastDoc
        setProducts((prev) => (append ? [...prev, ...page.items] : page.items))
        setHasMore(page.hasMore)
        if (!append) setProducts(page.items)
      } catch (err) {
        notify({ type: 'error', message: friendlyError(err), title: 'Could not load products' })
      } finally {
        setLoading(false)
      }
    },
    [user, showInactive, notify],
  )

  const loadMeta = useCallback(async () => {
    if (!user) return
    try {
      const [cats, brs] = await Promise.all([listCategories(user.storeId), listBrands(user.storeId)])
      setCategories(cats)
      setBrands(brs)
    } catch {
      // Non-fatal: dropdowns just stay empty.
    }
  }, [user])

  useEffect(() => {
    cursorRef.current = undefined
    void load(false)
  }, [load])
  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  const visible = useMemo(() => {
    const t = searchText.trim().toLowerCase()
    if (!t) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.barcode.includes(t) ||
        p.sku.toLowerCase().includes(t) ||
        p.categoryName.toLowerCase().includes(t),
    )
  }, [products, searchText])

    const openCreate = () => {
    setForm({ ...EMPTY_FORM, mrp: 0 })
    setEditingId(null)
    setErrors({})
    setFormOpen(true)
  }

  const openEdit = (p: Product) => {
    setForm({
      name: p.name,
      barcode: p.barcode,
      sku: p.sku,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      brandId: p.brandId,
      brandName: p.brandName,
      unit: p.unit,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      mrp: p.mrp,
      gstRate: p.gstRate,
      minimumStock: p.minimumStock,
      maximumStock: p.maximumStock,
      supplierId: p.supplierId,
      imageUrl: p.imageUrl,
      description: p.description,
      active: p.active,
      trackInventory: p.trackInventory ?? true,
      expiryTracking: p.expiryTracking ?? false,
    })
    setEditingId(p.id ?? null)
    setErrors({})
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!user) return
    const errs = validateProduct(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      const catName = categories.find((c) => c.id === form.categoryId)?.name ?? ''
      const brandName = brands.find((b) => b.id === form.brandId)?.name ?? ''
      const payload: ProductDraft = { ...form, categoryName: catName, brandName }
      if (editingId) {
        await updateProduct(editingId, payload, user.uid)
        success(`${form.name} updated`, 'Product saved')
      } else {
        await createProduct(user.storeId, payload, user.uid)
        success(`${form.name} created. Set opening stock via Purchases or Inventory.`, 'Product saved')
      }
      setFormOpen(false)
      void load(false)
    } catch (err) {
      toastError(friendlyError(err), 'Could not save product')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (p: Product) => {
    if (!user) return
    try {
      await setProductActive(p.id ?? '', !p.active, user.uid)
      success(`${p.name} ${p.active ? 'deactivated' : 'activated'}`, 'Updated')
      void load(false)
    } catch (err) {
      toastError(friendlyError(err), 'Update failed')
    }
  }

  const handleImportFile = async (file: File) => {
    if (!user) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const rows = parseProductCsv(text)
      if (rows.length === 0) {
        toastError('No usable rows found. Check the template for the expected columns.', 'Import failed')
        return
      }
                  const categoryMap: Record<string, string> = {}
      const brandMap: Record<string, string> = {}
      for (const c of categories) if (c.id) categoryMap[c.name.toLowerCase()] = c.id
      for (const b of brands) if (b.id) brandMap[b.name.toLowerCase()] = b.id
      const result = await importProducts(user.storeId, rows, categoryMap, brandMap, user.uid, (done: number, total: number) => {
        if (done % 10 === 0 || done === total) console.log(`Import progress ${done}/${total}`)
      })
      setImportResult(result)
      success(`Import finished: ${result.created} created, ${result.updated} updated`, 'CSV import')
      void load(false)
      void loadMeta()
    } catch (err) {
      toastError(friendlyError(err), 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        description={`${visible.length} shown${hasMore ? ' (more available)' : ''}`}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleImportFile(f)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              leftIcon={<FileDown className="h-4 w-4" />}
              onClick={() => downloadCsv('product-template.csv', [Object.fromEntries(buildProductCsvTemplate().split('\n')[0].split(',').map((h) => [h, ''])) as Record<string, string | number>])}
            >
              Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Upload className="h-4 w-4" />}
              loading={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              Import CSV
            </Button>
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add product
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Input label="Search" placeholder="Name, barcode, SKU or category…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <Button variant={showInactive ? 'secondary' : 'outline'} size="sm" onClick={() => setShowInactive((v) => !v)}>
          {showInactive ? 'Showing inactive' : 'Active only'}
        </Button>
      </div>

      {loading && products.length === 0 ? (
        <Spinner label="Loading products…" />
      ) : (
        <>
          <DataTable<Product>
            rowKey={(p) => p.id ?? p.barcode}
            rows={visible}
            emptyState={<EmptyState title="No products yet" message="Add your first product or import a CSV from your supplier." />}
            columns={[
              {
                key: 'name',
                header: 'Product',
                render: (p) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {p.barcode || p.sku || '—'} · {p.categoryName || 'Uncategorised'}
                    </p>
                  </div>
                ),
              },
              { key: 'price', header: 'Price', className: 'tabular-nums text-right', headerClassName: 'text-right',
                render: (p) => (
                  <div>
                    <p className="font-semibold tabular-nums">{formatMoney(p.sellingPrice, currency)}</p>
                    <p className="text-xs text-slate-500 tabular-nums">GST {p.gstRate}%</p>
                  </div>
                ) },
              { key: 'stock', header: 'Stock', className: 'tabular-nums text-right', headerClassName: 'text-right',
                render: (p) => {
                  const tone = p.stock <= 0 ? 'red' : p.stock <= p.minimumStock ? 'amber' : 'emerald'
                  return <Badge tone={tone} className="tabular-nums">{p.stock} {p.unit}</Badge>
                } },
              { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.active ? 'active' : 'inactive')}>{p.active ? 'Active' : 'Inactive'}</Badge> },
              {
                key: 'actions',
                header: '',
                render: (p) => (
                  <div className="flex justify-end gap-1">
                    <Button size="xs" variant="ghost" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => openEdit(p)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="ghost" leftIcon={<Power className="h-3 w-3" />} onClick={() => toggleActive(p)}>
                      {p.active ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" loading={loading} onClick={() => void load(true)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {importResult && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <p className="font-semibold text-slate-800 dark:text-slate-200">Last import</p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            {importResult.created} created · {importResult.updated} updated · {importResult.skipped} skipped
            {importResult.errors.length > 0 && ` · ${importResult.errors.length} errors`}
          </p>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-600 dark:text-red-400">
              {importResult.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

            {/* Product form modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit product' : 'Add product'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={submitForm}>{editingId ? 'Save changes' : 'Create product'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Product name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoFocus />
          </div>
          <Input label="Barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} inputMode="numeric" placeholder="Scan or type…" />
          <Input label="SKU / code" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => {
              const cat = categories.find((c) => c.id === e.target.value)
              if (cat) {
                setForm((f) => ({ ...f, categoryId: cat.id ?? '', categoryName: cat.name }))
              } else {
                // "New category…" option
                const name = window.prompt('New category name')
                if (name && user) {
                  void createCategory(user.storeId, name).then((id) => {
                    void loadMeta()
                    setForm((f) => ({ ...f, categoryId: id, categoryName: name.trim() }))
                  })
                }
              }
            }}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="__new__">+ New category…</option>
          </Select>
          <Select
            label="Brand"
            value={form.brandId}
            onChange={(e) => {
              const brand = brands.find((b) => b.id === e.target.value)
              if (brand) {
                setForm((f) => ({ ...f, brandId: brand.id ?? '', brandName: brand.name }))
              } else {
                const name = window.prompt('New brand name')
                if (name && user) {
                  void createBrand(user.storeId, name).then((id) => {
                    void loadMeta()
                    setForm((f) => ({ ...f, brandId: id, brandName: name.trim() }))
                  })
                }
              }
            }}
          >
            <option value="">— None —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
            <option value="__new__">+ New brand…</option>
          </Select>
          <Select label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as ProductDraft['unit'] })}>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </Select>
          <Select label="GST rate %" value={String(form.gstRate)} onChange={(e) => setForm({ ...form, gstRate: Number(e.target.value) })}>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>{r}%</option>
            ))}
          </Select>
          <Input label="Purchase price *" value={canEditPrices ? String(form.purchasePrice) : String(form.purchasePrice)} disabled={!canEditPrices} type="number" min={0} inputMode="decimal" error={errors.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) || 0 })} suffix={<span className="text-xs">{currency}</span>} />
          <Input label="Selling price *" type="number" min={0} inputMode="decimal" value={String(form.sellingPrice)} error={errors.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) || 0 })} suffix={<span className="text-xs">{currency}</span>} />
          <Input label="MRP" type="number" min={0} inputMode="decimal" value={String(form.mrp)} onChange={(e) => setForm({ ...form, mrp: Number(e.target.value) || 0 })} suffix={<span className="text-xs">{currency}</span>} />
          <Input label="Minimum stock alert" type="number" min={0} inputMode="numeric" value={String(form.minimumStock)} error={errors.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: Number(e.target.value) || 0 })} />
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 dark:text-slate-300">
            <input type="checkbox" checked={form.trackInventory} onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Track inventory (deduct stock on sale)
          </label>
        </div>
      </Modal>
    </div>
  )
}