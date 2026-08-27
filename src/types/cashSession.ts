import type { FirestoreType } from './common'

export interface CashTransaction extends FirestoreType {
  id?: string
  storeId: string
  sessionId: string
  type: 'SALE' | 'REFUND' | 'EXPENSE' | 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT'
  amount: number
  referenceId: string
  notes: string
  createdAt?: number
  updatedBy?: string
}

export interface CashSession extends FirestoreType {
  id?: string
  storeId: string
  userId: string
  userName: string
  openedAt: number
  closedAt: number
  openingCash: number
  cashSales: number
  cashExpenses: number
  cashRefunds: number
  cashDeposits: number
  cashWithdrawals: number
  expectedCash: number
  declaredCash: number
  difference: number
  status: 'OPEN' | 'CLOSED'
}