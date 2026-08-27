import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'

// Firebase web configuration values are NOT server secrets —
// they are safe to embed in client bundles. Real security is enforced
// by Firestore Security Rules and Firebase Authentication.
// Provide values via a .env file (see .env.example). A valid app will
// not start until the variables are set.

export interface FirebaseEnv {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

export function getFirebaseEnv(): FirebaseEnv {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  }
}

export function isFirebaseConfigured(): boolean {
  const env = getFirebaseEnv()
  return Boolean(env.apiKey && env.authDomain && env.projectId && env.appId)
}

let app: FirebaseApp | null = null

export function getFirebaseApp(): FirebaseApp {
  if (app) return app
  const existing = getApps()[0]
  if (existing) {
    app = existing
    return existing
  }
  const env = getFirebaseEnv()
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env and fill in your Firebase project values.',
    )
  }
  app = initializeApp({
    apiKey: env.apiKey,
    authDomain: env.authDomain,
    projectId: env.projectId,
    storageBucket: env.storageBucket,
    messagingSenderId: env.messagingSenderId,
    appId: env.appId,
  })
  return app
}