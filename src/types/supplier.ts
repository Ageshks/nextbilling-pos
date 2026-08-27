import type { FirestoreType } from './common'

export interface Supplier extends FirestoreType {
  id?: string
  storeId: string
  name: string
  company: string
  phone: string
  email: string
  address: string
  gstNumber: string
  notes: string
  outstandingBalance: number
  totalPurchases: number
    lastPurchaseAt: number
  active: boolean
}