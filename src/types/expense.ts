import type { PaymentMethod, FirestoreType } from './common'

export const EXPENSE_CATEGORIES = [
  'Electricity',
  'Salary',
  'Transport',
  'Maintenance',
  'Rent',
  'Cleaning',
  'Other',
] as const

export interface Expense extends FirestoreType {
  id?: string
  storeId: string
  category: string
  description: string
  amount: number
  paymentMethod: PaymentMethod
  date: number
  notes: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
}