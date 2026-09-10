import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  limit,
  increment,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { Voucher, VoucherDraft, VoucherSoldVia } from '../types'
import { round2 } from '../utils/calculations'

function randomCode(): string {
  // Unambiguous alphabet (no 0/O/1/I) so codes are easy to read aloud.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `GV-${code}`
}

export async function createVoucher(
  draft: VoucherDraft,
  createdBy: string,
): Promise<string> {
  const db = getDb()
  const ref = await addDoc(collection(db, COLLECTIONS.vouchers), {
    ...draft,
    code: (draft.code || randomCode()).toUpperCase().trim(),
    balance: round2(draft.amount),
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  })
  return ref.id
}

export async function listVouchers(storeId: string, max = 300): Promise<Voucher[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.vouchers),
    where('storeId', '==', storeId),
    limit(max),
  )
  const snap = await getDocs(q)
  const rows = unwrapDocs<Voucher>(snap.docs)
  return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/** Lightweight check used by the POS payment modal before completing the sale. */
export async function findVoucherByCode(storeId: string, code: string): Promise<Voucher | null> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.vouchers),
    where('storeId', '==', storeId),
    where('code', '==', code.trim().toUpperCase()),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return { ...(d.data() as object), id: d.id } as Voucher
}

export async function voidVoucher(id: string, updatedBy: string): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.vouchers, id), {
    status: 'VOID',
    balance: 0,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

/**
 * Records a manual balance top-up/adjustment (rare corrections by managers).
 */
export async function adjustVoucherBalance(id: string, delta: number, updatedBy: string): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.vouchers, id), {
    balance: increment(round2(delta)),
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}

export function voucherSummary(vouchers: Voucher[]): { issued: number; outstanding: number } {
  const active = vouchers.filter((v) => v.status === 'ACTIVE')
  return {
    issued: active.reduce((sum, v) => sum + v.amount, 0),
    outstanding: active.reduce((sum, v) => sum + v.balance, 0),
  }
}

export type { VoucherSoldVia }