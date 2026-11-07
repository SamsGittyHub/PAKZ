# PAKZ admin

Admin dashboard, multi-quantity inventory, first-party analytics, forecasting, and buying recommendations for the PAKZ resale store.

**Stack:** Next.js 16 (App Router, Cache Components) · Supabase (Postgres, Auth, Storage) · Stripe · Resend · Recharts · TanStack Table · Claude API (optional weekly brief) · Vercel Cron.

## Quick start (local)

```bash
npm install
npx supabase start            # local Postgres/Auth/Storage; applies migrations + seed.sql (demo data)
cp .env.example .env.local    # fill the Supabase URL/keys printed by `supabase status`
node --env-file=.env.local scripts/create-owner.mjs you@example.com 'a-strong-password'
npm run dev                   # http://localhost:3000/admin
```

To compute forecasts and recommendations for the demo data straight away, sign in as owner and click **Recompute now** on Forecasts, or:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/nightly?brief=0"
```

Tests: `npm test` (forecasting and recommendation engine unit tests). The SQL ledger, refunds and every dashboard RPC are exercised by `supabase/tests/01_inventory_flow.sql` (it runs inside a rolled-back transaction).

## What's where

| Area | Route | Notes |
|---|---|---|
| Overview | `/admin` | KPI cards with % change vs previous period, revenue/profit, orders and traffic charts, alerts panel |
| Products | `/admin/products` | Filters, bulk actions, insight drawer, CSV import/export, duplicate; `/new`, `/[id]`, `/quick-add` (phone camera) |
| Inventory | `/admin/inventory` | Stock, adjust (reason required), receive stock (weighted-average cost), aging + markdowns, valuation, movement audit |
| Orders | `/admin/orders` | Timeline, ship + tracking email, packing slip, Stripe refunds (optional restock), manual/offline sales at `/new` |
| Offers · Drops · Sell to us · Customers | `/admin/offers` … | Accept/counter/decline, raffles with crypto-random draw, LTV and repeat buyers |
| Revenue & profit (owner) | `/admin/revenue` | P&L, breakdowns by category/brand/product/size/channel/month, best/worst by profit, days-to-sell, expenses, XLSX |
| Traffic | `/admin/traffic` | Sources with conversion and revenue, UTM campaigns, filterable funnel, searches (incl. zero-result), sizes, devices, countries, realtime |
| Forecasts | `/admin/forecasts` | 7/30/90-day forecasts with 95% bands, low-data labels, month projection, predicted stockouts |
| What to stock | `/admin/recommendations` | Scored recommendations with reasons and numbers; dismiss / actioned / purchase task; weekly Buying Brief |
| Reports & alerts | `/admin/reports` | In-app alerts, alert thresholds, report recipients, weekly report preview / send now, cron run log |
| Settings (owner) | `/admin/settings` | Store, shipping rates, VAT, integration status, staff and roles, audit log |

```
supabase/migrations/   schema, ledger triggers, analytics RPCs, RLS, tracking ingest
supabase/seed.sql      ~150 days of demo catalogue, traffic and sales
src/lib/analytics/     forecast.ts (Holt-Winters / moving average), recommendations.ts, stockout.ts — pure + unit-tested
src/lib/jobs/          nightly.ts, alerts.ts, report.ts, brief.ts
src/lib/track/         first-party tracker (client) + shared bot/source logic
src/app/api/           track, stripe/webhook, cron/*, admin/export, admin/realtime, admin/products/[id]/insight
```

## Design decisions

- **Every stock change is a ledger row.** `product_variants.quantity` can only change through an `inventory_movements` insert (a trigger rejects direct updates), so the audit history is complete. Sales, refunds, reservations and adjustments all go through `record_sale`, `record_refund`, `adjust_stock` and `receive_stock`. Overselling raises an error.
- **Cost basis = weighted average landed cost** (unit price + lot fees + inbound shipping), snapshotted onto each order line at sale time, so historical profit doesn't move when you buy more stock.
- **Fees and shipping are allocated to lines pro-rata** (`sales_lines` view), so per-category/brand/product profit includes them.
- **All heavy analytics run in SQL** (`admin_*` RPCs). They're `security definer` and executable only by `service_role`; the app authorises the user first, then strips cost/profit fields for staff (`redact()` plus owner-only pages and exports).
- **Purchases are recorded server-side** from the Stripe webhook, never from the browser.
- **Forecasting:** daily series per scope (overall, category, brand, size, repeat-selling products). Holt-Winters (additive weekly seasonality, damped trend, grid-searched parameters) when there are ≥ 8 weeks of history with ≥ 10 selling days; otherwise a 28-day moving average with wider bands, flagged low-data. Bands are approximate 95% intervals.
- **Demand score** = weighted percentile ranks of view trend, add-to-cart rate, conversion, sell-through, speed to sell, margin, waitlist signups, offers and matching zero-result searches, shrunk toward 50 when traffic is thin. Weights are in `DEMAND_WEIGHTS`.
- **Buying Brief** sends only aggregated metrics to Claude (`claude-opus-5-5`); search terms are scrubbed of anything that looks like an email or phone number. Server-side refusal fallbacks are enabled.

## Deployment (Railway)

The app runs as one Railway service built from this repo (`npm run build` / `npm start`, Node 24). It needs a **hosted Supabase project**:

1. Create a project at supabase.com, then apply the schema: `npx supabase link --project-ref <ref> && npx supabase db push` (don't run `seed.sql` in production — it's demo data).
2. In the Railway service variables set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (and optionally Stripe / Resend / Anthropic keys from `.env.example`). Railway rebuilds on change — `NEXT_PUBLIC_*` values are baked in at build time.
3. In Supabase → Authentication → URL configuration, set the Site URL to the Railway domain and add `<domain>/auth/callback` as a redirect URL.
4. Create the first owner: `node --env-file=.env.production scripts/create-owner.mjs you@example.com '<password>'` with the production Supabase URL and service-role key in that file.
5. Point the Stripe webhook at `<domain>/api/stripe/webhook` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`).

Scheduled jobs run as three Railway cron services (image `curlimages/curl`) that call the endpoints below with `Authorization: Bearer $CRON_SECRET`. `vercel.json` holds the same schedule if you deploy to Vercel instead.

## Cron

| Job | Schedule (UTC) | Does |
|---|---|---|
| `/api/cron/nightly` | 03:15 daily | publish scheduled listings, rebuild `daily_metrics` (trailing 3 days), forecasts, recommendations, Buying Brief on Mondays |
| `/api/cron/hourly` | :05 hourly | publish scheduled listings, alerts (low stock, big order, offer, sell request, traffic spike) |
| `/api/cron/report` (`period=auto`) | 07:00 daily | weekly report on Mondays, monthly report on the 1st (store timezone) |

On Vercel, hourly crons need a Pro plan; on Hobby drop the hourly entry and alerts run once a day with the nightly job.

## Storefront integration

The storefront isn't part of this repo. See [docs/ANALYTICS.md](docs/ANALYTICS.md) for the `track()` calls and the Checkout Session metadata the webhook expects. The storefront reads variants through the `storefront_variants` view, which never exposes cost.
