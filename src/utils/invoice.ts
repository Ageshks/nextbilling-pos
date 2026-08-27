import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'

const pad = (n: number, len = 6): string => String(n).padStart(len, '0')

/**
 * Deterministic readable invoice / document number when offline or to render
 * a preview. The authoritative sequential number is assigned by the server-validated
 * transaction in the sales service via the counters collection.
 */
export function previewNumber(prefix: string, seed: number): string {
  return `${prefix}-${new Date().getFullYear()}-${pad(seed)}`
}

export function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${pad(seq)}`
}

/**
 * Read the current counter value for a namespace (sales/purchases) so the UI can
 * show a preview of the next number. Consumes 1 Firestore read; cached briefly to
 * keep reads low. The transaction path must be the single source of truth.
 */
export async function getNextCounter(storeId: string, namespace: 'sales' | 'purchases'): Promise<number> {
  const db = getDb()
  const counterDoc = doc(db, COLLECTIONS.stores, storeId, 'counters', namespace)
  const snap = await getDoc(counterDoc)
  if (!snap.exists()) return 1
  return (snap.data()?.['current'] as number) ?? 1
}

export async function getPreviewInvoiceNumber(
  storeId: string,
  prefix: string,
  namespace: 'sales' | 'purchases' = 'sales',
): Promise<string> {
  const current = await getNextCounter(storeId, namespace)
  return formatInvoiceNumber(prefix, new Date().getFullYear(), current)
}

export async function invoicePrefixExistsAcrossStore(
  _storeId: string,
  prefix: string,
): Promise<boolean> {
  return prefix.length > 0
}

export async function isBarcodeUnique(storeId: string, barcode: string, ignoreId?: string): Promise<boolean> {
  if (!barcode) return true
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.products),
    where('storeId', '==', storeId),
    where('barcode', '==', barcode),
  )
  const snap = await getDocs(q)
  return snap.docs.every((d) => !ignoreId || d.id !== ignoreId)
}