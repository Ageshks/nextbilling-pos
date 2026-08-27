import type { FirestoreType } from './common'

export interface Customer extends FirestoreType {
  id?: string
  storeId: string
  name: string
  phone: string
  email: string
  address: string
  notes: string
  creditBalance: number
  totalSpent: number
  lastPurchaseAt: number
}