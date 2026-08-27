import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Package,
  Boxes,
  Truck,
  Factory,
  Users,
  Wallet,
  BarChart3,
  UserCog,
  Settings,
  Sparkles,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { RolePermission } from '../../types'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  permission: keyof RolePermission | 'none'
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, permission: 'none' },
  { label: 'POS / Billing', to: '/pos', icon: ShoppingCart, permission: 'pos' },
  { label: 'Sales', to: '/sales', icon: ReceiptText, permission: 'sales' },
  { label: 'Products', to: '/products', icon: Package, permission: 'products' },
  { label: 'Inventory', to: '/inventory', icon: Boxes, permission: 'inventory' },
  { label: 'Purchases', to: '/purchases', icon: Truck, permission: 'purchases' },
  { label: 'Suppliers', to: '/suppliers', icon: Factory, permission: 'suppliers' },
  { label: 'Customers', to: '/customers', icon: Users, permission: 'customers' },
  { label: 'Expenses', to: '/expenses', icon: Wallet, permission: 'expenses' },
  { label: 'Reports', to: '/reports', icon: BarChart3, permission: 'reports' },
  { label: 'AI Insights', to: '/insights', icon: Sparkles, permission: 'reports' },
  { label: 'WhatsApp Orders', to: '/whatsapp', icon: MessageCircle, permission: 'pos' },
  { label: 'Users', to: '/users', icon: UserCog, permission: 'users' },
  { label: 'Settings', to: '/settings', icon: Settings, permission: 'settings' },
]

export function useVisibleNavItems(): NavItem[] {
  const { can, role } = useAuth()
  return NAV_ITEMS.filter((item) => {
    if (!role) return false
    if (item.permission === 'none') return true
    return can(item.permission)
  })
}

interface SidebarProps {
  currentPath: string
  onNavigate?: () => void
  collapsed?: boolean
}

export function Sidebar({ currentPath, onNavigate, collapsed = false }: SidebarProps) {
  const navigate = useNavigate()
  const items = useVisibleNavItems()
  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      {items.map((item) => {
        const Icon = item.icon
        const active = currentPath === item.to || (item.to !== '/' && currentPath.startsWith(item.to))
        return (
          <button
            key={item.to}
            type="button"
            onClick={() => {
              navigate(item.to)
              onNavigate?.()
            }}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/40'
            } ${collapsed ? 'justify-center' : ''}`}
            title={item.label}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>
        )
      })}
    </nav>
  )
}