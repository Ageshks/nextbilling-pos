export interface FieldErrors {
  [field: string]: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+\d][\d\s-]{6,14}$/

export function required(value: unknown, label: string): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    return `${label} is required`
  }
  return ''
}

export function isEmail(value: string): string {
  if (!value) return ''
  return EMAIL_RE.test(value) ? '' : 'Enter a valid email address'
}

export function isPhone(value: string): string {
  if (!value) return ''
  return PHONE_RE.test(value.trim()) ? '' : 'Enter a valid phone number'
}

export function minZero(value: number, label: string): string {
  if (Number.isNaN(value) || value < 0) return `${label} must be 0 or more`
  return ''
}

export function positive(value: number, label: string): string {
  if (Number.isNaN(value) || value <= 0) return `${label} must be greater than 0`
  return ''
}

export function isValidGstRate(value: number): string {
  const allowed = [0, 0.25, 3, 5, 12, 18, 28]
  if (allowed.includes(value)) return ''
  return 'GST rate must be one of 0, 0.25, 3, 5, 12, 18 or 28'
}

export function isValidQuantity(value: number): string {
  if (Number.isNaN(value) || value <= 0) return 'Quantity must be greater than 0'
  if (value >= 1000000) return 'Quantity is too large'
  return ''
}

export interface ProductFormValues {
  name: string
  barcode: string
  sku: string
  categoryId: string
  brandId: string
  unit: string
  purchasePrice: number
  sellingPrice: number
  mrp: number
  gstRate: number
  minimumStock: number
  maximumStock: number
  supplierId: string
  description: string
}

export function validateProduct(form: ProductFormValues): FieldErrors {
  const errors: FieldErrors = {}
  const name = required(form.name, 'Product name')
  if (name) errors.name = name
  const pp = minZero(form.purchasePrice, 'Purchase price')
  if (pp) errors.purchasePrice = pp
  const sp = minZero(form.sellingPrice, 'Selling price')
  if (sp) errors.sellingPrice = sp
  if (form.sellingPrice < form.purchasePrice && form.sellingPrice > 0) {
    errors.sellingPrice = 'Selling price is below purchase price'
  }
  const gst = isValidGstRate(form.gstRate)
  if (gst) errors.gstRate = gst
  const min = minZero(form.minimumStock, 'Minimum stock')
  if (min) errors.minimumStock = min
  const max = minZero(form.maximumStock, 'Maximum stock')
  if (max) errors.maximumStock = max
  if (form.maximumStock > 0 && form.minimumStock > form.maximumStock) {
    errors.minimumStock = 'Minimum stock cannot exceed maximum stock'
  }
  return errors
}

export interface SaleValidationResult {
  ok: boolean
  message: string
}

export function validateCartForSale(cartTotal: number, itemsCount: number): SaleValidationResult {
  if (itemsCount === 0) return { ok: false, message: 'The cart is empty. Scan a product to begin.' }
  if (cartTotal < 0) return { ok: false, message: 'Cart total cannot be negative.' }
  return { ok: true, message: '' }
}

export function validatePaymentTotals(
  total: number,
  received: number,
  payments: Array<{ amount: number }>,
): SaleValidationResult {
  const sum = payments.reduce((acc, p) => acc + (p.amount || 0), 0)
  if (received < total) return { ok: false, message: 'Received amount is less than the total.' }
  if (Math.abs(sum - total) > 0.05) {
    return { ok: false, message: 'Allocated payments do not add up to the total.' }
  }
  return { ok: true, message: '' }
}