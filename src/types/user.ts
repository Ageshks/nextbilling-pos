import type { Role, UserStatus, FirestoreType } from './common'

export interface AppUser {
  uid: string
  storeId: string
  name: string
  email: string
  role: Role
  status: UserStatus
  phone: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  photoURL?: string
}

export interface StoreSettings extends FirestoreType {
  id?: string
  storeId: string
  name: string
  logoUrl: string
  address: string
  phone: string
  email: string
    gstNumber: string
  currency: string
  gstIncluded: boolean
  invoicePrefix: string
  receiptFooter: string
  defaultTax: number
  enableCreditSales: boolean
  enableNegativeStock: boolean
  defaultReceiptType: 'a4' | 'thermal'
  posAutoFocusBarcode: boolean
  posAutoPrintReceipt: boolean
  posSoundOnScan: boolean
  posShowStock: boolean
  defaultPaymentMethod: string
  updatedBy?: string
}

export interface Store {
  id: string
  name: string
  ownerEmail: string
  createdAt?: number
}

export interface StoreSettings extends FirestoreType {
  id?: string
  storeId: string
  name: string
  logoUrl: string
  address: string
  phone: string
  email: string
  gstNumber: string
  currency: string
  invoicePrefix: string
  receiptFooter: string
  defaultTax: number
  enableCreditSales: boolean
  enableNegativeStock: boolean
  defaultReceiptType: 'a4' | 'thermal'
  posAutoFocusBarcode: boolean
  posAutoPrintReceipt: boolean
  posSoundOnScan: boolean
  posShowStock: boolean
  defaultPaymentMethod: string
  // AI / inventory-intelligence thresholds (defaulted in settingsService).
  aiEnabled: boolean
  aiLeadTimeDays: number
  aiSafetyStockDays: number
  aiDeadStockDays: number
  aiSlowMovingDays: number
  aiAnomalyMultiplier: number
  // --- Inventory returns governance (₹ thresholds; NOT hard-coded) -----------
  /** Inventory loss (damage/expiry/quarantine) above this needs manager approval. */
  inventoryReturnApprovalThreshold: number
  /** Write-off value above this needs manager approval. */
  inventoryWriteOffApprovalThreshold: number
  /** Supplier return value above this needs manager approval. */
  supplierReturnApprovalThreshold: number
  // --- WhatsApp commerce (operational config ONLY; never secrets) -----------
  waEnabled: boolean
  /** Display-only number shown to customers, e.g. "+91 98765 43210". */
  waNumberDisplay: string
  pickupAddress: string
  pickupInstructions: string
  businessHours: string
  paymentProvider: 'none' | 'razorpay'
  paymentTimeoutMinutes: number
  reservationTimeoutMinutes: number
  waGreetingTemplate: string
  waPaymentSuccessTemplate: string
  waPackingTemplate: string
  waReadyTemplate: string
  waCompletedTemplate: string
  updatedBy?: string
}