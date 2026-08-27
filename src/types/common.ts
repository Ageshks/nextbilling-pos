// Shared domain types and constants used across the application.

export type Role = 'OWNER' | 'ADMIN' | 'CASHIER' | 'INVENTORY'

export interface RolePermission {
  all: boolean
  pos: boolean
  sales: boolean
  products: boolean
  inventory: boolean
  purchases: boolean
  suppliers: boolean
  customers: boolean
  expenses: boolean
  reports: boolean
  users: boolean
  settings: boolean
  cash: boolean
  canCancelSales: boolean
  canManageUsers: boolean
  canEditSettings: boolean
  canDeleteSales: boolean
  canEditPurchasePrice: boolean
}

export const ROLES: Record<Role, RolePermission> = {
  OWNER: {
    all: true,
    pos: true,
    sales: true,
    products: true,
    inventory: true,
    purchases: true,
    suppliers: true,
    customers: true,
    expenses: true,
    reports: true,
        users: true,
    settings: true,
    cash: true,
    canCancelSales: true,
    canManageUsers: true,
    canEditSettings: true,
    canDeleteSales: true,
    canEditPurchasePrice: true,
  },
  ADMIN: {
    all: true,
    pos: true,
    sales: true,
    products: true,
    inventory: true,
    purchases: true,
    suppliers: true,
    customers: true,
    expenses: true,
    reports: true,
    users: false,
    settings: false,
    cash: true,
    canCancelSales: true,
    canManageUsers: false,
    canEditSettings: false,
    canDeleteSales: false,
    canEditPurchasePrice: true,
  },
  CASHIER: {
    all: false,
    pos: true,
    sales: true,
    products: true,
    inventory: false,
    purchases: false,
    suppliers: false,
    customers: true,
    expenses: false,
    reports: false,
    users: false,
    settings: false,
    cash: false,
    canCancelSales: false,
    canManageUsers: false,
    canEditSettings: false,
    canDeleteSales: false,
    canEditPurchasePrice: false,
  },
  INVENTORY: {
    all: false,
    pos: false,
    sales: false,
    products: true,
    inventory: true,
    purchases: true,
    suppliers: true,
    customers: false,
    expenses: false,
    reports: false,
    users: false,
    settings: false,
    cash: false,
    canCancelSales: false,
    canManageUsers: false,
    canEditSettings: false,
    canDeleteSales: false,
    canEditPurchasePrice: false,
  },
}

export type UserStatus = 'active' | 'inactive'

export type MovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'RETURN'
  | 'DAMAGE'
  | 'EXPIRED'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER' | 'CREDIT'

export type Unit =
  | 'piece'
  | 'packet'
  | 'box'
  | 'kg'
  | 'gram'
  | 'litre'
  | 'ml'
  | 'metre'

export const UNITS: Unit[] = [
  'piece',
  'packet',
  'box',
  'kg',
  'gram',
  'litre',
  'ml',
  'metre',
]

export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'OTHER', 'CREDIT']

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'

export interface FirestoreType {
  id?: string
  storeId?: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}