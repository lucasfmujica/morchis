# Morchis 💚

> **Our money, together.**

Morchis is a personal-finance app built for **couples and households**: a single shared space to track accounts, budgets, spending and debts in pesos and dollars, with an AI assistant that understands your money and answers in plain language.

It's a **mobile-first PWA** (installs on your phone like a native app) with real-time sync between both members of the household.

<p align="center">
  <img src="public/icons/icon-512.png" width="96" alt="Morchis" />
</p>

---

## ✨ Features

### 💸 Everyday money
- **Movimientos** (Transactions) — Ledger with search, filters, CSV export, swipe-to-edit/delete and per-item detail.
- **Cuentas** (Accounts) — Checking, savings, cash and credit cards, with balances, reconciliation and interest tracking.
- **Reglas** (Rules) — Recurring income and expenses (daily / weekly / biweekly / monthly) that generate themselves.
- **Extractos** (Statements) — Bank statement uploads and transaction imports.

### 🎯 Budgeting & goals
- **Presupuestos** (Budgets) — Envelope-style budgeting per category, with monthly targets, overspend alerts and household / personal split.
- **Análisis** (Analytics) — Household dashboard: net worth, projected cash flow, *age of money* and spending breakdown in ARS/USD.
- **Simulador** (Simulator) — "What if I buy this?": measure a purchase's impact on your savings rate and goals before you spend.

### 👫 Couple finances
- **Pareja** (Couple) — Balance between the two of you: who owes whom, payment logging and settlement.
- **Shared expenses** — Every expense can be *personal*, *shared* (tracking who paid and who owes) or *household*.

### 🤖 AI (Claude)
- **Pregúntale a Morchi** (Ask Morchi) — Conversational assistant that answers questions about your finances ("How much did we spend this month?", "Where could we cut back?"), with voice input.
- **Ticket** — Snap a photo of a receipt and the AI extracts merchant, date, amount, currency and line items, then suggests a category (grocery receipts, transfers, delivery apps, etc.).
- **Insights** — Auto-generated cards on your savings rate, unusual spending spikes and goal warnings.
- **Budget suggestions** and **purchasing power** — Helpers to build and understand your budget against inflation.

### 📱 Experience
- **Installable PWA** with service worker, basic offline mode and push notifications (Web Push / VAPID).
- **App Lock** with a 4–6 digit PIN (SHA-256 hashed).
- **Dual-currency** support (ARS / USD), light/dark mode, pull-to-refresh and haptic feedback.

---

## 🧱 Stack

| Layer | Technology |
|-------|------------|
| Framework | **Next.js 16** (App Router) · **React 19** · TypeScript 5 |
| Backend | **Supabase** — Postgres, Auth, Row Level Security, Edge Functions (Deno) |
| AI | **Claude** via the Anthropic SDK (chat, receipt OCR, insights, simulation) |
| State | **Zustand** (client) · **TanStack React Query** (server) |
| UI | **Base UI** + **shadcn** · **Tailwind CSS 4** · **Lucide** · **Recharts** · **Sonner** |
| PWA | **next-pwa** · service worker · Web Push · **next-themes** |
| Tests | **Vitest** |

---

## 🏗️ Architecture

```
src/
├── app/                      # Routes (App Router)
│   ├── analisis/             # Household dashboard
│   ├── cuentas/              # Accounts & cards
│   ├── deudas/               # Debts to third parties
│   ├── extractos/            # Bank statements
│   ├── household/            # Create / join a household
│   ├── insights/             # AI insights
│   ├── mas/                  # Settings, categories, PIN, notifications
│   ├── movimientos/          # Transaction ledger
│   ├── onboarding/           # PWA install guide
│   ├── pareja/               # Couple balance & settlement
│   ├── preguntale/           # AI chat ("Ask Morchi")
│   ├── presupuestos/         # Envelope budgeting
│   ├── reglas/               # Recurring rules
│   ├── simulador/            # Purchase simulator
│   ├── super/                # Grocery spending detail
│   └── ticket/               # Receipt OCR
├── components/               # UI components (nav, sheets, charts…)
├── hooks/                    # Hooks (envelope, couple, fx, push…)
├── lib/                      # Business logic (budgets, accounts, recurrence, format…)
└── store/                    # Zustand stores (pin, currency, privacy)

supabase/
├── migrations/               # ~28 SQL schema migrations
└── functions/                # Edge Functions
    ├── ask-morchis/          # Conversational assistant
    ├── parse-receipt/        # Receipt OCR
    ├── parse-statement/      # Statement parsing
    ├── generate-insights/    # Insight generation
    ├── simulate-purchase/    # Simulator
    ├── suggest-budgets/      # Budget suggestions
    ├── purchasing-power-insight/
    ├── budget-alert/ · card-due-alert/ · monthly-close/
    └── _shared/
```

### Data model (overview)
- **`households`** — the shared group; each **`profiles`** belongs to one household.
- **`accounts`**, **`transactions`**, **`transaction_items`** — accounts and movements (with `scope`: personal / shared / household).
- **`budget_months`**, **`category_targets`**, **`savings_goals`** — budgeting and goals.
- **`splits`**, **`settlements`** — who paid / who owes, and couple settlements.
- **`recurring_rules`** — recurrences.
- **`insights`**, **`push_subscriptions`** — AI and notifications.
- **`fx_rates`**, **`inflation_rates`**, **`categories`**, **`merchant_aliases`** — reference data.

All data isolation between households is enforced with **Row Level Security** in Supabase.

---

## 🚀 Getting started

### Requirements
- Node.js 20+
- A [Supabase](https://supabase.com) project
- An [Anthropic](https://console.anthropic.com) API key (for the AI features)

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
Create a `.env.local` file in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your-vapid-public-key>   # for Web Push
```

> Server-side keys don't go here: they're loaded as Edge Function *secrets* in Supabase (see below).

### 3. Set up the schema and functions
Using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
# Apply migrations
supabase db push

# Set Edge Function secrets
supabase secrets set ANTHROPIC_API_KEY=<your-api-key>
supabase secrets set VAPID_PRIVATE_KEY=<your-vapid-private-key>

# Deploy functions
supabase functions deploy
```

### 4. Run in development
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or whichever port the terminal prints).

> 💡 To experience it properly, install it as a PWA from your phone's browser (**Add to Home Screen**) — that's where notifications, app lock and standalone mode kick in.

---

## 📜 Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm start            # Production server
npm run lint         # ESLint
npm test             # Tests (Vitest)
npm run test:watch   # Tests in watch mode
```

---

## 🔐 How couples share data

1. The first person **creates a household** and gets an **invite code**.
2. Their partner **joins with the code** → both end up under the same `household_id`.
3. From then on they both see the household's shared movements; personal expenses stay private to each person, and shared ones track who paid and who owes so the balance can be settled in `/pareja`.

---

## 📦 Deployment

Designed for [Vercel](https://vercel.com) (the Next.js frontend) + [Supabase](https://supabase.com) (data + edge functions). Remember to set the same `NEXT_PUBLIC_*` variables in your Vercel environment.

---

## 📝 License

Private project. All rights reserved.
