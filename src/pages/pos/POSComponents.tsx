import { useEffect, useState } from 'react'
import { ShoppingCart, Plus, Minus, Trash2, LogOut, Clock, ReceiptText } from 'lucide-react'
import { useCart } from '../../context/CartContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { round2 } from '../../utils/calculations'
import { formatMoney, formatNumber } from '../../utils/format'
import type { CartLine } from '../../context/CartContext'
import type { TotalsResult } from '../../utils/calculations'
import type { Product, CashSession } from '../../types'

export function ProductTile({
  product,
  quantity,
  stock,
  showStock,
  currency,
  onSelect,
}: {
  product: Product
  quantity: number
  stock: number
  showStock: boolean
  currency: string
  onSelect: () => void
}) {
  const low = stock <= (product.minimumStock ?? 0)
  // Compact labels keep badges narrow so tiles never overflow their grid cell.
  const compact = (n: number) => (Number.isInteger(n) ? String(n) : formatNumber(n, 2))
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-700/40 ${low ? 'ring-2 ring-amber-400' : ''}`}
    >
      <div className="min-w-0 flex-1 basis-32">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{product.name || product.barcode}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{formatMoney(product.sellingPrice, currency)} / {product.unit || 'pc'}</p>
      </div>
      <div className="flex items-center gap-1">
        {quantity > 0 && (
          <Badge tone="emerald" className="tabular-nums">×{compact(quantity)} in bag</Badge>
        )}
        {showStock && low && (
          <Badge tone="amber" className="tabular-nums">{compact(stock)} left</Badge>
        )}
      </div>
    </button>
  )
}

export function CartLineRow({
  line,
  currency,
  onSelect,
  onQuantity,
  onStep,
  onDiscount,
  onRemove,
}: {
  line: CartLine
  currency: string
  onSelect: () => void
  onQuantity: (value: number) => void
  onStep: (n: number) => void
  onDiscount: (d: number) => void
  onRemove: () => void
}) {
  const gross = round2(line.sellingPrice * line.quantity)
  const net = round2(gross - line.discount)
  const [qtyEdit, setQtyEdit] = useState(false)
  const [qty, setQty] = useState(formatNumber(line.quantity, 2))
  const [discEdit, setDiscEdit] = useState(false)
  const [discount, setDiscount] = useState('')

  const applyQty = () => {
    const q = parseFloat(qty) || 0
    onQuantity(q)
    setQtyEdit(false)
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <div className="min-w-0 cursor-pointer" onClick={onSelect}>
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{line.name || line.barcode}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {formatMoney(line.sellingPrice, currency)} × {formatNumber(line.quantity, 2)}
            {line.trackInventory && line.stock <= 0 ? ' · OUT OF STOCK' : ''}
          </p>
        </div>
        <span className="text-right text-sm font-medium tabular-nums text-slate-900 dark:text-white">{formatMoney(net, currency)}</span>
      </div>

      <div className="flex items-center gap-1">
        <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600">
          <button type="button" onClick={() => onStep(-1)} className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
            <Minus className="h-3 w-3" />
          </button>
          {qtyEdit ? (
            <input
              type="number"
              inputMode="decimal"
              className="w-12 border-0 text-center text-sm text-slate-900 dark:bg-slate-800 dark:text-white focus:outline-none"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onBlur={applyQty}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyQty()
                }
              }}
              autoFocus
            />
          ) : (
            <span className="w-12 text-center text-sm tabular-nums text-slate-900 dark:text-white">{formatNumber(line.quantity, 2)}</span>
          )}
          <button type="button" onClick={() => onStep(1)} className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <button type="button" onClick={() => { setQty(formatNumber(line.quantity, 2)); setQtyEdit(true) }} className="px-1 py-0.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400">
          ✏
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        {discEdit ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              inputMode="decimal"
              className="w-28"
              placeholder="Discount amount"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
            <Button size="xs" variant="ghost" onClick={() => { onDiscount(parseFloat(discount) || 0); setDiscEdit(false); setDiscount('') }}>Set</Button>
            <Button size="xs" variant="ghost" onClick={() => { setDiscount(''); onDiscount(0); setDiscEdit(false) }}>Clear</Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDiscount(line.discount ? String(line.discount) : '')
              setDiscEdit(true)
            }}
            className="text-xs text-slate-500 underline"
          >
            {line.discount > 0 ? `Discount: ${formatMoney(line.discount, currency)}` : '+ discount'}
          </button>
        )}
        <button type="button" onClick={onRemove} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-700" aria-label="Remove item">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function BillDiscountInput({
  billDiscount,
  subtotal,
  currency,
  onSetBillDiscount,
}: {
  billDiscount: number
  subtotal: number
  currency: string
  onSetBillDiscount: (amount: number) => void
}) {
  const [value, setValue] = useState(billDiscount ? String(billDiscount) : '')
  const percent = subtotal > 0 ? round2((billDiscount / subtotal) * 100) : 0
  const apply = () => {
    const amt = parseFloat(value) || 0
    const clamped = Math.min(Math.max(amt, 0), subtotal)
    onSetBillDiscount(round2(clamped))
    setValue(String(round2(clamped)))
  }
    const clear = () => {
    onSetBillDiscount(0)
    setValue('')
  }
  // Keep the input in sync when the discount is reset externally (e.g. cart cleared).
  useEffect(() => {
    if (billDiscount === 0) setValue('')
  }, [billDiscount])
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Bill discount</p>
      <div className="flex items-end gap-2">
        <Input label="Discount amount" type="number" min={0} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} suffix={<span className="text-xs">{currency}</span>} />
        <button type="button" onClick={apply} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Apply</button>
        {billDiscount > 0 && (
          <button type="button" onClick={clear} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Clear</button>
        )}
      </div>
      {billDiscount > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">-{formatMoney(billDiscount, currency)} off ({formatNumber(percent, 2)}%)</p>}
    </div>
  )
}

export function TotalsBlock({
  totals,
  currency,
  itemCount,
}: {
  totals: TotalsResult
  currency: string
  itemCount: number
}) {
  return (
    <div className="space-y-1 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex justify-between text-sm"><span className="text-slate-500 dark:text-slate-400">Items</span><span className="tabular-nums">{formatNumber(itemCount, 2)}</span></div>
      <div className="flex justify-between text-sm"><span className="text-slate-500 dark:text-slate-400">Subtotal</span><span className="tabular-nums">{formatMoney(totals.subtotal, currency)}</span></div>
      {totals.billDiscount > 0 && (
        <div className="flex justify-between text-sm"><span className="text-slate-500 dark:text-slate-400">Discount</span><span className="tabular-nums text-emerald-700 dark:text-emerald-300">-{formatMoney(totals.discountTotal, currency)}</span></div>
      )}
      <div className="flex justify-between text-sm"><span className="text-slate-500 dark:text-slate-400">Taxable</span><span className="tabular-nums">{formatMoney(totals.taxableAmount, currency)}</span></div>
      <div className="flex justify-between text-sm"><span className="text-slate-500 dark:text-slate-400">GST</span><span className="tabular-nums">{formatMoney(totals.gstAmount, currency)}</span></div>
      <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold dark:border-slate-700">
        <span className="text-slate-800 dark:text-slate-100">TOTAL</span>
        <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{formatMoney(totals.total, currency)}</span>
      </div>
    </div>
  )
}

export function CartPanel({
  cart,
  currency,
  receiving,
  canCash,
  session,
  onPayment,
  onHold,
  onClear,
  onCloseShift,
}: {
  cart: ReturnType<typeof useCart>
  currency: string
  receiving: boolean
  canCash: boolean
  session: CashSession | null
  onPayment: () => void
  onHold: () => void
  onClear: () => void
  onCloseShift: () => void
}) {
  return (
    <>
      <div className="space-y-1">
        {cart.items.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            <ShoppingCart className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
            <p className="mt-1">Your cart is empty.</p>
          </div>
        ) : (
          cart.items.map((line) => (
            <CartLineRow
              key={line.productId}
              line={line}
              currency={currency}
              onSelect={() => {}}
              onQuantity={(v) => cart.setQuantity(line.productId, v)}
              onStep={(n) => cart.setQuantity(line.productId, line.quantity + n)}
              onDiscount={(d) => cart.setLineDiscount(line.productId, d)}
              onRemove={() => cart.removeLine(line.productId)}
            />
          ))
        )}
      </div>

      <BillDiscountInput
        billDiscount={cart.billDiscount}
        subtotal={cart.totals.subtotal}
        currency={currency}
        onSetBillDiscount={cart.setBillDiscount}
      />

      <TotalsBlock totals={cart.totals} currency={currency} itemCount={cart.itemCount} />

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500 dark:text-slate-400">Customer</span>
        <span className="font-medium text-slate-800 dark:text-slate-200">{cart.customer.name}</span>
      </div>

      <div className="flex flex-col gap-2">
        <Button size="sm" variant="outline" leftIcon={<Trash2 className="h-4 w-4" />} onClick={onClear} disabled={cart.itemCount === 0}>
          Clear cart
        </Button>
        <Button size="sm" variant="secondary" leftIcon={<Clock className="h-4 w-4" />} onClick={onHold} disabled={cart.itemCount === 0}>
          Hold bill (F4)
        </Button>
        <Button size="lg" leftIcon={<ReceiptText className="h-5 w-4" />} onClick={onPayment} disabled={cart.itemCount === 0 || receiving}>
          Payment (F8 / F10)
        </Button>
      </div>

      {canCash && session ? (
        <Button size="sm" variant="outline" leftIcon={<LogOut className="h-4 w-4" />} onClick={onCloseShift}>
          Close shift
        </Button>
      ) : null}
    </>
  )
}

export function CashSessionModal({
  open,
  storeName,
  openingCash,
  onChangeOpening,
  onCancel,
  onSubmit,
}: {
  open: boolean
  storeName: string
  openingCash: string
  onChangeOpening: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel} title="Open cash shift" size="sm" footer={
      <>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSubmit}>Open shift</Button>
      </>
    }>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Opening the cash shift for <span className="font-medium">{storeName}</span>. Record the cash you start the drawer with so end-of-day tallies are accurate.
        </p>
        <Input label="Opening cash" type="number" min={0} inputMode="decimal" value={openingCash} onChange={(e) => onChangeOpening(e.target.value)} suffix={<span className="text-xs">₹</span>} autoFocus />
      </div>
    </Modal>
  )
}

export function CashCloseModal({
  open,
  session,
  declaredCash,
  onChangeDeclared,
  onCancel,
  onConfirm,
}: {
  open: boolean
  session: CashSession | null
  declaredCash: string
  onChangeDeclared: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!session) return null
  return (
    <Modal open={open} onClose={onCancel} title="Close cash shift" size="sm" footer={
      <>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Close shift</Button>
      </>
    }>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Declared cash counted at the end of the shift. The system will compute expected cash from sales and expenses during this shift.
        </p>
        <Input label="Cash counted" type="number" min={0} inputMode="decimal" value={declaredCash} onChange={(e) => onChangeDeclared(e.target.value)} suffix={<span className="text-xs">₹</span>} autoFocus />
      </div>
    </Modal>
  )
}

export function ConfirmClear({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel} title="Clear cart?" size="sm" footer={
      <>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Clear cart</Button>
      </>
    }>
      <p className="text-sm text-slate-600 dark:text-slate-300">This will remove every item from the current bill. You will not be able to recover it (unless it was held).</p>
    </Modal>
  )
}