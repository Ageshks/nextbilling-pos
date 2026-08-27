import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  startAfter,
  type DocumentSnapshot,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { Category, Brand, Product, ProductDraft, Role } from '../types'

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(storeId: string): Promise<Category[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.categories),
    where('storeId', '==', storeId),
    orderBy('name', 'asc'),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Category>(snap.docs)
}

export async function createCategory(storeId: string, name: string): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.categories), {
    storeId,
    name: name.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateCategory(storeId: string, id: string, name: string): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.categories, id), {
    storeId,
    name: name.trim(),
    updatedAt: serverTimestamp(),
  })
  const products = await getDocs(
    query(collection(db, COLLECTIONS.products), where('categoryId', '==', id)),
  )
  for (const p of products.docs) {
    await updateDoc(p.ref, { categoryName: name.trim(), updatedAt: serverTimestamp() })
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const db = getDb()
  await deleteDoc(doc(db, COLLECTIONS.categories, id))
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export async function listBrands(storeId: string): Promise<Brand[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.brands),
    where('storeId', '==', storeId),
    orderBy('name', 'asc'),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Brand>(snap.docs)
}

export async function createBrand(storeId: string, name: string): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.brands), {
    storeId,
    name: name.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateBrand(storeId: string, id: string, name: string): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.brands, id), {
    storeId,
    name: name.trim(),
    updatedAt: serverTimestamp(),
  })
  const products = await getDocs(
    query(collection(db, COLLECTIONS.products), where('brandId', '==', id)),
  )
  for (const p of products.docs) {
    await updateDoc(p.ref, { brandName: name.trim(), updatedAt: serverTimestamp() })
  }
}

export async function deleteBrand(id: string): Promise<void> {
  const db = getDb()
  await deleteDoc(doc(db, COLLECTIONS.brands, id))
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  items: T[]
  hasMore: boolean
  lastDoc?: DocumentSnapshot
}

/**
 * Paginated product list ordered by name. Keeps Firestore reads bounded for a
 * small-to-medium supermarket. Search happens client-side over the fetched page.
 */
export async function listProducts(
  storeId: string,
  pageSize = 50,
  last?: DocumentSnapshot,
  activeOnly = false,
): Promise<Paginated<Product>> {
  const db = getDb()
  let q = query(
    collection(db, COLLECTIONS.products),
    where('storeId', '==', storeId),
    orderBy('name', 'asc'),
    limit(pageSize + 1),
  )
  if (activeOnly) {
    q = query(
      collection(db, COLLECTIONS.products),
      where('storeId', '==', storeId),
      where('active', '==', true),
      orderBy('name', 'asc'),
      limit(pageSize + 1),
    )
  }
  if (last) q = query(q, startAfter(last))
  const snap = await getDocs(q)
  const docs = snap.docs.slice(0, pageSize)
  const items = unwrapDocs<Product>(docs)
  return { items, hasMore: snap.docs.length > pageSize, lastDoc: docs[docs.length - 1] }
}

export async function getProduct(id: string): Promise<Product | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.products, id))
  if (!snap.exists()) return null
  return { ...(snap.data() as object), id: snap.id } as Product
}

/**
 * Search products by barcode / name / sku / category / brand.
 * Indexed query first, then scores matches client-side.
 */
export async function searchProducts(
  storeId: string,
  queryText: string,
  includeInactive = false,
  pageSize = 400,
): Promise<Product[]> {
  const text = queryText.trim().toLowerCase()
  const db = getDb()
  let q = query(
    collection(db, COLLECTIONS.products),
    where('storeId', '==', storeId),
    orderBy('name', 'asc'),
    limit(pageSize),
  )
  if (!includeInactive) q = query(q, where('active', '==', true))
  const snap = await getDocs(q)
  const products = unwrapDocs<Product>(snap.docs)

  if (!text) return products

  const scored: Array<{ p: Product; score: number }> = []
  for (const p of products) {
    let score = 0
    const barcode = (p.barcode || '').toLowerCase()
    const sku = (p.sku || '').toLowerCase()
    const name = (p.name || '').toLowerCase()
    if (text === barcode || p.barcode === queryText.trim()) score = 100
    else if (barcode.startsWith(text)) score = 90
    else if (barcode.includes(text)) score = 80
    else if (sku === text) score = 95
    else if (sku.startsWith(text)) score = 70
    else if (name === text) score = 85
    else if (name.startsWith(text)) score = 60
    else if (name.includes(text)) score = 40
    else if ((p.categoryName || '').toLowerCase().includes(text)) score = 20
    else if ((p.brandName || '').toLowerCase().includes(text)) score = 15
    if (score > 0) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
  return scored.slice(0, 30).map((s) => s.p)
}

/** Resolve a product by exact barcode using an indexed query (fastest path). */
export async function findProductByBarcode(storeId: string, barcode: string): Promise<Product | null> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.products),
    where('storeId', '==', storeId),
    where('barcode', '==', barcode.trim()),
    where('active', '==', true),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return { ...(d.data() as object), id: d.id } as Product
}

/** All active products (cached after first load for offline-friendly POS). */
export async function fetchAllProducts(storeId: string): Promise<Product[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.products),
    where('storeId', '==', storeId),
    where('active', '==', true),
    orderBy('name', 'asc'),
  )
  const snap = await getDocs(q)
  return unwrapDocs<Product>(snap.docs)
}

export function canEditPurchasePrice(role: Role | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export async function createProduct(
  storeId: string,
  data: ProductDraft,
  createdBy: string,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.products), {
    storeId,
    ...data,
    stock: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

export async function updateProduct(
  id: string,
  data: Partial<ProductDraft>,
  updatedBy: string,
): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.products, id), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

export async function setProductActive(id: string, active: boolean, updatedBy: string): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.products, id), {
    active,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

export async function updateProductStock(id: string, stock: number): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.products, id), {
    stock,
    updatedAt: serverTimestamp(),
  })
}

export interface ProductImportRow {
  name: string
  barcode: string
  sku: string
  categoryName: string
  brandName: string
  unit: string
  purchasePrice: number
  sellingPrice: number
  mrp: number
  gstRate: number
  stock: number
  minimumStock: number
}

export function parseProductCsv(csv: string): ProductImportRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) return []
  const headers = lines[0].toLowerCase().split(',').map((h) => h.trim())
  const rows: ProductImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = csvLineToValues(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? ''
    })
    if (!row.name) continue
    rows.push({
      name: row.name,
      barcode: row.barcode ?? '',
      sku: row.sku ?? '',
      categoryName: row.category ?? row.categoryname ?? '',
      brandName: row.brand ?? row.brandname ?? '',
      unit: row.unit || 'piece',
      purchasePrice: parseFloat(row.purchaseprice ?? row.costprice) || 0,
      sellingPrice: parseFloat(row.sellingprice ?? row.price) || 0,
      mrp: parseFloat(row.mrp) || parseFloat(row.sellingprice ?? row.price) || 0,
      gstRate: parseFloat(row.gstrate ?? row.tax ?? row.gst) || 0,
      stock: parseFloat(row.stock ?? row.quantity) || 0,
      minimumStock: parseFloat(row.minimumstock ?? row.minstock ?? row.minimum) || 0,
    })
  }
  return rows
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

export async function importProducts(
  storeId: string,
  rows: ProductImportRow[],
  categoryMap: Record<string, string>,
  brandMap: Record<string, string>,
  createdBy: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row.name) {
      result.skipped++
      continue
    }
    try {
      let categoryId = ''
      let categoryName = ''
      if (row.categoryName) {
        categoryId = categoryMap[row.categoryName.toLowerCase()]
        categoryName = categoryMap[row.categoryName.toLowerCase()] ? row.categoryName : ''
        if (!categoryId) {
          categoryId = await createCategory(storeId, row.categoryName)
          categoryMap[row.categoryName.toLowerCase()] = categoryId
          categoryName = row.categoryName
        }
      }
      let brandId = ''
      let brandName = ''
      if (row.brandName) {
        brandId = brandMap[row.brandName.toLowerCase()]
        brandName = brandMap[row.brandName.toLowerCase()] ? row.brandName : ''
        if (!brandId) {
          brandId = await createBrand(storeId, row.brandName)
          brandMap[row.brandName.toLowerCase()] = brandId
          brandName = row.brandName
        }
      }
      const existing = row.barcode ? await findProductByBarcode(storeId, row.barcode) : null
      const payload: ProductDraft = {
        name: row.name,
        barcode: row.barcode || '',
        sku: row.sku || '',
        categoryId,
        categoryName,
        brandId,
        brandName,
        unit: (row.unit as Product['unit']) || 'piece',
        purchasePrice: row.purchasePrice,
        sellingPrice: row.sellingPrice,
        mrp: row.mrp || row.sellingPrice,
        gstRate: row.gstRate,
        minimumStock: row.minimumStock,
        maximumStock: 0,
        supplierId: '',
        imageUrl: '',
        description: '',
        active: true,
        trackInventory: true,
        expiryTracking: false,
      }
      if (existing && existing.id) {
        await updateProduct(existing.id, payload, createdBy)
        if (row.stock > 0) await updateProductStock(existing.id, row.stock)
        result.updated++
      } else {
        const newId = await createProduct(storeId, payload, createdBy)
        if (row.stock > 0) await updateProductStock(newId, row.stock)
        result.created++
      }
    } catch {
      result.errors.push(`Row ${i + 2} failed`)
    }
    if (onProgress) onProgress(i + 1, rows.length)
  }
  return result
}

function csvLineToValues(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else current += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      values.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  values.push(current.trim())
  return values
}

export function buildProductCsvTemplate(): string {
  return (
    'name,barcode,sku,category,brand,unit,purchasePrice,sellingPrice,mrp,gstRate,stock,minimumStock\n' +
    'Milk 1L,8901001,MLK-1L,Dairy,Amul,packet,52,62,65,0,50,10\n' +
    'Basmati Rice 5kg,8901002,RIC-5KG,Groceries,India Gate,packet,340,385,400,5,20,5'
  )
}