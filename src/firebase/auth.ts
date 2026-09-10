import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth'
import { getFirebaseApp } from './config'
import { useEmulators } from './firestore'

let _auth: ReturnType<typeof getAuth> | null = null

export function getAuthInstance(): ReturnType<typeof getAuth> {
  if (!_auth) {
    _auth = getAuth(getFirebaseApp())
    if (useEmulators()) {
      connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    }
  }
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