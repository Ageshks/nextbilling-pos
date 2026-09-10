/**
 * Transaction regression tests — run against the Firebase Emulator Suite.
 *
 * These tests exercise the REAL production services (same Firestore calls, the
 * project's own security rules) end to end:
 *   purchase (stock in) → purchase return → credit sale → sale return → void
 *
 * They exist because these transactions used to abort with
 * "Firestore transactions require all reads to be executed before all writes"
 * (every read must happen before the first write inside a Firestore
 * transaction), which silently blocked purchase saving, credit (udhaar) sales,
 * multi-item returns and voids.
 *
 * Usage:
 *   npm run emulators    # terminal 1 — starts auth + firestore emulators
 *   npm test             # this suite SKIPS itself when the emulators are
 *                        # not running, so plain `npm test` stays green.
 */
import { afterAll, describe, expect, it } from "vitest"
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

// Route every Auth/Firestore call made by the services to the local emulators.
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } }
if (g.process?.env) g.process.env.VITE_USE_EMULATORS = '1'

import { getAuthInstance } from '../firebase/auth'
import { COLLECTIONS, getDb } from '../firebase/firestore'
import { createInitialSetup } from './seedService'
import { createSupplier, getSupplier } from './supplierService'
import { createProduct, getProduct } from './productService'
import { createCustomer, getCustomer } from './customerService'
import { createPurchase, createPurchaseReturn, listPurchases } from './purchaseService'
import { completeSale, getSale, processReturn, cancelSale } from './salesService'
import { listStockMovements } from './inventoryService'
import type { ProductDraft, SaleItem } from '../types'

const productDraft = (name: string, purchasePrice: number, sellingPrice: number, gstRate = 0): ProductDraft => ({
  name, barcode: '', sku: '', categoryId: '', categoryName: '', brandId: '', brandName: '',
  unit: 'piece', purchasePrice, sellingPrice, mrp: sellingPrice, gstRate,
  minimumStock: 5, maximumStock: 0, supplierId: '', imageUrl: '', description: '',
  active: true, trackInventory: true, expiryTracking: false,
})

const saleItem = (
  p: { id?: string; name: string; purchasePrice: number; sellingPrice: number; gstRate: number },
  quantity: number,
): SaleItem => ({
  productId: p.id ?? '', name: p.name, barcode: '', sku: '', unit: 'piece', quantity,
  sellingPrice: p.sellingPrice, mrp: p.sellingPrice, purchasePrice: p.purchasePrice,
  gstRate: p.gstRate, discount: 0, taxableAmount: p.sellingPrice * quantity,
  gstAmount: 0, lineTotal: p.sellingPrice * quantity,
})

/** Helper: create a product and return {id, ...draft}. */
async function stubProduct(storeId: string, draft: ProductDraft, createdBy: string) {
  const id = await createProduct(storeId, draft, createdBy)
  return { id, ...draft }
}

describe('Firestore transactions (emulator)', () => {
  afterAll(async () => {
    await signOut(getAuthInstance()).catch(() => undefined)
  })

  it('records a multi-line purchase, then return/sale/void flows all persist', async (ctx) => {
    // Skip when the emulators are not running.
    const reachable = await Promise.all([
      fetch('http://127.0.0.1:9099/').then((r) => r.ok).catch(() => false),
      fetch('http://127.0.0.1:8080/').then((r) => r.ok).catch(() => false),
    ])
    if (!reachable.every(Boolean)) {
      ctx.skip(true, 'Firebase emulators not running — start them with `npm run emulators`')
      return
    }

    getDb()
    getAuthInstance()

    const email = `owner-${Date.now()}@emulator.test`
    const cred = await createUserWithEmailAndPassword(getAuthInstance(), email, 'password123')
    const ownerUid = cred.user.uid

    const { storeId } = await createInitialSetup({
      ownerUid, ownerName: 'Emulator Owner', ownerEmail: email, storeName: 'Emulator SuperMart',
    })

    const supplierId = await createSupplier(
      storeId,
      { name: 'Emulator Supplier', company: '', phone: '', email: '', address: '', gstNumber: '', notes: '' },
      ownerUid,
    )

    const productA = await stubProduct(storeId, productDraft('Product A', 100, 120, 0), ownerUid)
    const productB = await stubProduct(storeId, productDraft('Product B', 50, 60, 5), ownerUid)
    // ---- 1) Multi-line purchase (Product A listed twice → aggregate) --------
    const purchaseId = await createPurchase({
      storeId,
      supplierId,
      supplierName: 'Emulator Supplier',
      supplierInvoiceNumber: 'INV-42',
      purchaseDate: Date.now(),
      items: [
        { productId: productA.id!, name: 'Product A', unit: 'piece', quantity: 2, purchasePrice: 100, gstRate: 0, gstAmount: 0, lineTotal: 200 },
        { productId: productB.id!, name: 'Product B', unit: 'piece', quantity: 3, purchasePrice: 50, gstRate: 5, gstAmount: 7.5, lineTotal: 157.5 },
        { productId: productA.id!, name: 'Product A', unit: 'piece', quantity: 1, purchasePrice: 100, gstRate: 0, gstAmount: 0, lineTotal: 100 },
      ],
      subtotal: 450,
      discount: 0,
      gstAmount: 7.5,
      total: 457.5,
      paidAmount: 200,
      notes: '',
      createdBy: ownerUid,
    })

    const purchaseSnap = await getDoc(doc(getDb(), COLLECTIONS.purchases, purchaseId))
    expect(purchaseSnap.exists()).toBe(true)
    expect(purchaseSnap.data()?.purchaseNumber).toBe(`PO-${new Date().getFullYear()}-000001`)
    expect(purchaseSnap.data()?.status).toBe('PARTIAL')

    // Stock increased once per product (A: 2+1 aggregated → +3, B: +3).
    expect((await getProduct(productA.id!))?.stock).toBe(3)
    expect((await getProduct(productB.id!))?.stock).toBe(13)

    // Ledger movements written per product.
    const movements = (await listStockMovements(storeId)).filter((m) => m.referenceId === purchaseId)
    expect(movements).toHaveLength(2)
    expect(movements.find((m) => m.productId === productA.id)).toMatchObject({ type: 'PURCHASE', quantity: 3, beforeStock: 0, afterStock: 3 })
    expect(movements.find((m) => m.productId === productB.id)).toMatchObject({ type: 'PURCHASE', quantity: 3, beforeStock: 10, afterStock: 13 })

    // Supplier payables updated.
    const supplier = await getSupplier(supplierId)
    expect(supplier?.outstandingBalance).toBeCloseTo(257.5, 2)
    expect(supplier?.totalPurchases).toBeCloseTo(457.5, 2)

    // Counter allocated exactly one number.
    const counterSnap = await getDoc(doc(getDb(), COLLECTIONS.stores, storeId, 'counters', 'purchases'))
    expect(counterSnap.data()?.current).toBe(1)

    // The purchases list query (storeId + createdAt range) finds the record.
    const rows = await listPurchases({ storeId, from: Date.now() - 86400000, to: Date.now() + 86400000, max: 50 })
    expect(rows.map((r) => r.id)).toContain(purchaseId)
    // ---- 2) Purchase return (BUYBACK needs no open cash session) ------------
    const returnId = await createPurchaseReturn({
      storeId,
      purchaseId,
      purchaseNumber: `PO-${new Date().getFullYear()}-000001`,
      supplierId,
      supplierName: 'Emulator Supplier',
      items: [
        { productId: productB.id!, name: 'Product B', unit: 'piece', quantity: 2, purchasePrice: 50, gstRate: 5, gstAmount: 5, lineTotal: 105 },
      ],
      method: 'BUYBACK',
      buyBackNet: 105,
      notes: 'emulator test',
      createdBy: ownerUid,
    })
    expect(returnId).toBeTruthy()
    expect((await getProduct(productB.id!))?.stock).toBe(11) // 13 - 2
    const supplierAfterReturn = await getSupplier(supplierId)
    expect(supplierAfterReturn?.outstandingBalance).toBeCloseTo(152.5, 2)
    expect(supplierAfterReturn?.totalPurchases).toBeCloseTo(352.5, 2)
    // ---- 3) Credit (udhaar) sale with a multi-line cart ---------------------
    const customerId = await createCustomer(
      storeId,
      { name: 'Emulator Customer', phone: '9999999999', email: '', address: '', notes: '' },
      ownerUid,
    )
    const sale = await completeSale({
      storeId,
      customerId,
      customerName: 'Emulator Customer',
      cashierId: ownerUid,
      cashierName: 'Emulator Owner',
      items: [
        saleItem({ id: productA.id, name: 'Product A', purchasePrice: 100, sellingPrice: 120, gstRate: 0 }, 1),
        saleItem({ id: productB.id, name: 'Product B', purchasePrice: 50, sellingPrice: 60, gstRate: 5 }, 2),
      ],
      subtotal: 240, discount: 0, taxableAmount: 240, gstAmount: 0, total: 240, gstIncluded: true,
      payments: [{ method: 'CASH', amount: 200 }, { method: 'CREDIT', amount: 40 }],
      amountReceived: 200, changeGiven: 0, creditAmount: 40,
      notes: '', heldBillId: '', invoicePrefix: 'SM', enableNegativeStock: false, currency: 'INR',
    })
    expect(sale.invoiceNumber).toBe(`SM-${new Date().getFullYear()}-000001`)
    expect((await getProduct(productA.id!))?.stock).toBe(2) // 3 - 1
    expect((await getProduct(productB.id!))?.stock).toBe(9) // 11 - 2
    expect((await getCustomer(customerId))?.creditBalance).toBe(40)
    expect((await getCustomer(customerId))?.totalSpent).toBe(240)
    // ---- 4) Multi-item sale return (restores stock, updates the sale) -------
    const saleReturnId = await processReturn({
      storeId,
      saleId: sale.sale.id!,
      invoiceNumber: sale.invoiceNumber,
      customerId,
      cashierId: ownerUid,
      cashierName: 'Emulator Owner',
      items: [
        { productId: productA.id!, name: 'Product A', quantity: 1, sellingPrice: 120, purchasePrice: 100 },
        { productId: productB.id!, name: 'Product B', quantity: 1, sellingPrice: 60, purchasePrice: 50 },
      ],
      refundAmount: 180,
      reason: 'emulator test',
    })
    expect(saleReturnId).toBeTruthy()
    expect((await getProduct(productA.id!))?.stock).toBe(3)
    expect((await getProduct(productB.id!))?.stock).toBe(10)
    expect((await getSale(sale.sale.id!))?.status).toBe('PARTIALLY_RETURNED')
    // ---- 5) Void a credit sale (restores stock + credit balance) -------------
    const sale2 = await completeSale({
      storeId,
      customerId,
      customerName: 'Emulator Customer',
      cashierId: ownerUid,
      cashierName: 'Emulator Owner',
      items: [saleItem({ id: productA.id, name: 'Product A', purchasePrice: 100, sellingPrice: 120, gstRate: 0 }, 1)],
      subtotal: 120, discount: 0, taxableAmount: 120, gstAmount: 0, total: 120, gstIncluded: true,
      payments: [{ method: 'CASH', amount: 90 }, { method: 'CREDIT', amount: 30 }],
      amountReceived: 90, changeGiven: 0, creditAmount: 30,
      notes: '', heldBillId: '', invoicePrefix: 'SM', enableNegativeStock: false, currency: 'INR',
    })
    expect((await getProduct(productA.id!))?.stock).toBe(2)
    expect((await getCustomer(customerId))?.creditBalance).toBe(70)

    await cancelSale(sale2.sale.id!, storeId, ownerUid, 'emulator test')
    expect((await getProduct(productA.id!))?.stock).toBe(3)
    expect((await getCustomer(customerId))?.creditBalance).toBe(40)
    expect((await getSale(sale2.sale.id!))?.status).toBe('CANCELLED')
  })
})
