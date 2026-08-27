import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type { Unit, ProductDraft } from '../types'
import { DEFAULT_SETTINGS } from './settingsService'

/**
 * Creates the initial store + settings + owner user documents after the first
 * owner signs up. This is the systematic bootstrap for a fresh deployment.
 */
export async function createInitialSetup(params: {
  ownerUid: string
  ownerName: string
  ownerEmail: string
  storeName: string
}): Promise<{ storeId: string }> {
  const db = getDb()
  const storeId = doc(collection(db, COLLECTIONS.stores)).id

  // One atomic batch so the whole store+settings+owner-profile+counters set is
  // created together. This prevents the "partial bootstrap" state (e.g. a user
  // profile without its store) that blocked first-run setup before.
  const batch = writeBatch(db)

  batch.set(doc(db, COLLECTIONS.stores, storeId), {
    name: params.storeName,
    ownerEmail: params.ownerEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  batch.set(doc(db, COLLECTIONS.settings, storeId), {
    ...DEFAULT_SETTINGS,
    name: params.storeName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  batch.set(doc(db, COLLECTIONS.users, params.ownerUid), {
    storeId,
    name: params.ownerName,
    email: params.ownerEmail,
    role: 'OWNER',
    status: 'active',
    phone: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.ownerUid,
  })

  batch.set(doc(db, COLLECTIONS.stores, storeId, 'counters', 'sales'), {
    current: 0,
    updatedAt: serverTimestamp(),
  })
  batch.set(doc(db, COLLECTIONS.stores, storeId, 'counters', 'purchases'), {
    current: 0,
    updatedAt: serverTimestamp(),
  })

  await batch.commit()

  return { storeId }
}

const SEED_CATEGORIES = [
  'Groceries',
  'Dairy',
  'Bakery',
  'Beverages',
  'Snacks',
  'Personal Care',
  'Household',
  'Stationery',
]

interface SeedProduct {
  name: string
  barcode: string
  sku: string
  category: string
  unit: Unit
  purchasePrice: number
  sellingPrice: number
  gstRate: number
  stock: number
  minimumStock: number
}

const SEED_PRODUCTS: SeedProduct[] = [
  { name: 'Milk 1L', barcode: '8901001001', sku: 'MLK-1L', category: 'Dairy', unit: 'packet', purchasePrice: 52, sellingPrice: 62, gstRate: 0, stock: 50, minimumStock: 10 },
  { name: 'Whole Wheat Bread', barcode: '8901001002', sku: 'BRD-WW', category: 'Bakery', unit: 'packet', purchasePrice: 32, sellingPrice: 40, gstRate: 0, stock: 30, minimumStock: 8 },
  { name: 'Basmati Rice 5kg', barcode: '8901001003', sku: 'RIC-5KG', category: 'Groceries', unit: 'packet', purchasePrice: 340, sellingPrice: 385, gstRate: 5, stock: 20, minimumStock: 5 },
  { name: 'Sugar 1kg', barcode: '8901001004', sku: 'SUG-1KG', category: 'Groceries', unit: 'packet', purchasePrice: 41, sellingPrice: 48, gstRate: 5, stock: 40, minimumStock: 10 },
  { name: 'Eggs (Tray 30)', barcode: '8901001005', sku: 'EGG-30', category: 'Dairy', unit: 'packet', purchasePrice: 150, sellingPrice: 175, gstRate: 0, stock: 25, minimumStock: 6 },
  { name: 'Marie Biscuits', barcode: '8901001006', sku: 'BSK-MARIE', category: 'Snacks', unit: 'packet', purchasePrice: 28, sellingPrice: 34, gstRate: 12, stock: 60, minimumStock: 15 },
  { name: 'Mineral Water 1L', barcode: '8901001007', sku: 'WTR-1L', category: 'Beverages', unit: 'litre', purchasePrice: 17, sellingPrice: 20, gstRate: 12, stock: 80, minimumStock: 20 },
  { name: 'Tea Powder 500g', barcode: '8901001008', sku: 'TEA-500G', category: 'Beverages', unit: 'packet', purchasePrice: 120, sellingPrice: 145, gstRate: 5, stock: 15, minimumStock: 4 },
  { name: 'Instant Coffee 100g', barcode: '8901001009', sku: 'COF-100G', category: 'Beverages', unit: 'packet', purchasePrice: 190, sellingPrice: 225, gstRate: 18, stock: 12, minimumStock: 3 },
  { name: 'Bathing Soap', barcode: '8901001010', sku: 'SOAP-BATH', category: 'Personal Care', unit: 'piece', purchasePrice: 22, sellingPrice: 28, gstRate: 18, stock: 90, minimumStock: 20 },
  { name: 'Shampoo 200ml', barcode: '8901001011', sku: 'SHMP-200ML', category: 'Personal Care', unit: 'ml', purchasePrice: 118, sellingPrice: 142, gstRate: 18, stock: 18, minimumStock: 5 },
  { name: 'Detergent Powder 1kg', barcode: '8901001012', sku: 'DET-1KG', category: 'Household', unit: 'packet', purchasePrice: 140, sellingPrice: 168, gstRate: 18, stock: 22, minimumStock: 6 },
]

/**
 * Seeds a store with sample categories, brands, products.
 * Development only; gated by VITE_ENABLE_SEED=1 and never runs automatically.
 */
export async function seedStore(storeId: string, createdBy: string): Promise<number> {
  const db = getDb()
  const batch = writeBatch(db)

  const categoryIds: Record<string, string> = {}
  for (const cat of SEED_CATEGORIES) {
    const ref = doc(collection(db, COLLECTIONS.categories))
    categoryIds[cat] = ref.id
    batch.set(ref, {
      storeId,
      name: cat,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  const brandRefs = ['Amul', 'Britannia', 'India Gate', 'Nestle', 'Tata', 'Dettol', 'Sunsilk', 'Surf']
  const brandIds: Record<string, string> = {}
  for (const b of brandRefs) {
    const ref = doc(collection(db, COLLECTIONS.brands))
    brandIds[b] = ref.id
    batch.set(ref, { storeId, name: b, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }

  let count = 0
  for (const p of SEED_PRODUCTS) {
    const brandName = p.name === 'Milk 1L' ? 'Amul' : 'Tata'
    const payload: ProductDraft = {
      name: p.name,
      barcode: p.barcode,
      sku: p.sku,
      categoryId: categoryIds[p.category] ?? '',
      categoryName: p.category,
      brandId: brandIds[brandName] ?? '',
      brandName,
      unit: p.unit,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      mrp: Math.round(p.sellingPrice * 1.1),
      gstRate: p.gstRate,
      minimumStock: p.minimumStock,
      maximumStock: 0,
      supplierId: '',
      imageUrl: '',
      description: '',
      active: true,
      trackInventory: true,
      expiryTracking: false,
    }
    const ref = doc(collection(db, COLLECTIONS.products))
    batch.set(ref, {
      storeId,
      ...payload,
      stock: p.stock,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy,
    })
    count++
  }

  await batch.commit()
  return count
}

export function seedFeatureEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_SEED === '1'
}