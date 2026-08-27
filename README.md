# SuperMart POS

A fast, offline-tolerant point-of-sale and inventory system for small Indian supermarkets. Built with **React 18 + TypeScript + Vite + Tailwind CSS v4 + Firebase** (Auth + Firestore). No paid services — everything runs on the free Spark tier patterns (bounded reads, on-demand reports).

## Features

| Area | What you get |
|---|---|
| POS / Billing | Barcode-first scanning, debounced product search, cart with line discounts & bill discount, GST-aware totals, cash/UPI/card/credit & mixed payments with change calc, hold/resume bills, keyboard shortcuts (F2/F4/F6/F8/F10), auto-print receipts |
| Sales | Filterable history, invoice detail, partial/full returns (stock restored), permission-gated voids, receipt reprint, CSV export |
| Products | Paginated catalog, category/brand management, CSV template + bulk import, active/inactive toggle |
| Inventory | Stock status (in/low/out), stock-value valuation, adjustment ledger (damage/expiry/corrections), append-only movement history |
| Purchases | Supplier purchases that atomically increase stock and supplier payables |
| Customers | Udhaar (credit) book with one-click collection using atomic increments |
| Expenses | Categorised shop costs with period filters |
| Reports | On-demand summaries: sales/profit/expenses/net profit, payment mix, top products/categories, cashier performance, inventory snapshot, CSV export |
| Users | Role-based team accounts created via a secondary Firebase app (owner session untouched) |
| Settings | Store profile, GST-inclusive pricing toggle, invoice prefix, thermal/A4 receipts, POS behaviour |

## Roles & permissions

| Capability | OWNER | ADMIN | CASHIER | INVENTORY |
|---|---|---|---|---|
| POS billing | ✅ | ✅ | ✅ | — |
| Sales / returns | ✅ | ✅ | ✅ | — |
| Void sale | ✅ | ✅ | — | — |
| Products / inventory / purchases / suppliers | ✅ | ✅ | read-only* | ✅ |
| Customers | ✅ | ✅ | ✅ | — |
| Expenses / Reports | ✅ | ✅ | — | — |
| Cash shifts | ✅ | ✅ | — | — |
| User management & settings | ✅ | — | — | — |

\* CASHIER sees the product list for search but cannot edit it.

## Quick start

```bash
npm install
cp .env.example .env    # fill in your Firebase web config
npm run dev             # http://localhost:5173
```

`.env` values are the public Firebase web config (Console → Project settings → Your apps → Web app). They are **not secrets** — real security comes from the Firestore rules below.

## Firebase setup (one time)

1. **Create a project** at console.firebase.google.com.
2. **Authentication → Sign-in method →** enable **Email/Password**.
3. **Firestore Database →** create it in production mode.
4. **Deploy the rules and indexes shipped in this repo**:

```bash
npm i -g firebase-tools
firebase login
# add your projectId to the .firebaserc or use --project <id>
firebase deploy --only firestore:rules,firestore:indexes
```

The included `firestore.rules` enforce store-scoped, role-based access exactly as the UI does (OWNER/ADMIN/CASHIER/INVENTORY) with a narrow first-run bootstrap for registration. `firestore.indexes.json` pre-creates every composite index the list queries need — otherwise Firestore surfaces clickable "create index" errors the first time each screen is used.

5. **Register yourself**: open the app → *Register* → create your store. You become the `OWNER`.

## Pricing / GST model

- Prices are treated as **GST-inclusive by default** (typical Indian retail): the customer-facing price already contains tax; the GST amount is derived for reporting (`taxable = price × 100 / (100 + rate)`).
- Toggle this off in Settings → Billing for exclusive pricing, where GST is added on top of discounted lines.
- Bill-level discounts are allocated proportionally across lines before tax.
- Purchase GST is added on top of cost (standard input-tax style), matching how supplier invoices are typically entered.

## Money handling notes

- All money math uses 2-decimal rounding helpers (`utils/calculations.ts`) to avoid float drift; quantities support up to 3 decimals (kg/litre).
- Sales are written in a single Firestore transaction: validate stock → allocate invoice number from a counter doc → write sale → deduct stock + movements → update customer balances. A failed bill changes nothing.
- Profit is an estimate based on the purchase price captured on each sold line.

## Offline behaviour

If a sale can't reach Firestore, the draft is queued in `localStorage` and flushed automatically when connectivity returns (each queued sale re-runs through the same transactional validation). Topbar shows pending-sync counts.

## Printing

Receipts render as normal DOM with print-scoped CSS (`src/index.css`). Thermal (58/80 mm) and A4 templates live in `components/billing/ReceiptPrint.tsx`; printing uses `window.print()` with everything except `.printable` hidden.

## Project structure

```
src/
  components/   ui kit (Button/Input/Modal/Table…), layout shell, receipt templates
  context/      Auth, Store settings, Cart, Theme, Toast providers
  firebase/     config, auth, firestore helpers, storage
  hooks/        connectivity, debounce, keydown, scan sound
  pages/        auth, dashboard, pos, sales, products, inventory,
                purchases, suppliers, customers, expenses, reports, users, settings
  routes/       AppRoutes + ProtectedRoute (permission-gated)
  services/     Firestore data access (sales, products, inventory, …)
  types/        domain models + ROLES matrix
  utils/        money math, formatting, CSV, invoice numbers, validation
```

## WhatsApp ordering module (WhatsApp Orders sidebar section)

Customers order over WhatsApp; staff manage everything from **WhatsApp Orders** in the POS. Architecture: WhatsApp Cloud API → webhook → Cloud Function (webhook verification, deterministic NLU/product matching against the *existing* product catalog) → Firestore `waOrders` / `whatsappConversations` → POS dashboard → Razorpay payment link → server-side payment-webhook verification → packing workflow → status updates back to the customer.

Key guarantees:

- Prices/totals/stock always come from Firestore inside a transaction — customer-supplied numbers are never trusted.
- Stock is reserved atomically at checkout and auto-released by a scheduled expiry job when payment times out.
- The order state machine (`PENDING → AWAITING_PAYMENT → PAID → PACKING → READY_FOR_PICKUP → COMPLETED`, plus `CANCELLED`/`REFUNDED`) is validated server-side; illegal transitions are rejected.
- Payment provider is abstracted behind an interface (`functions/src/payments/types.ts`) — swap providers without touching order logic.
- Core POS keeps working if WhatsApp/Razorpay/AI are down: every external call is wrapped in best-effort error handling.

### Server-side configuration (Cloud Functions env)

Copy `functions/.env.example` → `functions/.env` and set:
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (Meta App secret for webhook signature checks), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Secrets live only in functions config — never in frontend code.

Non-secret preferences (business hours, pickup instructions, payment timeout minutes, template text) are editable per store in **Settings → WhatsApp**.

### Deploying & wiring

```bash
firebase deploy --only firestore:rules,firestore:indexes   # waOrders/whatsappConversations rules + indexes
cd functions && npm i && npm test && firebase deploy --only functions
```

> Functions require the Blaze plan on your Firebase project.

Then in the Meta developer console point the WhatsApp webhook to `https://us-central1-nextbilling-47f03.cloudfunctions.net/waWebhook` with the verify token above, subscribe to `messages`, and add `https://<region>-nextbilling-47f03.cloudfunctions.net/razorpayWebhook` (event: `payment.captured`) in the Razorpay dashboard.

Engine rules are unit-tested (`cd functions && npm test`): NLU quantity/intent parsing, product matching incl. plurals & aliases, and state-machine transition validation.

## Scripts

```bash
npm run dev       # Vite dev server
npm run build     # tsc type-check + production bundle
npm run preview   # serve the dist build
```
