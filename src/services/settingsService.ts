import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { getDb, COLLECTIONS } from '../firebase/firestore'
import type { StoreSettings } from '../types'

export const DEFAULT_SETTINGS: Omit<StoreSettings, 'id' | 'storeId'> = {
  name: 'SuperMart',
  logoUrl: '',
  address: '',
  phone: '',
  email: '',
  gstNumber: '',
    currency: 'INR',
  gstIncluded: true,
  invoicePrefix: 'SM',
  receiptFooter: 'Thank you for shopping with us',
  defaultTax: 0,
  enableCreditSales: true,
  enableNegativeStock: false,
  defaultReceiptType: 'thermal',
  posAutoFocusBarcode: true,
  posAutoPrintReceipt: false,
  posSoundOnScan: true,
  posShowStock: true,
  defaultPaymentMethod: 'CASH',
  aiEnabled: true,
  aiLeadTimeDays: 7,
  aiSafetyStockDays: 3,
  aiDeadStockDays: 30,
  aiSlowMovingDays: 21,
  aiAnomalyMultiplier: 2,
  waEnabled: false,
  waNumberDisplay: '',
  pickupAddress: '',
  pickupInstructions: 'Please provide your order number at the counter when collecting.',
  businessHours: 'Mon–Sun, 8:00 AM – 10:00 PM',
  paymentProvider: 'none',
  paymentTimeoutMinutes: 15,
  reservationTimeoutMinutes: 15,
  waGreetingTemplate:
    'Hello! 👋 Welcome to {storeName}.\n\nHow can I help you?\n1️⃣ Place an order\n2️⃣ Track my order\n3️⃣ Store timings & address\n4️⃣ Talk to the store',
  waPaymentSuccessTemplate:
    '💳 Payment received!\n\nOrder #{orderNo}\nAmount paid: {total}\n\nYour order has been confirmed and will now be prepared.',
  waPackingTemplate: "📦 We're preparing your order.\n\nOrder #{orderNo} is currently being packed.",
  waReadyTemplate:
    "🎉 Your order is ready!\n\nOrder #{orderNo}\n\nYou can now collect your order from:\n{storeName}\n{pickupAddress}\n\nPlease provide your order number when collecting.",
  waCompletedTemplate: '✅ Order #{orderNo} completed.\n\nThank you for shopping with us! ❤️',
}

export async function getSettings(storeId: string): Promise<StoreSettings | null> {
  const db = getDb()
  const snap = await getDoc(doc(db, COLLECTIONS.settings, storeId))
  if (!snap.exists()) return null
  return { id: snap.id, storeId, ...(snap.data() as object) } as StoreSettings
}

export async function ensureSettings(storeId: string): Promise<StoreSettings> {
  const existing = await getSettings(storeId)
  if (existing) return existing
  const db = getDb()
  const data = { ...DEFAULT_SETTINGS, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  await setDoc(doc(db, COLLECTIONS.settings, storeId), data)
  return { id: storeId, storeId, ...DEFAULT_SETTINGS } as StoreSettings
}

export async function saveSettings(
  storeId: string,
  settings: Partial<StoreSettings>,
  updatedBy: string,
): Promise<void> {
  const db = getDb()
  await updateDoc(doc(db, COLLECTIONS.settings, storeId), {
    ...settings,
    updatedAt: serverTimestamp(),
    updatedBy,
  })
}