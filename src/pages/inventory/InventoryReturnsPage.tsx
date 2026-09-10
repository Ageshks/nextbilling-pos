import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Eye, FileText, Package, Plus, RefreshCw, Search, X, Check } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import { uploadImage, makeImagePath, optimizeImage } from '../../firebase/storage'
import {
  createInventoryReturn,
  listInventoryReturns,
  getInventoryReturn,
  approveInventoryReturn,
  rejectInventoryReturn,
  progressInventoryReturn,
  cancelInventoryReturn,
  bucketByExpiry,
  observeInventory,
} from '../../services/inventoryReturnService'
import { searchProducts } from '../../services/productService'
import { useSuppliers } from '../../hooks/useSuppliers'
import { logAudit } from '../../services/auditService'
import { formatMoney, formatDateTime, formatDate } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import type { Product } from '../../types/product'
import type {
  InventoryReturn,
  InventoryReturnReason,
  InventoryCondition,
  InventoryReturnKind,
  InventoryReturnStatus,
  ExpiryBucket,
  InventoryObservation,
} from '../../types/inventoryReturn'
import { INVENTORY_RETURN_REASONS, INVENTORY_CONDITIONS, INVENTORY_RETURN_TRANSITIONS } from '../../types/inventoryReturn'

type Tab = 'expiry' | 'new' | 'history'

const REASON_LABELS: Record<InventoryReturnReason, string> = {
  EXPIRED: 'Expired', DAMAGED: 'Damaged', DEFECTIVE: 'Defective', SPOILED: 'Spoiled',
  BROKEN: 'Broken', PACKAGING_DAMAGED: 'Packaging Damaged', QUALITY_ISSUE: 'Quality Issue',
  STOCK_DISCREPANCY: 'Stock Discrepancy', SUPPLIER_RETURN: 'Supplier Return', OTHER: 'Other',
}

const CONDITION_LABELS: Record<InventoryCondition, string> = {
  DAMAGED: 'Damaged', EXPIRED: 'Expired', QUARANTINED: 'Quarantined',
  SUPPLIER_RETURN: 'Supplier Return', WRITTEN_OFF: 'Written Off',
}

const STATUS_TONE: Record<InventoryReturnStatus, 'slate' | 'amber' | 'emerald' | 'red' | 'indigo'> = {
  DRAFT: 'slate', PENDING_APPROVAL: 'amber', APPROVED: 'indigo', SENT_TO_SUPPLIER: 'indigo',
  SUPPLIER_ACCEPTED: 'indigo', CREDIT_RECEIVED: 'emerald', REPLACEMENT_RECEIVED: 'emerald',
  COMPLETED: 'emerald', REJECTED: 'red', CANCELLED: 'slate',
}

function statusLabel(s: InventoryReturnStatus) {
  return s.replaceAll('_', ' ').replace(/^[a-z]/, (m: string) => m.toUpperCase())
}

function StatusCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60 ${className}`}>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  )
}

export default function InventoryReturnsPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'
  const [tab, setTab] = useState<Tab>('expiry')
  const [returns, setReturns] = useState<InventoryReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    if (!user?.storeId) return
    setLoading(true)
    try {
      const data = await listInventoryReturns({ storeId: user.storeId, max: 200 })
      setReturns(data)
    } catch (err) {
      toastError(friendlyError(err), 'Could not load returns')
    } finally {
      setLoading(false)
    }
  }, [user?.storeId, toastError])

  useEffect(() => {
    if (tab === 'history') void load()
  }, [tab, load])

  const refresh = () => {
    setRefreshKey((k) => k + 1)
    void load()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory Returns"
        description="Remove expired, damaged, or unusable stock from sellable inventory. Every change is recorded immutably — no customer refunds."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setTab('new')}>
            New return
          </Button>
        }
      />
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {([
          { id: 'expiry', label: 'Expiry Dashboard', icon: <Package className="h-4 w-4" /> },
          { id: 'new', label: 'New Return', icon: <Plus className="h-4 w-4" /> },
          { id: 'history', label: 'History', icon: <FileText className="h-4 w-4" /> },
        ] as Array<{ id: Tab; label: string; icon: React.ReactNode }>).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
      {tab === 'expiry' && <ExpiryDashboard key={refreshKey} onNewReturn={() => setTab('new')} currency={currency} />}
      {tab === 'new' && <CreateReturnForm key={refreshKey} onDone={refresh} onCancel={() => setTab('expiry')} currency={currency} />}
      {tab === 'history' && <ReturnsHistory returns={returns} loading={loading} onRefresh={refresh} currency={currency} />}
    </div>
  )
}

function ExpiryDashboard({ onNewReturn, currency }: { onNewReturn: () => void; currency: string }) {
  const { user } = useAuth()
  const { error: toastError } = useToast()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [returns, setReturns] = useState<InventoryReturn[]>([])

  const load = useCallback(async () => {
    if (!user?.storeId) return
    setLoading(true)
    try {
      const res = await import('../../services/productService').then((m) => m.listProducts(user.storeId, 200))
      setProducts(res.items)
      const rets = await listInventoryReturns({ storeId: user.storeId, max: 200 })
      setReturns(rets)
    } catch (err) {
      toastError(friendlyError(err), 'Could not load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [user?.storeId, toastError])

  useEffect(() => { void load() }, [load])

  const buckets = useMemo(() => bucketByExpiry(products.map((p) => ({ id: p.id ?? '', name: p.name, sku: p.sku ?? '', stock: p.stock, expiryDate: p.expiryDate ?? null, purchasePrice: p.purchasePrice ?? 0 }))), [products])
  const observations = useMemo(() => observeInventory(returns, buckets), [returns, buckets])

  return (
    <div className="space-y-4">
      {loading ? (
        <Spinner label="Loading expiry data…" />
      ) : observations.length > 0 ? (
        <div className="space-y-2">
          {observations.map((o: InventoryObservation, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              {o.message}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No expiry concerns" message="All products are within their shelf life." />
      )}

      {buckets.filter((b: ExpiryBucket) => b.products.length > 0).map((b) => (
        <StatusCard key={b.key}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{b.title}</h3>
          <div className="space-y-2">
            {b.products.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500">SKU {p.sku} · {p.stock} units · expires {formatDate(p.expiryDate)}</p>
                </div>
                <span className="text-sm font-medium tabular-nums text-red-600 dark:text-red-400">{formatMoney(p.value, currency)}</span>
              </div>
            ))}
            {b.products.length > 8 && <p className="text-xs text-slate-500">+{b.products.length - 8} more</p>}
          </div>
        </StatusCard>
      ))}
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={onNewReturn}>Move expired stock</Button>
    </div>
  )
}

function CreateReturnForm({ onDone, onCancel, currency }: { onDone: () => void; onCancel: () => void; currency: string }) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const { suppliers } = useSuppliers(user?.storeId)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [product, setProduct] = useState<Product | null>(null)

  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<InventoryReturnReason>('EXPIRED')
  const [condition, setCondition] = useState<InventoryCondition>('EXPIRED')
  const [notes, setNotes] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [kind, setKind] = useState<InventoryReturnKind>('STOCK_CONDITION')
  const [supplierId, setSupplierId] = useState('')
  const [supplierReference, setSupplierReference] = useState('')
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!user?.storeId || search.trim().length < 2) { setResults([]); return }
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      try { const r = await searchProducts(user.storeId, search.trim(), false, 40); if (active) setResults(r) }
      catch { if (active) setResults([]) }
      finally { if (active) setSearching(false) }
    }, 200)
    return () => { active = false; clearTimeout(t); setSearching(false) }
  }, [search, user?.storeId])

  const purchasePrice = product?.purchasePrice ?? 0
  const qty = Number(quantity) || 0
  const value = round2(qty * purchasePrice)
  const needsSupplier = kind === 'SUPPLIER_RETURN'
  const needsReason = reason === 'OTHER'

  const submit = async () => {
    if (!user || !product) return
    if (!product.stock || product.stock <= 0) { toastError('This product has no sellable stock to remove.', 'No stock'); return }
    setSubmitting(true); setUploading(true)
    try {
      let evidenceUrls: string[] = []
      if (evidenceFiles.length > 0) {
        evidenceUrls = await Promise.all(evidenceFiles.map(async (f) => {
          const blob = await optimizeImage(f)
          return uploadImage(makeImagePath(user.storeId, 'evidence', f.name), blob)
        }))
      }
      setUploading(false)
      const supplier = suppliers.find((s) => s.id === supplierId)
      await createInventoryReturn({
        storeId: user.storeId, kind,
        productId: product.id ?? '', productName: product.name, sku: product.sku ?? '',
        categoryId: product.categoryId ?? '', categoryName: product.categoryName ?? '',
        batchNumber: product.batchNumber ?? '', expiryDate: product.expiryDate ?? null,
        purchaseDate: product.createdAt ?? null,
        supplierId: supplier?.id ?? product.supplierId ?? '', supplierName: supplier?.name ?? '',
        quantity: qty, purchasePrice, reason, condition, notes, evidenceUrls,
        supplierReference: supplierReference.trim(), returnDate: new Date(returnDate).getTime(),
        actor: { uid: user.uid, name: user.name },
      })
      await logAudit({ storeId: user.storeId, userId: user.uid, userName: user.name, action: 'INVENTORY_RETURN_CREATED', entityType: 'inventoryReturn', entityId: product.id ?? '', metadata: { quantity: qty, reason, condition, value: round2(value) } })
      success(`${product.name} × ${qty} removed from sellable stock`, 'Return recorded')
      onDone()
    } catch (err) { toastError(friendlyError(err), 'Could not record return') }
    finally { setSubmitting(false); setUploading(false) }
  }




  const canSubmit = product && qty > 0 && qty <= (product.stock ?? 0) && (needsReason ? notes.trim().length > 0 : true) && (needsSupplier ? supplierId !== '' : true) && !submitting

  return (
    <div className="space-y-4">
      <StatusCard>
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">1 · Search product</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (e.target.value.length < 2) { setProduct(null); setResults([]) } }}
            placeholder="Scan or type product name, SKU, or barcode…"
            className="pl-9"
            disabled={submitting}
          />
        </div>
        {searching && <p className="text-xs text-slate-500">Searching…</p>}
        {results.length > 0 && !product && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
            {results.map((p) => (
              <button key={p.id} type="button"
                onClick={() => { setProduct(p); setSearch(p.name); setResults([]) }}
                className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                  <span className="block truncate text-xs text-slate-500">{p.sku ? `SKU ${p.sku}` : 'No SKU'} · {p.categoryName ?? 'Uncategorized'}</span>
                </span>
                <Badge tone={p.stock > 0 ? 'emerald' : 'red'}>{p.stock} sellable</Badge>
              </button>
            ))}
          </div>
        )}
      </StatusCard>

      {product && (
        <StatusCard>
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">2 · Product details</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Product" value={product.name} />
            <Field label="SKU" value={product.sku || '—'} />
            <Field label="Category" value={product.categoryName || '—'} />
            <Field label="Sellable stock" value={`${product.stock}`} />
            <Field label="Damaged" value={`${product.stockDamaged ?? 0}`} />
            <Field label="Expired" value={`${product.stockExpired ?? 0}`} />
            <Field label="Batch" value={product.batchNumber || '—'} />
            <Field label="Expiry" value={product.expiryDate ? formatDate(product.expiryDate) : '—'} />
            <Field label="Purchase price" value={formatMoney(product.purchasePrice, currency)} />
          </div>
        </StatusCard>
      )}

      <StatusCard>
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">3 · Return details</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input type="number" min={0} inputMode="decimal" label="Quantity to remove" value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            suffix={product ? ` of ${product.stock} sellable` : ''}
            disabled={submitting} />
          <Select label="Reason" value={reason}
            onChange={(e) => setReason(e.target.value as InventoryReturnReason)} disabled={submitting}>
            {INVENTORY_RETURN_REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
          </Select>
          <Select label="Condition after removal" value={condition}
            onChange={(e) => setCondition(e.target.value as InventoryCondition)} disabled={submitting}>
            {INVENTORY_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
          </Select>
          <Select label="Return type" value={kind}
            onChange={(e) => setKind(e.target.value as InventoryReturnKind)} disabled={submitting}>
            <option value="STOCK_CONDITION">Stock condition (damage/expiry)</option>
            <option value="SUPPLIER_RETURN">Supplier return (credit note)</option>
            <option value="WRITE_OFF">Write-off (loss)</option>
          </Select>
          {needsSupplier && (
            <>
              <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={submitting}>
                <option value="">Select supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id ?? ''}>{s.name}</option>)}
              </Select>
              <Input label="Supplier reference" placeholder="GRN / delivery note" value={supplierReference}
                onChange={(e) => setSupplierReference(e.target.value)} disabled={submitting} />
            </>
          )}
          <Input label="Return date" type="date" value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)} disabled={submitting} />
          <Input label="Notes" placeholder={needsReason ? 'Required — describe the issue' : 'Optional'} value={notes}
            onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
        </div>
      </StatusCard>

      <StatusCard>
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">4 · Evidence (optional)</h3>
        <label className="cursor-pointer rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/40">
          Add photos
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length + evidenceFiles.length > 5) { toastError('At most 5 evidence photos.', 'Too many files'); return }
              setEvidenceFiles((prev) => [...prev, ...files])
            }} disabled={submitting} />
        </label>
        {evidenceFiles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {evidenceFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-slate-700">
                {f.name}
                <button type="button" onClick={() => setEvidenceFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-500" aria-label={`Remove ${f.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </StatusCard>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Total value: <span className="font-medium">{formatMoney(value, currency)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button leftIcon={<Check className="h-4 w-4" />} onClick={submit} disabled={!canSubmit} loading={submitting}>
            {uploading ? 'Uploading…' : `Record return${value > 0 ? ` · ${formatMoney(value, currency)}` : ''}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ReturnsHistory({ returns, loading, onRefresh, currency }: {
  returns: InventoryReturn[]
  loading: boolean
  onRefresh: () => void
  currency: string
}) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const [detailOpen, setDetailOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<InventoryReturn | null>(null)
  const [reason, setReason] = useState('')
  const [creditNote, setCreditNote] = useState('')
  const [busy, setBusy] = useState(false)
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN'

  const openDetail = async (id: string) => {
    const d = await getInventoryReturn(id)
    setDetail(d)
    setReason('')
    setCreditNote('')
    setDetailOpen(id)
  }

  const closeDetail = () => {
    if (busy) return
    setDetailOpen(null)
    setDetail(null)
  }

  const transitions = detail ? (INVENTORY_RETURN_TRANSITIONS[detail.status] ?? []) : []
  const canProgress = transitions.filter((t) => t !== 'CANCELLED').length > 0
  const canCancel = transitions.includes('CANCELLED') && detail?.stockMovedAt == null
  const pendingApproval = detail?.status === 'PENDING_APPROVAL'
  const canDecide = pendingApproval && isManager && detail && user && detail.createdBy !== user.uid

  const runApprove = async () => {
    if (!user || !detail?.id || busy) return
    if (!reason.trim()) { toastError('An approval reason is required.', 'Missing reason'); return }
    setBusy(true)
    try {
      await approveInventoryReturn(detail.id, { uid: user.uid, name: user.name }, reason.trim())
      success(`${detail.returnNumber} approved — stock moved.`, 'Approved')
      await openDetail(detail.id)
      onRefresh()
    } catch (err) { toastError(friendlyError(err), 'Could not approve') }
    finally { setBusy(false) }
  }

  const runReject = async () => {
    if (!user || !detail?.id || busy) return
    if (!reason.trim()) { toastError('A rejection reason is required.', 'Missing reason'); return }
    setBusy(true)
    try {
      await rejectInventoryReturn(detail.id, { uid: user.uid, name: user.name }, reason.trim())
      success(`${detail.returnNumber} rejected.`, 'Rejected')
      await openDetail(detail.id)
      onRefresh()
    } catch (err) { toastError(friendlyError(err), 'Could not reject') }
    finally { setBusy(false) }
  }

  const runProgress = async (to: InventoryReturnStatus) => {
    if (!user || !detail?.id || busy) return
    if (to === 'SENT_TO_SUPPLIER' && !reason.trim()) {
      toastError('A supplier reference is required.', 'Missing reference'); return
    }
    if (to === 'CREDIT_RECEIVED' && !creditNote.trim()) {
      toastError('A credit note number is required.', 'Missing credit note'); return
    }
    setBusy(true)
    try {
      await progressInventoryReturn(
        detail.id,
        to,
        { uid: user.uid, name: user.name },
        to === 'SENT_TO_SUPPLIER' ? { supplierReference: reason.trim() }
          : to === 'CREDIT_RECEIVED' ? { creditNoteNumber: creditNote.trim() }
          : { note: reason.trim() || undefined },
      )
      success(`${detail.returnNumber} moved to ${statusLabel(to)}.`, 'Updated')
      await openDetail(detail.id)
      onRefresh()
    } catch (err) { toastError(friendlyError(err), 'Could not update status') }
    finally { setBusy(false) }
  }

  const runCancel = async () => {
    if (!user || !detail?.id || busy) return
    if (!reason.trim()) { toastError('A cancellation reason is required.', 'Missing reason'); return }
    setBusy(true)
    try {
      await cancelInventoryReturn(detail.id, { uid: user.uid, name: user.name }, reason.trim())
      success(`${detail.returnNumber} cancelled.`, 'Cancelled')
      await openDetail(detail.id)
      onRefresh()
    } catch (err) { toastError(friendlyError(err), 'Could not cancel') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{returns.length} records</h3>
        <Button size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>Refresh</Button>
      </div>
      {loading ? <Spinner label="Loading returns…" /> : returns.length === 0 ? (
        <EmptyState title="No returns recorded" message="Records you create here are immutable and auditable." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {returns.map((r) => (
                <tr key={r.id ?? r.returnNumber}>
                  <td className="px-3 py-2 font-mono text-xs">{r.returnNumber}</td>
                  <td className="px-3 py-2">{r.productName}</td>
                  <td className="px-3 py-2 tabular-nums">{r.quantity}</td>
                  <td className="px-3 py-2">{REASON_LABELS[r.reason]}</td>
                  <td className="px-3 py-2">{CONDITION_LABELS[r.condition]}</td>
                  <td className="px-3 py-2 tabular-nums text-right">{formatMoney(r.value, currency)}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Badge></td>
                  <td className="px-3 py-2 text-right">
                    <Button size="xs" variant="ghost" leftIcon={<Eye className="h-3.5 w-3.5" />}
                      onClick={async () => { await openDetail(r.id ?? '') }}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!detailOpen} onClose={closeDetail} title={`Return ${detail?.returnNumber ?? ''}`} size="lg">
        {detail ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Status" value={statusLabel(detail.status)} />
              <Field label="Created by" value={detail.createdByName ?? '—'} />
              <Field label="Approved by" value={detail.approvedByName ?? '—'} />
              <Field label="Return date" value={detail.returnDate ? formatDate(detail.returnDate) : '—'} />
              <Field label="Product" value={detail.productName} />
              <Field label="SKU" value={detail.sku || '—'} />
              <Field label="Quantity" value={`${detail.quantity}`} />
              <Field label="Unit purchase price" value={formatMoney(detail.purchasePrice, currency)} />
              <Field label="Value" value={formatMoney(detail.value, currency)} />
              <Field label="Reason" value={REASON_LABELS[detail.reason]} />
              <Field label="Condition" value={CONDITION_LABELS[detail.condition]} />
              <Field label="Supplier" value={detail.supplierName || '—'} />
              <Field label="Supplier ref" value={detail.supplierReference || '—'} />
              <Field label="Batch" value={detail.batchNumber || '—'} />
              <Field label="Expiry" value={detail.expiryDate ? formatDate(detail.expiryDate) : '—'} />
            </div>
            {detail.approvalReason ? (
              <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <span className="font-medium">Approval note:</span> {detail.approvalReason}
              </div>
            ) : null}
            {detail.rejectionReason ? (
              <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                <span className="font-medium">Rejection reason:</span> {detail.rejectionReason}
              </div>
            ) : null}
            {detail.evidenceUrls && detail.evidenceUrls.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Evidence</p>
                <div className="flex flex-wrap gap-2">
                  {detail.evidenceUrls.map((url, i) => (
                    <img key={i} src={url} alt={`evidence ${i + 1}`} className="h-20 w-20 rounded border object-cover" />
                  ))}
                </div>
              </div>
            )}
            {detail.timeline && detail.timeline.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Timeline</p>
                <ol className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-700">
                  {detail.timeline.map((ev, i) => (
                    <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{ev.action.replaceAll('_', ' ')}</span>
                      {ev.note ? ` — ${ev.note}` : ''}
                      <span className="text-slate-400"> · {ev.byName} · {formatDateTime(ev.at)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <Field label="Created" value={formatDateTime(detail.createdAt) ?? '—'} />

            {(canDecide || detail?.kind === 'SUPPLIER_RETURN') && (canDecide || canProgress || canCancel) && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Actions</p>
                {detail.kind === 'SUPPLIER_RETURN' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Supplier-return lifecycle — record each physical/Document event as it happens.
                  </p>
                )}
                {canDecide && (
                  <div className="space-y-2">
                    <Input
                      label={detail?.kind === 'SUPPLIER_RETURN' ? 'Decision note / reference' : 'Reason (required)'}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is this being approved / rejected?"
                      disabled={busy}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button leftIcon={<Check className="h-4 w-4" />} loading={busy} onClick={runApprove} disabled={!reason.trim()}>
                        Approve & move stock
                      </Button>
                      <Button variant="outline" leftIcon={<X className="h-4 w-4" />} loading={busy} onClick={runReject} disabled={!reason.trim()}>
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
                {!canDecide && canProgress && detail.kind === 'SUPPLIER_RETURN' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-end gap-2">
                      {transitions.filter((t) => t !== 'CANCELLED').map((t) => (
                        <Button
                          key={t}
                          size="sm"
                          variant="ghost"
                          loading={busy}
                          disabled={busy}
                          onClick={() => runProgress(t)}
                        >
                          → {statusLabel(t)}
                        </Button>
                      ))}
                    </div>
                    {transitions.includes('SENT_TO_SUPPLIER') && (
                      <Input label="Supplier reference" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="GRN / delivery note" disabled={busy} />
                    )}
                    {transitions.includes('CREDIT_RECEIVED') && (
                      <Input label="Credit note number" value={creditNote} onChange={(e) => setCreditNote(e.target.value)} placeholder="CN-…" disabled={busy} />
                    )}
                    {!transitions.includes('SENT_TO_SUPPLIER') && !transitions.includes('CREDIT_RECEIVED') && (
                      <Input label="Note (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note" disabled={busy} />
                    )}
                  </div>
                )}
                {canCancel && !canDecide && (
                  <div className="space-y-2">
                    <Input label="Cancellation reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being cancelled?" disabled={busy} />
                    <Button variant="ghost" leftIcon={<X className="h-4 w-4" />} loading={busy} onClick={runCancel} disabled={!reason.trim()}>
                      Cancel return
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : <Spinner label="Loading…" />}
      </Modal>
    </div>
  )
}

