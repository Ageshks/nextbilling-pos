export interface DateRange {
  from: number
  to: number
}

export interface SalesSummary {
  salesCount: number
  grossSales: number
  discounts: number
  netSales: number
  costOfGoods: number
  profit: number
  cashSales: number
  upiSales: number
  cardSales: number
  otherSales: number
  creditSales: number
  refundAmount: number
  itemsSold: number
}

export interface SalesByDay {
  day: string
  label: string
  count: number
  total: number
  profit: number
}

export interface ProductSalesRow {
  productId: string
  name: string
  quantity: number
  gross: number
  discount: number
  net: number
  cogs: number
  profit: number
}

export interface CategorySalesRow {
  categoryName: string
  quantity: number
  net: number
}

export interface PaymentMethodRow {
  method: string
  amount: number
  count: number
}

export interface CashierSalesRow {
  cashierId: string
  cashierName: string
  count: number
  net: number
}

export interface ReportTotals {
  purchasesTotal: number
  expensesTotal: number
  customerCredit: number
  supplierOutstanding: number
}

export type SalesReportKind =
  | 'day'
  | 'week'
  | 'month'
  | 'custom'