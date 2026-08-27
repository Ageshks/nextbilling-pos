import { CheckCircle2, Printer, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { formatMoney, formatDateTime, formatNumber } from '../../utils/format'
import { splitCgstSgst } from '../../utils/calculations'
import type { Sale, StoreSettings } from '../../types'

interface ReceiptData {
  sale: Sale
  settings: StoreSettings
  cashierName: string
}

export function ReceiptPrintView({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  const isThermal = data.settings.defaultReceiptType === 'thermal'
  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-100 print:static print:h-auto print:overflow-visible print:bg-white">
      <div className="mx-auto max-w-3xl p-4 print:p-0">
        <div className="mb-3 hidden items-center justify-between sm:flex print:hidden">
          <p className="text-sm font-medium text-slate-600">Receipt preview</p>
          <div className="flex gap-2">
            <Button variant="primary" leftIcon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="outline" leftIcon={<X className="h-4 w-4" />} onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="printable rounded-xl border border-slate-200 bg-white shadow-md print:rounded-none print:border-0 print:shadow-none">
          {isThermal ? <ThermalReceipt {...data} /> : <A4Invoice {...data} />}
        </div>
      </div>
    </div>
  )
}

function StoreHeader({ settings }: { settings: StoreSettings }) {
  return (
    <div className="text-center">
      {settings.logoUrl && <img src={settings.logoUrl} alt="Store logo" className="mx-auto h-12 w-12 object-contain" />}
      <h1 className="text-lg font-bold text-slate-900 print:text-black">{settings.name || 'SuperMart'}</h1>
      <p className="whitespace-pre-line text-xs text-slate-600">{settings.address}</p>
      <p className="text-xs text-slate-600">
        {settings.phone}
        {settings.email && ` · ${settings.email}`}
      </p>
      {settings.gstNumber && <p className="text-xs text-slate-600">GSTIN: {settings.gstNumber}</p>}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-slate-700">
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function TotalsBlock({ sale, settings }: { sale: Sale; settings: StoreSettings }) {
  const currency = settings.currency || 'INR'
  const gstSplit = splitCgstSgst(sale.gstAmount)
  return (
    <div className="mt-2 space-y-1 border-t border-dashed border-slate-300 pt-2 text-xs">
      <div className="flex justify-between text-slate-700">
        <span>Subtotal</span>
        <span>{formatMoney(sale.subtotal, currency)}</span>
      </div>
      {sale.discount > 0 && (
        <div className="flex justify-between text-slate-700">
          <span>Discount</span>
          <span>-{formatMoney(sale.discount, currency)}</span>
        </div>
      )}
      <div className="flex justify-between text-slate-700">
        <span>Taxable amount</span>
        <span>{formatMoney(sale.taxableAmount, currency)}</span>
      </div>
      <div className="flex justify-between text-slate-700">
        <span>GST</span>
        <span>{formatMoney(sale.gstAmount, currency)}</span>
      </div>
      {sale.gstAmount > 0 && (
        <div className="flex justify-between text-slate-500">
          <span className="pl-3">CGST · SGST</span>
          <span>
            {formatMoney(gstSplit.cgst, currency)} · {formatMoney(gstSplit.sgst, currency)}
          </span>
        </div>
      )}
      <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold text-slate-900">
        <span>TOTAL</span>
        <span>{formatMoney(sale.total, currency)}</span>
      </div>
      {sale.payments.length > 0 && (
        <div className="border-t border-slate-200 pt-1">
          {sale.payments.map((p, i) => (
            <div key={i} className="flex justify-between text-slate-700">
              <span>{p.method}</span>
              <span>{formatMoney(p.amount, currency)}</span>
            </div>
          ))}
        </div>
      )}
      {sale.changeGiven > 0 && (
        <div className="flex justify-between font-semibold text-emerald-700">
          <span>Change</span>
          <span>{formatMoney(sale.changeGiven, currency)}</span>
        </div>
      )}
      {sale.creditAmount > 0 && (
        <div className="flex justify-between font-semibold text-amber-700">
          <span>Credit (udhaar)</span>
          <span>{formatMoney(sale.creditAmount, currency)}</span>
        </div>
      )}
    </div>
  )
}

export function ThermalReceipt({ sale, settings, cashierName }: ReceiptData) {
  const currency = settings.currency || 'INR'
  return (
    <div className="mx-auto w-full max-w-[320px] p-4 font-mono text-xs text-slate-900">
      <StoreHeader settings={settings} />
      <div className="mt-2 space-y-0.5">
        <InfoRow label="Invoice" value={sale.invoiceNumber} />
        <InfoRow label="Date" value={formatDateTime(sale.createdAt)} />
        <InfoRow label="Cashier" value={cashierName} />
        <InfoRow label="Customer" value={sale.customerName} />
      </div>
      <div className="mt-2 border-t border-dashed border-slate-300">
        <div className="flex justify-between py-1 font-bold">
          <span>Item</span>
          <span>Qty · Price · Total</span>
        </div>
        {sale.items.map((item, i) => (
          <div key={i} className="py-0.5">
            <p className="font-bold">{item.name}</p>
            <div className="flex justify-between">
              <span>
                {formatNumber(item.quantity)} {item.unit} × {formatMoney(item.sellingPrice, currency)}
              </span>
              <span>{formatMoney(item.sellingPrice * item.quantity, currency)}</span>
            </div>
            {item.discount > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Discount @ {item.gstRate}% GST</span>
                <span>-{formatMoney(item.discount, currency)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <TotalsBlock sale={sale} settings={settings} />
      <p className="mt-4 whitespace-pre-line text-center text-xs text-slate-600">
        {settings.receiptFooter || 'Thank you for shopping with us'}
      </p>
      <p className="mt-1 text-center text-[10px] text-slate-400">Generated by SuperMart POS</p>
    </div>
  )
}

export function A4Invoice({ sale, settings, cashierName }: ReceiptData) {
  const currency = settings.currency || 'INR'
  return (
    <div className="p-6 text-sm text-slate-900">
      <div className="flex items-start justify-between border-b border-slate-300 pb-4">
        <StoreHeader settings={settings} />
        <div className="text-right">
          <p className="text-xl font-bold">INVOICE</p>
          <InfoRow label="Invoice" value={sale.invoiceNumber} />
          <InfoRow label="Date" value={formatDateTime(sale.createdAt)} />
          <InfoRow label="Status" value={sale.status} />
        </div>
      </div>
      <div className="mt-3 flex justify-between text-xs">
        <div>
          <p className="font-bold">Billed To</p>
          <p>{sale.customerName}</p>
        </div>
        <div className="text-right">
          <p className="font-bold">Cashier</p>
          <p>{cashierName}</p>
        </div>
      </div>
      <table className="mt-4 w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-slate-300">
            <th className="py-1.5">#</th>
            <th className="py-1.5">Item</th>
            <th className="py-1.5 text-right">Qty</th>
            <th className="py-1.5 text-right">Price</th>
            <th className="py-1.5 text-right">GST%</th>
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5">{item.name}</td>
              <td className="py-1.5 text-right">{formatNumber(item.quantity)}</td>
              <td className="py-1.5 text-right">{formatMoney(item.sellingPrice, currency)}</td>
              <td className="py-1.5 text-right">{item.gstRate}%</td>
              <td className="py-1.5 text-right">{formatMoney(item.sellingPrice * item.quantity, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-end">
        <div className="w-64">
          <TotalsBlock sale={sale} settings={settings} />
        </div>
      </div>
      <p className="mt-8 whitespace-pre-line text-center text-sm text-slate-600">
        {settings.receiptFooter || 'Thank you for shopping with us'}
      </p>
    </div>
  )
}

export function SaleSuccessScreen({
  invoiceNumber,
  total,
  currency,
  onPrint,
  onNewSale,
}: {
  invoiceNumber: string
  total: number
  currency: string
  onPrint: () => void
  onNewSale: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <CheckCircle2 className="h-16 w-16 text-emerald-500" aria-hidden="true" />
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Sale completed</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">Invoice {invoiceNumber}</p>
      <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatMoney(total, currency)}</p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="lg" leftIcon={<Printer className="h-4 w-4" />} onClick={onPrint}>
          Print receipt
        </Button>
        <Button variant="outline" size="lg" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </div>
  )
}