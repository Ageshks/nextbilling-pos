import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { AppUser, Role } from '../types'

export async function getUser(uid: string): Promise<AppUser | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.users, uid))
  if (!snap.exists()) return null
  return { ...(snap.data() as Omit<AppUser, 'uid'>), uid } as AppUser
}

export async function listUsers(storeId: string): Promise<AppUser[]> {
  const db = getDb()
  const q = query(collection(db, COLLECTIONS.users), where('storeId', '==', storeId))
  const snap = await getDocs(q)
  return unwrapDocs<AppUser>(snap.docs)
}

export async function createUser(
  uid: string,
  data: { storeId: string; name: string; email: string; role: Role; phone?: string },
  createdBy: string,
): Promise<void> {
  const db = getDb()
  const userRef = doc(db, COLLECTIONS.users, uid)
  await setDoc(userRef, {
    ...data,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  })
}

export async function updateUser(
  uid: string,
  data: Partial<Pick<AppUser, 'name' | 'role' | 'phone' | 'status'>>,
  updatedBy: string,
): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.users, uid), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}