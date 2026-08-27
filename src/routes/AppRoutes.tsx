import { lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { ProtectedRoute } from './ProtectedRoute'
import { Spinner } from '../components/ui/Spinner'

const LoginPage = lazy(() => import('../pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('../pages/auth/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('../pages/auth/ForgotPasswordPage'))
const SetupStorePage = lazy(() => import('../pages/auth/SetupStorePage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))
const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'))
const POSPage = lazy(() => import('../pages/pos/POSPage'))
const SalesPage = lazy(() => import('../pages/sales/SalesPage'))
const ProductsPage = lazy(() => import('../pages/products/ProductsPage'))
const InventoryPage = lazy(() => import('../pages/inventory/InventoryPage'))
const PurchasesPage = lazy(() => import('../pages/purchases/PurchasesPage'))
const SuppliersPage = lazy(() => import('../pages/suppliers/SuppliersPage'))
const CustomersPage = lazy(() => import('../pages/customers/CustomersPage'))
const ExpensesPage = lazy(() => import('../pages/expenses/ExpensesPage'))
const ReportsPage = lazy(() => import('../pages/reports/ReportsPage'))
const AIInsightsPage = lazy(() => import('../pages/insights/AIInsightsPage'))
const WhatsAppOrdersPage = lazy(() => import('../pages/whatsapp/WhatsAppOrdersPage'))
const UsersPage = lazy(() => import('../pages/users/UsersPage'))
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage'))

/** Wraps each protected page with a loader during lazy chunk fetch. */
function PageLoader({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner label="Loading…" />}>{children}</Suspense>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/register"
        element={
          <PageLoader>
            <RegisterPage />
          </PageLoader>
        }
      />
      <Route
        path="/login"
        element={
          <PageLoader>
            <LoginPage />
          </PageLoader>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PageLoader>
            <ForgotPasswordPage />
          </PageLoader>
        }
      />
      <Route
        path="/setup"
        element={
          <ProtectedRoute
            children={
              <PageLoader>
                <SetupStorePage />
              </PageLoader>
            }
          />
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route
          path="/"
          element={
            <PageLoader>
              <DashboardPage />
            </PageLoader>
          }
        />
        <Route
          path="/pos"
          element={
            <ProtectedRoute permission="pos">
              <PageLoader>
                <POSPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales"
          element={
            <ProtectedRoute permission="sales">
              <PageLoader>
                <SalesPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute permission="products">
              <PageLoader>
                <ProductsPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory"
          element={
            <ProtectedRoute permission="inventory">
              <PageLoader>
                <InventoryPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchases"
          element={
            <ProtectedRoute permission="purchases">
              <PageLoader>
                <PurchasesPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/suppliers"
          element={
            <ProtectedRoute permission="suppliers">
              <PageLoader>
                <SuppliersPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute permission="customers">
              <PageLoader>
                <CustomersPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses"
          element={
            <ProtectedRoute permission="expenses">
              <PageLoader>
                <ExpensesPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute permission="reports">
              <PageLoader>
                <ReportsPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/insights"
          element={
            <ProtectedRoute permission="reports">
              <PageLoader>
                <AIInsightsPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/whatsapp"
          element={
            <ProtectedRoute permission="pos">
              <PageLoader>
                <WhatsAppOrdersPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute permission="users">
              <PageLoader>
                <UsersPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute permission="settings">
              <PageLoader>
                <SettingsPage />
              </PageLoader>
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
      <Route path="/home" element={<Navigate to="/" replace />} />
    </Routes>
  )
}