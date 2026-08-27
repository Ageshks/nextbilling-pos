import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth'
import { getFirebaseApp } from './config'

let _auth: ReturnType<typeof getAuth> | null = null

export function getAuthInstance(): ReturnType<typeof getAuth> {
  if (!_auth) _auth = getAuth(getFirebaseApp())
  return _auth
}

export function onAuthChange(callback: (user: FirebaseUser | null) => void): () => void {
  return onAuthStateChanged(getAuthInstance(), callback)
}

export async function loginWithEmail(email: string, password: string): Promise<FirebaseUser> {
  const cred = await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password)
  return cred.user
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getAuthInstance(), email.trim())
}

export async function logout(): Promise<void> {
  await signOut(getAuthInstance())
}

export type { FirebaseUser }