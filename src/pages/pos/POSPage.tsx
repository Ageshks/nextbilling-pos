import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Clock, Keyboard, LogIn } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { useCart } from '../../context/CartContext'
import { useProductSearch } from '../../hooks/useProducts'
import { useKeydown, usePlayScanSound } from '../../hooks/useOnlineStatus'
import { CartProvider } from '../../context/CartContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { formatMoney } from '../../utils/format'
import { calculateChange, round2, calculateTax } from '../../utils/calculations'
import { friendlyError } from '../../utils/errors'
import {
  completeSale,
  listHeldBills,
  saveHeldBill,
  deleteHeldBill,
  type SaleDraft,
} from '../../services/salesService'
import { getOpenSession, openSession, closeSession } from '../../services/cashService'
import { getPreviewInvoiceNumber } from '../../utils/invoice'
import { ReceiptPrintView } from '../../components/billing/ReceiptPrint'
import type { Product, HeldBill, CashSession, Sale, StoreSettings } from '../../types'
import type { CartLine } from '../../context/CartContext'
import { PaymentModal } from './PaymentModal'
import { CustomerPickerModal } from './CustomerPickerModal'
import { HeldBillsModal } from './HeldBillsModal'
import { ShortcutsModal } from './ShortcutsModal'
import {
  ProductTile,
  CartPanel,
  CashSessionModal,
  CashCloseModal,
  ConfirmClear,
} from './POSComponents'

export function POSContent() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error } = useToast()
  const cart = useCart()
  const playScan = usePlayScanSound(settings?.posSoundOnScan ?? true)
  const search = useProductSearch({ storeId: user?.storeId ?? '', includeInactive: false, debounceMs: 120 })
  const currency = settings?.currency ?? 'INR'
  const storeName = settings?.name || 'SuperMart'
  const gstIncluded = settings?.gstIncluded ?? true

  const [heldBills, setHeldBills] = useState<HeldBill[]>([])
  const [heldLoading, setHeldLoading] = useState(false)
  const [heldDeleting, setHeldDeleting] = useState<string | null>(null)
  const [heldOpen, setHeldOpen] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [cashConfirming, setCashConfirming] = useState(false)
  const [clearConfirming, setClearConfirming] = useState(false)
  const [openingCash, setOpeningCash] = useState('')
  const [declaredCash, setDeclaredCash] = useState('')
  const [session, setSession] = useState<CashSession | null>(null)
  const [receiving, setReceiving] = useState(false)
        const [receipt, setReceipt] = useState<{ sale: Sale; settings: StoreSettings; cashierName: string } | null>(null)

  const barcodeRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Auto focus the barcode field on desktop
  useEffect(() => {
    barcodeRef.current?.focus()
  }, [])

  const loadHeldBills = useCallback(async () => {
    if (!user) return
    setHeldLoading(true)
    try {
      const bills = await listHeldBills(user.storeId)
      setHeldBills(bills)
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load held bills' })
    } finally {
      setHeldLoading(false)
    }
  }, [user, notify])

  const loadSession = useCallback(async () => {
    if (!user) return
    try {
      const s = await getOpenSession(user.storeId, user.uid)
      setSession(s)
    } catch (err) {
      console.error(err)
    }
  }, [user])

  useEffect(() => {
    void loadHeldBills()
    void loadSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCash = async () => {
    if (!user) return
    const cash = parseFloat(openingCash) || 0
    try {
      await openSession(user.storeId, user.uid, user.name, cash)
      success('Cash shift opened', 'Shift open')
      setCashOpen(false)
      setOpeningCash('')
      void loadSession()
    } catch (err) {
      error(friendlyError(err), 'Could not open shift')
    }
  }

  const closeCash = async () => {
    if (!session || !session.id) return
    const declared = parseFloat(declaredCash) || 0
    try {
      const res = await closeSession(session.id, session.storeId ?? user?.storeId ?? '', declared)
      success(`Shift closed. Expected ${formatMoney(res.expectedCash, currency)}, difference ${formatMoney(res.difference, currency)}`, 'Shift closed')
      setCashConfirming(false)
      setDeclaredCash('')
      setSession(null)
    } catch (err) {
      error(friendlyError(err), 'Could not close shift')
    }
  }

    const canCash = user?.role === 'OWNER' || user?.role === 'ADMIN'

  // Keyboard shortcuts
  const modalOpen = customerOpen || paymentOpen || cashOpen || cashConfirming || heldOpen

  useKeydown((e) => {
    if (modalOpen) return
    if (e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault()
      setPaymentOpen(true)
    }
    if (e.key === 'F8') {
      e.preventDefault()
      cart.itemCount > 0 && setPaymentOpen(true)
    }
    if (e.key === 'F10') {
      e.preventDefault()
      if (cart.itemCount > 0) setPaymentOpen(true)
    }
    if (e.key === 'F6') {
      e.preventDefault()
      setCustomerOpen(true)
    }
    if (e.key === 'F4') {
      e.preventDefault()
      cart.itemCount > 0 && holdBill()
    }
    if (e.key === 'F2') {
      e.preventDefault()
      searchRef.current?.focus()
    }
    if (e.key === 'Escape') {
      if (cart.itemCount > 0) setClearConfirming(true)
    }
  })

  const handleBarcodeSubmit = async () => {
    if (!user) return
    const code = (barcodeRef.current?.value ?? '').trim()
    if (!code) {
      searchRef.current?.focus()
      return
    }
    barcodeRef.current!.value = ''
    try {
      const product = await search.scanBarcode(code)
      if (product) {
        cart.addProduct(product, 1)
        if (settings?.posSoundOnScan) playScan()
      } else {
        // Treat the barcode itself as a search term.
        search.setQuery(code)
        searchRef.current?.focus()
                notify({ type: 'info', message: `No product for barcode ${code}. Searching…`, title: 'Not found' })
      }
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Scan failed' })
    }
  }

    const addItem = (product: Product) => {
    cart.addProduct(product, 1)
    if (settings?.posSoundOnScan) playScan()
    barcodeRef.current?.focus()
  }

    const holdBill = () => {
    if (!user || cart.itemCount === 0) return
    const draft: Omit<HeldBill, 'id' | 'storeId'> = {
      userId: user.uid,
      userName: user.name,
      heldAt: Date.now(),
      customerId: cart.customer.id,
      customerName: cart.customer.name,
      items: buildSaleItems(),
      discount: cart.billDiscount,
      subtotal: cart.totals.subtotal,
      taxableAmount: cart.totals.taxableAmount,
      gstAmount: cart.totals.gstAmount,
      total: cart.totals.total,
    }
    void saveHeldBill(user.storeId, draft)
      .then(() => {
        success('Bill held', 'Hold')
        void loadHeldBills()
        cart.clearCart()
        barcodeRef.current?.focus()
      })
      .catch((err) => error(friendlyError(err), 'Could not hold bill'))
  }

  const resumeBill = (bill: HeldBill) => {
    const lines: CartLine[] = (bill.items ?? []).map((i) => ({
      productId: i.productId,
      name: i.name,
      barcode: i.barcode,
      sku: i.sku,
      unit: i.unit,
      quantity: i.quantity,
      sellingPrice: i.sellingPrice,
      purchasePrice: i.purchasePrice,
      mrp: i.mrp,
      gstRate: i.gstRate,
      discount: i.discount,
      stock: 0,
      trackInventory: false,
    }))
    cart.setItems(lines)
    cart.setBillDiscount(bill.discount ?? 0)
    cart.setCustomer({ id: bill.customerId || 'walkin', name: bill.customerName || 'Walk-in Customer' })
    cart.discardSaved()
    void deleteHeldBill(bill.id ?? '')
    void loadHeldBills()
    setHeldOpen(false)
    barcodeRef.current?.focus()
  }

  const deleteHeld = (bill: HeldBill) => {
    if (!confirm(`Delete held bill #${bill.id?.slice(-6)}? This can't be undone.`)) return
    setHeldDeleting(bill.id ?? null)
    void deleteHeldBill(bill.id ?? '')
      .then(() => {
        setHeldBills((prev) => prev.filter((b) => b.id !== bill.id))
        setHeldDeleting(null)
      })
      .catch((err) => {
        setHeldDeleting(null)
        error(friendlyError(err), 'Could not delete')
      })
  }

  const [previewInvoice, setPreviewInvoice] = useState<string>('')

  useEffect(() => {
    if (!user || cart.itemCount === 0) {
      setPreviewInvoice('')
      return
    }
    getPreviewInvoiceNumber(user.storeId, settings?.invoicePrefix || 'SM', 'sales')
      .then(setPreviewInvoice)
      .catch(() => setPreviewInvoice('—'))
  }, [user, cart.itemCount, settings?.invoicePrefix])

  const buildSaleItems = (): SaleDraft['items'] => {
    return cart.items.map((l) => {
      const qty = Math.max(1, Math.round(l.quantity))
      const gross = round2(l.sellingPrice * qty)
      const discount = round2(Math.min(l.discount, gross))
      const taxable = round2(gross - discount)
      const gst = calculateTax(taxable, l.gstRate, gstIncluded)
      const lineTotal = gstIncluded ? round2(taxable - gst) : round2(taxable + gst)
      return {
        productId: l.productId,
        name: l.name,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unit,
        quantity: qty,
        sellingPrice: round2(l.sellingPrice),
        mrp: round2(l.mrp),
        purchasePrice: round2(l.purchasePrice),
        gstRate: l.gstRate,
        discount,
        taxableAmount: taxable,
        gstAmount: gst,
        lineTotal,
      }
    })
  }

  const completeSaleFlow = async (
    payments: Array<{ method: string; amount: number }>,
    amountReceived: number,
  ) => {
    if (!user) {
      setReceiving(false)
      return
    }
    try {
      const items = buildSaleItems()
      const t = cart.totals
            const creditAmount = round2(payments.filter((p) => p.method === 'CREDIT').reduce((sum, p) => sum + p.amount, 0))
      const changeGiven = calculateChange(amountReceived, t.total)

      const draft: SaleDraft = {
        storeId: user.storeId,
        customerId: cart.customer.id === 'walkin' ? '' : cart.customer.id,
        customerName: cart.customer.name,
        cashierId: user.uid,
        cashierName: user.name,
        items,
        subtotal: t.subtotal,
        discount: t.discountTotal,
        taxableAmount: t.taxableAmount,
        gstAmount: t.gstAmount,
        total: t.total,
        gstIncluded,
        payments: payments as SaleDraft['payments'],
        amountReceived,
        changeGiven,
        creditAmount,
        notes: '',
        heldBillId: '',
        invoicePrefix: settings?.invoicePrefix || 'SM',
        enableNegativeStock: settings?.enableNegativeStock ?? false,
        currency,
      }

            const { sale, invoiceNumber } = await completeSale(draft)
      success(`Sale ${invoiceNumber} of ${formatMoney(t.total, currency)} completed`, 'Payment received')
            setReceipt({ sale, settings: settings as StoreSettings, cashierName: user.name })
      cart.clearCart()
      barcodeRef.current?.focus()
      if (settings?.posAutoPrintReceipt) {
        setTimeout(() => window.print?.(), 150)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message.includes('Only') ? err.message : friendlyError(err)
      error(msg, 'Sale could not be completed')
    } finally {
      setReceiving(false)
    }
  }

      const handlePaymentCompleteWrap = (
    payments: Array<{ method: string; amount: number }>,
    amountReceived: number,
  ) => {
    setReceiving(true)
    void completeSaleFlow(payments, amountReceived).finally(() => setReceiving(false))
  }

  const renderModals = () => (
    <>
      <PaymentModal
        open={paymentOpen}
        total={cart.totals.total}
        currency={currency}
        defaultMethod={settings?.defaultPaymentMethod || 'CASH'}
        enableCredit={settings?.enableCreditSales ?? true}
        submitting={receiving}
        onClose={() => setPaymentOpen(false)}
        onComplete={handlePaymentCompleteWrap}
      />

      <CustomerPickerModal
        open={customerOpen}
        storeId={user?.storeId ?? ''}
        selectedId={cart.customer.id}
        onSelect={(c) => {
          cart.setCustomer({ id: c.id, name: c.name })
          setCustomerOpen(false)
          barcodeRef.current?.focus()
        }}
        onClose={() => setCustomerOpen(false)}
      />

      <HeldBillsModal
        open={heldOpen}
        currency={currency}
        bills={heldBills}
        loading={heldLoading}
        deletingId={heldDeleting}
        onResume={resumeBill}
        onDelete={deleteHeld}
        onClose={() => setHeldOpen(false)}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <CashSessionModal
        open={cashOpen}
        storeName={storeName}
        openingCash={openingCash}
        onChangeOpening={(v) => setOpeningCash(v)}
        onCancel={() => setCashOpen(false)}
        onSubmit={openCash}
      />

      <CashCloseModal
        open={cashConfirming}
        session={session}
        declaredCash={declaredCash}
        onChangeDeclared={(v) => setDeclaredCash(v)}
        onCancel={() => setCashConfirming(false)}
        onConfirm={closeCash}
      />

      <ConfirmClear
        open={clearConfirming}
        onCancel={() => setClearConfirming(false)}
        onConfirm={() => {
          cart.clearCart()
          setClearConfirming(false)
          barcodeRef.current?.focus()
        }}
      />
    </>
  )


    return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Top toolbar */}
      <div className="no-print mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{storeName} — POS</h1>
        <div className="flex flex-wrap items-center gap-2">
          {previewInvoice && (
            <Badge tone="slate" className="tabular-nums">
              #{previewInvoice}
            </Badge>
          )}
          {canCash && session ? (
            <Badge tone="emerald" className="tabular-nums">
              Shift: {session.userName} · open {formatMoney(session.openingCash, currency)}
            </Badge>
          ) : canCash && !session ? (
            <Button size="sm" variant="outline" onClick={() => setCashOpen(true)}>
              <LogIn className="h-4 w-4" />
              Open shift
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setHeldOpen(true)} aria-label="Held bills">
            <Clock className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShortcutsOpen(true)} aria-label="Shortcuts">
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* LEFT: search + products */}
        <div className="flex-1 overflow-y-auto">
          <div className="mb-3 flex items-end gap-2">
            <div className="flex-1">
              <Input
                ref={searchRef}
                label="Search products"
                placeholder="Type to search by name, code or barcode…"
                value={search.query}
                onChange={(e) => search.setQuery(e.target.value)}
                suffix={
                  search.loading ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
                  ) : undefined
                }
              />
              {search.error && <p className="mt-1 text-xs text-red-600">{search.error}</p>}
            </div>
            <div className="w-56">
              <Input
                ref={barcodeRef}
                label="Barcode / F2"
                placeholder="Scan a barcode…"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleBarcodeSubmit()
                  }
                }}
              />
            </div>
          </div>

          {search.results.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              {search.query.trim().length === 0
                ? 'Start typing or scan a barcode to add products.'
                : 'No products found. Try another search term.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {search.results.map((product) => {
                const inCart = cart.items.find((l) => l.productId === product.id)
                const qty = inCart?.quantity ?? 0
                return (
                                    <ProductTile
                    key={product.id}
                    product={product}
                    quantity={qty}
                    stock={product.stock ?? 0}
                    showStock={settings?.posShowStock ?? true}
                    currency={currency}
                    onSelect={() => addItem(product)}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT: cart */}
        <div className="no-print flex w-96 min-w-[24rem] max-w-md flex-col gap-3 overflow-y-auto">
                              <CartPanel
            cart={cart}
            currency={currency}
            receiving={receiving}
            canCash={canCash}
            session={session}
            onPayment={() => setPaymentOpen(true)}
            onHold={holdBill}
            onClear={() => setClearConfirming(true)}
            onCloseShift={() => {
              setDeclaredCash('')
              setCashConfirming(true)
            }}
          />
        </div>
      </div>

      {renderModals()}

            {/* Receipt preview / auto print */}
      {receipt && (
        <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-100 dark:bg-slate-900 print:static print:h-auto print:overflow-visible print:bg-white">
          <ReceiptPrintView data={receipt} onClose={() => setReceipt(null)} />
        </div>
      )}
        </div>
  )
}

export default function POSPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  if (!user) return null
  return (
    <CartProvider userId={user.uid} settings={settings}>
      <POSContent />
    </CartProvider>
  )
}