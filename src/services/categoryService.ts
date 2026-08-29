import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { Category, Brand } from '../types'

// ---------------------------------------------------------------------------
// Real-time subscriptions
//
// The POS keeps category/brand lists live via onSnapshot so every screen
// (product form, reports, filters) reflects creates/edits instantly across
// tabs without page reloads. Creation/edit itself lives in productService —
// the listener is the ONLY thing that updates UI state (never manual appends,
// which would duplicate rows when the snapshot also fires).
//
// Queries are deliberately storeId-equality ONLY and sort client-side. A
// bare `where(storeId == x)` needs no composite index, so category/brand
// lists work instantly on any project — no Firestore index build required.
// ---------------------------------------------------------------------------

const byName = <T extends { name?: string }>(a: T, b: T): number =>
  (a.name ?? '').localeCompare(b.name ?? '')

/** Subscribe to a store's categories sorted by name. Returns unsubscribe. */
export function subscribeToCategories(
  storeId: string,
  onData: (rows: Category[]) => void,
  onError: (err: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), COLLECTIONS.categories),
    where('storeId', '==', storeId),
  )
  return onSnapshot(
    q,
    (snap) => {
      // active===false means softly deleted; legacy docs without the flag stay visible.
      const all = unwrapDocs<Category>(snap.docs)
        .filter((c) => c.active !== false)
        .sort(byName)
      onData(all)
    },
    onError,
  )
}

/** Subscribe to a store's brands sorted by name. Returns unsubscribe. */
export function subscribeToBrands(
  storeId: string,
  onData: (rows: Brand[]) => void,
  onError: (err: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), COLLECTIONS.brands),
    where('storeId', '==', storeId),
  )
  return onSnapshot(
    q,
    (snap) => {
      const all = unwrapDocs<Brand>(snap.docs)
        .filter((b) => b.active !== false)
        .sort(byName)
      onData(all)
    },
    onError,
  )
}

/**
 * Soft-delete: referenced products keep resolving names historically.
 * The realtime listeners drop inactive rows automatically.
 */
export async function deactivateCategory(id: string): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.categories, id), {
    active: false,
    updatedAt: serverTimestamp(),
  })
}

export async function deactivateBrand(id: string): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.brands, id), {
    active: false,
    updatedAt: serverTimestamp(),
  })
}

export async function restoreCategory(id: string): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.categories, id), {
    active: true,
    updatedAt: serverTimestamp(),
  })
}

export async function restoreBrand(id: string): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTIONS.brands, id), {
    active: true,
    updatedAt: serverTimestamp(),
  })
}