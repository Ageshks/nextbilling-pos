import { useCallback, useEffect, useMemo, useState } from 'react'
import { History } from 'lucide-react'
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
  listInventory,
  adjustStock,
  listStockMovements,
} from '../../services/inventoryService'
import type { StockLevel, StockMovement } from '../../types'
import { formatMoney, formatDateTime } from '../../utils/format'
import { round2 } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'

type AdjustType = 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGE' | 'EXPIRED'

const ADJUST_LABELS: Record<AdjustType, string> = {
  ADJUSTMENT_IN: 'Add stock (correction)',
  ADJUSTMENT_OUT: 'Remove stock (correction)',
  DAMAGE: 'Damaged',
  EXPIRED: 'Expired',
}

export default function InventoryPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()
  const currency = settings?.currency ?? 'INR'

  const [levels, setLevels] = useState<StockLevel[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchText, setSearchText] = useState('')

      const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [adjustType, setAdjustType] = useState<AdjustType>('ADJUSTMENT_IN')
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  const [movementsOpen, setMovementsOpen] = useState(false)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [movementsLoading, setMovementsLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await listInventory(user.storeId)
      setLevels(rows)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load inventory' })
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  useEffect(() => {
    void load()
  }, [load])

  const [adjustProduct, setAdjustProduct] = useState<{ id?: string; name: string; unit?: string; stock?: number } | null>(null)

  const visible = useMemo(() => {
    const t = searchText.trim().toLowerCase()
    return levels.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false
      if (!t) return true
      const p = l.product
      return p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)
    })
  }, [levels, statusFilter, searchText])

  const summary = useMemo(
    () => ({
      total: levels.length,
      low: levels.filter((l) => l.status === 'LOW_STOCK').length,
      out: levels.filter((l) => l.status === 'OUT_OF_STOCK').length,
      value: round2(levels.reduce((sum, l) => sum + l.stockValue, 0)),
    }),
    [levels],
  )

  const openAdjust = (level: StockLevel) => {
    setAdjustProduct({ id: level.product.id, name: level.product.name, unit: level.product.unit, stock: level.product.stock })
    setAdjustType('ADJUSTMENT_IN')
    setAdjustQty('')
    setAdjustReason('')
    setAdjustModalOpen(true)
  }

  const submitAdjust = async () => {
    if (!user || !adjustProduct?.id) return
    const qty = parseFloat(adjustQty) || 0
    if (qty <= 0) {
      toastError('Enter a quantity greater than zero', 'Invalid quantity')
      return
    }
    setAdjusting(true)
    try {
      await adjustStock(user.storeId, adjustProduct.id, adjustType, qty, adjustReason.trim(), user.uid)
      success(`${adjustProduct.name}: ${ADJUST_LABELS[adjustType]} ${qty}`, 'Stock updated')
      setAdjustModalOpen(false)
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Adjustment failed')
    } finally {
      setAdjusting(false)
    }
  }

  const openMovements = async () => {
    if (!user) return
    setMovementsOpen(true)
    setMovementsLoading(true)
    try {
      const rows = await listStockMovements(user.storeId, undefined, 100)
      setMovements(rows)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load movements' })
    } finally {
      setMovementsLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        description={`${summary.total} products · ${summary.low} low · ${summary.out} out · stock value ${formatMoney(summary.value, currency)}`}
        actions={
          <Button variant="outline" size="sm" leftIcon={<History className="h-4 w-4" />} onClick={() => void openMovements()}>
            Stock movements
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Input label="Search" placeholder="Product name or SKU…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        <div className="w-44">
          <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="IN_STOCK">In stock</option>
            <option value="LOW_STOCK">Low stock</option>
            <option value="OUT_OF_STOCK">Out of stock</option>
          </Select>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading inventory…" />
      ) : (
        <DataTable<StockLevel>
          rowKey={(l) => l.product.id}
          rows={visible}
          emptyState={<EmptyState title="Nothing here" message="No products match this filter." />}
          columns={[
            { key: 'name', header: 'Product',
              render: (l) => (
                <div>
                  <p className="font-medium">{l.product.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{l.product.sku || '—'}</p>
                </div>
              ) },
            { key: 'stock', header: 'Stock', className: 'tabular-nums text-right', headerClassName: 'text-right',
              render: (l) => <Badge tone={statusTone(l.status)}>{l.product.stock} {l.product.unit}</Badge> },
            { key: 'min', header: 'Min', className: 'tabular-nums text-right', headerClassName: 'text-right', render: (l) => String(l.product.minimumStock) },
            { key: 'value', header: 'Stock value', className: 'tabular-nums text-right', headerClassName: 'text-right',
              render: (l) => formatMoney(l.stockValue, currency) },
            { key: 'actions', header: '', render: (l) => (
              <div className="flex justify-end">
                <Button size="xs" variant="ghost" onClick={() => openAdjust(l)}>
                  Adjust
                </Button>
              </div>
            ) },
          ]}
        />
      )}

            {/* Adjust stock modal */}
      <Modal
        open={adjustModalOpen}
        onClose={() => setAdjustModalOpen(false)}
        title={`Adjust stock — ${adjustProduct?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustModalOpen(false)}>Cancel</Button>
            <Button loading={adjusting} onClick={submitAdjust}>Apply adjustment</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Current stock: <span className="font-semibold tabular-nums">{adjustProduct?.stock ?? 0} {adjustProduct?.unit ?? ''}</span>
          </p>
          <Select label="Type" value={adjustType} onChange={(e) => setAdjustType(e.target.value as AdjustType)}>
            {(Object.keys(ADJUST_LABELS) as AdjustType[]).map((k) => (
              <option key={k} value={k}>{ADJUST_LABELS[k]}</option>
            ))}
          </Select>
          <Input label="Quantity" type="number" min={0} inputMode="decimal" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} autoFocus />
          <Input label="Reason *" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Cycle count correction…" />
        </div>
      </Modal>

      {/* Movements modal */}
      <Modal open={movementsOpen} onClose={() => setMovementsOpen(false)} title="Recent stock movements" size="lg">
        {movementsLoading ? (
          <Spinner label="Loading movements…" />
        ) : movements.length === 0 ? (
          <EmptyState title="No movements yet" message="Sales, purchases and adjustments will appear here." />
        ) : (
          <ul className="-mx-2 divide-y divide-slate-100 dark:divide-slate-700">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{m.productName}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTime(m.createdAt)} · {m.notes}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone={m.quantity >= 0 ? 'emerald' : 'red'} className="tabular-nums">
                    {m.quantity >= 0 ? `+${m.quantity}` : m.quantity}
                  </Badge>
                  <p className="mt-0.5 text-xs text-slate-500">{m.type.replaceAll('_', ' ')}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}