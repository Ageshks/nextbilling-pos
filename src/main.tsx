import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import { AuthProvider } from './context/AuthContext'
import { StoreProvider } from './context/StoreContext'
import { AppRoutes } from './routes/AppRoutes'
import { isFirebaseConfigured } from './firebase/config'

function Root() {
  if (!isFirebaseConfigured()) {
    return <ConfigNotice />
  }
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <StoreProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </StoreProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

function ConfigNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-700 dark:bg-amber-900/20">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">Firebase not configured</h1>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
          Copy <code className="rounded bg-slate-200 px-1 py-0.5 dark:bg-slate-700">.env.example</code> to{' '}
          <code className="rounded bg-slate-200 px-1 py-0.5 dark:bg-slate-700">.env</code> and fill in your Firebase
          web app values, then restart the dev server. See the README for step-by-step setup.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Firebase web configuration is not a secret, but Firestore Security Rules are required to keep your data safe.
        </p>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('app')!)
root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
)