# 💎 Couple Finance (Finanças do Casal)

> A collaborative personal finance PWA for couples — track expenses, income, budgets and installments together in real time.

**[🌐 Live Demo](https://financa-casal.vercel.app)** · Demo credentials: `demo@financacasal.app` / `demo1234`

---

## 📋 Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Database](#database)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Deploy](#deploy)
- [Project Structure](#project-structure)
- [Security](#security)
- [Roadmap](#roadmap)

---

## About

**Couple Finance** is a Progressive Web App built for couples to manage their finances collaboratively. Each family member can log expenses and income, track category budgets, manage monthly recurring bills, browse a calendar view, explore charts, and automatically import bank statements.

Key design goals:

- **Mobile-first PWA** — installable on iPhone/Android with a fixed bottom navigation bar, iOS notch and home indicator support
- **Real-time collaboration** — one partner's changes are immediately visible to the other
- **Security by default** — Supabase Row Level Security (RLS) ensures complete data isolation between families
- **Smart spreadsheet import** — CSV/XLSX/PDF parsed locally or via Claude Sonnet AI for unknown formats

---

## Features

### 🔐 Authentication & Profiles
- Sign up and log in with email and password
- **Secure session:** refresh token in an `HttpOnly; Secure` cookie (inaccessible to JS), access token kept in memory only
- Skeleton loading during session restore
- Profile with first name, last name and phone with international dial code (14 countries)
- **Demo mode** — no sign-up required: `demo@financacasal.app` / `demo1234`

### 👨‍👩‍👦 Family System
- Create a family or join an existing one via a **6-letter invite code**
- Two member roles: **Member** and **Admin**
- Only admins can regenerate the invite code
- Last admin protection — prevents accidental lockout

### 🌙 Dark / Light Theme
- Toggle between dark and light mode from the sidebar (desktop) or the menu drawer (mobile)
- Theme applied across all components via the `t` theme object (inline styles)

### 🏠 Dashboard
- Summary cards: Monthly Income, Monthly Expenses, Balance and Future Installments
- Bar chart: Income × Expenses for the last 6 months
- **Budget alert card** — appears automatically when any category exceeds 80% of its limit
- **Recurring reminders card** — lists fixed bills not yet confirmed for the current month
- **Billing card** — current month's credit card statement total grouped by card with due date
- Personalized greeting with the logged-in user's name

### 📅 Calendar
- Monthly view with per-day visual indicators:
  - 🔴 red dot = one-time expense
  - 🟣 purple dot = credit installment
  - 🟢 green dot = income entry
- Daily totals shown directly in each cell
- Detail panel on day tap with the full list of entries for that day
- Edit and delete expenses/income directly from the calendar

### 📊 Charts
- **Income × Expenses × Balance** — monthly bar chart, filterable by month/year
- **Expenses by category** — interactive donut chart:
  - Tap a slice or legend item to select a category
  - Unselected slices dim to 35% opacity
  - Detailed entry list for the selected category appears below
- **Credit installments** — 12-month timeline of upcoming installments:
  - Tap a data point to view and edit that month's installments

### 🎯 Monthly Budget
- Set spending limits per category (e.g. Dining: R$ 2,000)
- Progress bar per category with percentage used
- Color coding: green (< 80%), yellow (80–100%), red (> 100%)
- Alert card on the Dashboard when any category exceeds 80%
- Month-by-month history navigation

### 🔁 Recurring Expenses
- Create rules for monthly, weekly or yearly fixed bills (rent, utilities, subscriptions)
- Each rule has: description, category, payment type, due day, and amount type (fixed or variable)
- **Monthly reminder system** — reminders are auto-generated every month for each active rule:
  - Pending: amount field + confirm ✓ + skip ✕ buttons
  - Confirming auto-creates the entry in the Transactions tab
  - Detects if the entry was already imported and just links the reminder
- Confirmed payments card with the month's paid list and total

### 📋 Transactions
- List of expenses and income with filters by: month, year, type (All/Expenses/Income), payment method (PIX, Debit, Credit, Cash) and category
- **Long-press** to enter bulk selection mode
- **Automatic duplicate detection** — flagged entries show a `🔁 duplicate` badge
- **Split payments** — when an expense was logged with two payment methods, both cards show a `✂️ split` badge
- Edit any entry via a full modal

### ➕ Logging Expenses
**Supported payment methods:** PIX · Debit · Credit · Cash

- **PIX / Debit / Cash:** Amount + Date
- **Credit with installments:**
  - Number of installments ↔ Installment value ↔ Total (fields stay in sync)
  - Date of first installment (with a billing cycle reminder)
  - Info banner: `💳 Spread from Jan/2026 to Jun/2026 · Total: R$ 600.00`
  - The stored value is **the installment amount** — each month shows the real cost
- **Split payment (✂️):** a single purchase can be split across two payment methods (e.g. R$ 50 cash + R$ 150 PIX). Two linked records are created sharing the same `split_group_id`. All totals remain correct automatically.
- Option to make the expense **recurring** directly from the form

### ➕ Logging Income
- Description, who received it, category, amount and date

### 💳 Credit Cards
- Manage multiple cards with name, cardholder, closing day and due day
- Custom color per card for easy identification
- Optionally associate a card when logging a credit expense
- Billing card on the Dashboard with the current statement total grouped by card

### 📥 Spreadsheet Import
Supports **CSV, XLSX and PDF** via two modes:

**Local parsers (free, no AI):**
- `Annual_Expenses_*.csv` — categories as rows, days of month as columns
- `Gastos_Anual.csv` — credit card format with months as columns (DEC, JAN, FEB…)

**AI via Edge Function (Claude Sonnet):**
- Unknown formats are sent to the Anthropic API for analysis
- Automatic column mapping and Brazilian date normalization (DD/MM/YYYY)

**Import preview:**
- Duplicate detection against existing data
- Filters: All / New / Duplicates
- Individual or bulk selection
- `ON CONFLICT DO NOTHING` — reimporting the same file never creates duplicates

### ✏️ Editing Entries
- Modal pre-filled with the current values for any field
- For installment credit: shows the installment amount and auto-calculates the total
- Re-fetches the record from the database after saving to guarantee state sync

### 📱 PWA / Mobile
- Installable on iPhone and Android home screens
- **Bottom bar** with 3 primary tabs (Home, Calendar, Charts) + central FAB ("+") + Menu button
- **Menu button** opens a bottom sheet with secondary tabs in order: Recurring → Transactions → Budget → Import, plus Profile, Family, Cards, Theme and Sign out
- **Desktop sidebar rail** — 64px collapsed / 210px expanded with all 7 tabs + user avatar with dropdown submenu
- `env(safe-area-inset-bottom)` — bottom bar stays above the iPhone home indicator
- `env(safe-area-inset-top)` — top bar doesn't overlap the iOS status bar in standalone mode
- Modals with swipe-to-close restricted to the handle bar and header — the form body scrolls freely without accidental dismissal

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI and state management |
| Vite | 8 | Build tool and dev server |
| Recharts | 3 | Charts (bar, donut, line) |
| exceljs | 4 | Excel file parsing (local bundle) |

### Backend / Infrastructure
| Technology | Purpose |
|---|---|
| Supabase | PostgreSQL database, authentication and RLS |
| Supabase Edge Functions | AI-powered spreadsheet analysis (Deno runtime) |
| Vercel | Deploy, CDN, hosting and serverless API Routes |

### AI
| Service | Purpose |
|---|---|
| Claude Sonnet (Anthropic) | Parsing spreadsheets in unknown formats |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser / PWA                     │
│  React SPA (Vite)  ──── access token (memory only)  │
│       │                                              │
│  supabaseFetch()   ──── Supabase REST API            │
│  supabaseRpc()     ──── Supabase RPC (SECURITY       │
│                         DEFINER functions)           │
└─────────────────────────────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────────┐  ┌──────────────────────────┐
│  Vercel API Routes  │  │    Supabase Database     │
│  /api/auth/*        │  │    PostgreSQL + RLS       │
│  (HttpOnly cookie)  │  └──────────────────────────┘
└─────────────────────┘              │
         │                 ┌─────────▼──────────┐
         ▼                 │   Edge Function    │
┌─────────────────┐        │   analyze-import   │
│  Supabase Auth  │        │   (Deno + Claude   │
│  (JWT tokens)   │        │    Sonnet API)     │
└─────────────────┘        └────────────────────┘
```

**Architectural decisions:**
- **Single-file component** — the entire app lives in `src/App.jsx` (~6,100 lines) for fast iteration. Intentional choice, not technical debt.
- **No Supabase SDK** — raw `fetch` with manual headers for a smaller bundle and more control
- **No TypeScript** — personal project, iteration speed prioritized
- **No Tailwind** — inline styles with a `t` theme object for dark/light mode support
- **Local state** with React `useState` / `useMemo` — no Redux or Zustand
- **RLS in the database** — security enforced at the data layer, not just the frontend
- **Auth via Vercel API Routes** — refresh token in an `HttpOnly` cookie; access token in memory only

---

## Database

### Tables

```sql
families            -- id, name, invite_code, created_at

family_members      -- id, family_id, user_id, role, joined_at
                    --   role: 'admin' | 'member'

expenses            -- id, family_id, user_id, description, amount, date,
                    --   category, type, parcelas, user_label,
                    --   card_id, split_group_id, created_at
                    --   type: 'pix' | 'debito' | 'credito' | 'dinheiro'
                    --   amount: ALWAYS the installment value, never the total
                    --   split_group_id: UUID shared by two records of a split
                    --                  payment (nullable)

incomes             -- id, family_id, user_id, description, amount, date,
                    --   source, category, user_label, created_at

profiles            -- id, first_name, last_name, phone, updated_at

budgets             -- id, family_id, category, amount, month (YYYY-MM)

cards               -- id, family_id, name, holder, closing_day, due_day,
                    --   color, active, created_at

billing_periods     -- id, family_id, card_id, month, year,
                    --   start_date, end_date, created_at

recurring_expenses  -- id, family_id, user_id, description, amount, category,
                    --   type, frequency, day_of_month, month_of_year,
                    --   amount_type, active, end_date, created_at
                    --   frequency: 'monthly' | 'weekly' | 'yearly'
                    --   amount_type: 'fixed' | 'variable'

recurring_reminders -- id, family_id, recurring_id, month, year,
                    --   amount, status, expense_id, created_at
                    --   status: 'pending' | 'confirmed' | 'skipped'
```

### Installment amount convention

The `amount` field in `expenses` always stores the **installment value**, never the total. This ensures each row represents exactly that month's cost. The total is computed on the frontend as `amount × parcelas` for display purposes only.

### Split payment (`split_group_id`)

When a purchase is paid with two different methods, **two separate records** are inserted in `expenses`, both sharing the same `split_group_id` UUID. All existing sum calculations remain correct with no special logic needed — they are simply two linked expense entries.

### Unique indexes (anti-duplicate)

```sql
CREATE UNIQUE INDEX idx_expenses_no_duplicates
  ON expenses (family_id, date, description, ROUND(amount::numeric, 2), category);

CREATE UNIQUE INDEX idx_incomes_no_duplicates
  ON incomes (family_id, date, description, ROUND(amount::numeric, 2), category);
```

### RPC Functions (SECURITY DEFINER)

| Function | Description |
|---|---|
| `get_my_family()` | Returns the authenticated user's family |
| `create_family_for_user()` | Creates a family and sets the creator as admin |
| `join_family_by_code()` | Joins a family via invite code |
| `get_family_members_with_profiles()` | Members with email, name and phone |
| `upsert_profile()` | Creates or updates the user's profile |
| `update_member_role()` | Changes a member's role (guards last admin) |
| `regenerate_invite_code()` | Generates a new invite code (admin only) |

---

## Running Locally

### Prerequisites

- Node.js 18+
- npm
- A [Supabase](https://supabase.com) account (free tier works)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/ghiberti85/financa-casal.git
cd financa-casal

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 4. Start the dev server
npm run dev
```

Open `http://localhost:5173`

> **Demo mode:** you can explore the app with fake data right away — no Supabase setup needed. Use `demo@financacasal.app` / `demo1234`.

### Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor to create all tables
3. Run `supabase/rpc_functions.sql` to create RPC functions
4. In **Authentication → Providers → Email**, disable "Confirm email" (for local dev)
5. Copy the **Project URL** and **anon key** into `.env.local`

---

## Environment Variables

Create a `.env.local` file at the project root:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

For the AI-powered import Edge Function, add the following secret in Supabase Vault:

```
Secret name:  ANTHROPIC_API_KEY
Secret value: sk-ant-...
```

---

## Development Workflow

All changes follow this mandatory flow — no exceptions:

```
Branch → Code → Tests → Build → Security → Docs → PR → Merge → Deploy
```

| Step | Command / Action | Pass criteria |
|---|---|---|
| Branch | `git checkout -b feat/name` | Created from updated `main` |
| Code | Edit `App.jsx` | Feature implemented |
| Tests | `npm run test` | All tests pass (when implemented) |
| Build | `npm run build` | Zero compilation errors |
| Security | Review checklist in `CLAUDE.md` | No critical issues |
| Docs | Update `CLAUDE.md` + `CONTEXT.md` + `README.md` | All three in sync |
| PR | Open descriptive PR on GitHub | PR checklist filled |
| Merge | Squash merge to `main` | No conflicts |
| Deploy | Vercel auto-deploy (~1 min) | No runtime errors |

> **Every new feature requires a test case** — either written immediately (if tests are implemented) or documented in `CONTEXT.md` (if still in the planning phase). Features are never considered complete without their test.

> **Removing a feature** means also removing its code, its tests, and all references in the three documentation files. No dead entries.

---

## Deploy

The project is configured for automatic deployment on Vercel via GitHub.

Any push to the `main` branch triggers an automatic deploy. The process takes ~1–2 minutes.

> ⚠️ **Never commit directly to `main`.** Always use a branch + PR. Vercel auto-deploys on every push to `main` — a broken commit goes straight to production.

### Vercel Environment Variables

Set the same variables from `.env.local` in:
**Vercel → Project → Settings → Environment Variables**

---

## Project Structure

```
financa-casal/
├── api/
│   └── auth/
│       ├── login.js     # POST /api/auth/login — authenticates and sets HttpOnly cookie
│       ├── signup.js    # POST /api/auth/signup — registers and sets HttpOnly cookie
│       ├── refresh.js   # POST /api/auth/refresh — renews session via HttpOnly cookie
│       └── logout.js    # POST /api/auth/logout — clears the session cookie
├── src/
│   ├── App.jsx          # Entire application (~6,100 lines)
│   ├── index.css        # Base global styles
│   └── main.jsx         # React entry point
├── public/
│   ├── favicon.svg           # SVG diamond icon (5-facet gem, purple gradient)
│   ├── apple-touch-icon.png  # 180×180 PNG icon for iOS home screen
│   └── og-image.svg          # Open Graph image (1200×630)
├── index.html           # HTML with SEO, Open Graph and PWA meta tags
├── vercel.json          # HTTP security headers and CSP
├── vite.config.js       # Vite configuration
├── CONTEXT.md           # Full technical context for AI-assisted development
├── CLAUDE.md            # Instructions, patterns and gotchas for Claude Code
├── package.json
└── README.md
```

### Main components in `App.jsx`

| Component | Description |
|---|---|
| `App` | Root — authentication, global state and tab routing |
| `LoginPage` | Sign-up/login with profile and family setup flow (3 steps) |
| `SummaryCards` | Cards: Monthly Income, Expenses, Balance, Future Installments |
| `CalendarView` | Monthly calendar with visual indicators and day detail panel |
| `ChartsView` | Income×Expenses bar, category donut (interactive) and installment timeline |
| `BudgetView` | Category budgets with progress bars |
| `BudgetAlertCard` | Dashboard alert when a category exceeds 80% of its budget |
| `RecurringView` | Monthly reminders, payment confirmation and rule management |
| `RecurringAlertCard` | Dashboard alert for pending recurring payments |
| `CardsManager` | CRUD for credit cards (name, holder, closing day, due day) |
| `BillingCard` | Current month's statement summary on the Dashboard, grouped by card |
| `TransactionsList` | Transactions with filters, bulk selection and duplicate detection |
| `ImportView` | CSV/XLSX/PDF upload with preview and duplicate detection |
| `ExpenseForm` | Expense: PIX/Debit/Credit/Cash + installments + recurring + split payment |
| `IncomeForm` | Income: description, who received it, category, amount, date |
| `EditModal` | Edit an existing expense or income entry |
| `FamilyModal` | Invite code, members and role management |
| `ProfileModal` | Profile editing with phone number and dial code |
| `Modal` | Reusable modal wrapper with mobile bottom sheet support |
| `ConfirmModal` | Confirmation modal (replaces `window.confirm`) |
| `Toast` | Temporary notifications (success / error / info / warning) |
| `Icon` | Inline SVG icon via `ICON_PATHS` (33 Lucide-inspired icons) |

---

## Security

### Authentication & session
- **Refresh token** in an `HttpOnly; Secure; SameSite=Strict` cookie — inaccessible to JavaScript even under XSS
- **Access token** kept only in memory (`_authToken`) — never written to `localStorage` in production
- **Refresh token rotation** on every use — prevents token replay attacks
- Transparent auto-refresh: 401 → `/api/auth/refresh` → retry original request

### Data protection (Supabase)
- **RLS enabled on all tables** — complete family data isolation via `family_id`
- **SECURITY DEFINER functions** for sensitive operations (family creation, role changes, invites)
- `UNIQUE` indexes in the database guarantee idempotent imports (`ON CONFLICT DO NOTHING`)

### Anthropic API key protection
- The API key lives **exclusively in Supabase Vault** (server-side)
- The browser never receives or transmits the key

### HTTP headers (`vercel.json`)
| Header | Protection |
|---|---|
| `Strict-Transport-Security` | Enforces HTTPS with preload |
| `Content-Security-Policy` | Blocks external scripts; disallows iframes |
| `X-Frame-Options` | Prevents clickjacking |
| `X-Content-Type-Options` | Prevents MIME sniffing |
| `Permissions-Policy` | Disables camera, microphone and geolocation |

### File uploads
- Maximum size: **10 MB**
- MIME type validated before processing
- Allowed extensions: `.csv`, `.xlsx`, `.xls`, `.pdf`, `.txt`
- XLSX parsed via `exceljs` (replaces the abandoned `xlsx` package)

### Rate limiting
- **Frontend:** 3 failed attempts → 30-second button lockout
- **Server:** `/api/auth/login` limits to 10 attempts per IP within a 15-minute window

---

## Roadmap

> Each item below requires a corresponding test case — either written at implementation time or documented in `CONTEXT.md` if tests aren't yet set up. Features are never considered done without their test.

### Infrastructure & Quality (before any new feature)
- [ ] Automated test suite — Vitest (unit) + React Testing Library (component) + Playwright (E2E)
- [ ] Supabase upgrade to Pro (daily backups, PITR, connection pooling)
- [ ] Custom domain + SSL

### Security & Legal (launch blockers)
- [ ] Supabase RLS audit for all tables
- [ ] Email confirmation + "Forgot password" flow
- [ ] Rate limiting on signup endpoint
- [ ] Privacy policy + Terms of service + LGPD cookie banner
- [ ] Account deletion ("Right to be forgotten")

### Pre-launch Features
- [ ] Algorithmic monthly summary — vs. previous month, top category, largest expense
- [ ] Month-over-month comparison — `↑ 23%` indicators next to dashboard totals
- [ ] End-of-month balance forecast — recurring bills + 3-month spending average
- [ ] Upcoming billing alert — 3 days before card due date
- [ ] Credit installment due-date notifications — next 7 days
- [ ] Monthly financial goals with progress bars
- [ ] Couple expense split — who owes whom each month

### Post-launch Features
- [ ] Receipt photo → auto-fill via Claude Vision (Edge Function)
- [ ] Annual report / year in review
- [ ] PDF report export (server-side via Edge Function)
- [ ] Push notifications when a partner logs an expense
- [ ] Financial health score (0–100 monthly)
- [ ] Percentage-based budgeting (50/30/20 rule)
- [ ] Native mobile app (React Native)

---

## License

This is a private project for personal family use. All rights reserved.

---

<p align="center">
  Built with 💜 by Fernando Ghiberti
</p>
