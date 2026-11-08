-- First-party analytics: sessions, events, nightly rollups, forecasts, recommendations.

create table public.sessions (
  id            text primary key,                 -- client-generated (uuid, or 'anon-…' when consent declined)
  visitor_id    text,                             -- persistent id, only when consent granted
  user_id       uuid references auth.users (id) on delete set null,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  landing_page  text,
  referrer      text,                             -- referrer host only
  source        text not null default 'direct',   -- normalised: direct | instagram | tiktok | google | referral | email | paid | other
  medium        text,
  campaign      text,
  device        text,                             -- mobile | tablet | desktop
  country       text,
  page_views    int not null default 0,
  events_count  int not null default 0,
  is_returning  boolean not null default false,
  consent       boolean not null default false,
  converted     boolean not null default false,
  is_bot        boolean not null default false
);
create index sessions_first_seen_idx on public.sessions (first_seen);
create index sessions_last_seen_idx on public.sessions (last_seen);
create index sessions_visitor_idx on public.sessions (visitor_id) where visitor_id is not null;

create table public.events (
  id            bigint generated always as identity primary key,
  session_id    text not null,
  user_id       uuid,
  event_type    text not null check (event_type in (
                  'page_view', 'product_view', 'search', 'filter_used', 'add_to_cart', 'remove_from_cart',
                  'checkout_started', 'purchase', 'waitlist_signup', 'offer_made', 'engagement')),
  product_id    uuid,
  variant_id    uuid,
  category      text,
  brand         text,
  value         numeric,          -- purchase: revenue · search: result count · engagement: seconds on page
  query         text,             -- search term (lower-cased)
  props         jsonb,            -- filter_used: {filter, value}; misc extras
  path          text,
  referrer      text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device        text,
  country       text,
  created_at    timestamptz not null default now()
);
-- Spec'd composite index plus the access paths the dashboard RPCs use.
create index events_created_type_product_idx on public.events (created_at, event_type, product_id);
create index events_type_created_idx on public.events (event_type, created_at);
create index events_product_type_idx on public.events (product_id, event_type, created_at) where product_id is not null;
create index events_session_idx on public.events (session_id);

create table public.daily_metrics (
  date          date not null,
  category      text not null default '',
  brand         text not null default '',
  views         int not null default 0,
  add_to_carts  int not null default 0,
  purchases     int not null default 0,      -- orders containing this category/brand
  revenue       numeric(12,2) not null default 0,
  cost          numeric(12,2) not null default 0,
  profit        numeric(12,2) not null default 0,
  units_sold    int not null default 0,
  primary key (date, category, brand)
);

create table public.forecasts (
  id                 uuid primary key default gen_random_uuid(),
  scope              text not null check (scope in ('overall', 'category', 'brand', 'product', 'size')),
  scope_value        text not null default '',
  period             int not null check (period in (7, 30, 90)),   -- horizon in days
  method             text not null,                                -- holt_winters | moving_average
  low_data           boolean not null default false,
  predicted_units    numeric(12,2) not null,
  predicted_revenue  numeric(12,2) not null,
  confidence_low     numeric(12,2) not null,                       -- revenue band (95%)
  confidence_high    numeric(12,2) not null,
  units_low          numeric(12,2),
  units_high         numeric(12,2),
  series             jsonb,                                        -- [{date, revenue, low, high}] daily path for charting
  generated_at       timestamptz not null default now()
);
create index forecasts_lookup_idx on public.forecasts (scope, scope_value, period, generated_at desc);

create table public.recommendations (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('restock', 'stock_more', 'stock_less', 'reprice', 'promote', 'clearance', 'no_supply', 'best_sizes')),
  scope        text not null check (scope in ('category', 'brand', 'size', 'product', 'variant', 'keyword')),
  scope_value  text not null,
  title        text not null,
  reason       text not null,
  score        numeric(6,2) not null,
  data         jsonb not null default '{}',
  status       text not null default 'new' check (status in ('new', 'dismissed', 'actioned')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index recommendations_open_unique on public.recommendations (type, scope, scope_value) where status = 'new';
create index recommendations_status_idx on public.recommendations (status, score desc);

create table public.ai_briefs (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  model         text not null,
  content       text not null,
  input         jsonb not null,
  generated_at  timestamptz not null default now()
);

create table public.cron_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  detail       jsonb
);

-- ---------------------------------------------------------------------------
-- Line-level sales fact: one row per order item with allocated order-level fees.
-- Revenue = net of refunded units. Fees/shipping are allocated pro-rata by line value.
-- ---------------------------------------------------------------------------
create view public.sales_lines as
select
  oi.id                       as order_item_id,
  o.id                        as order_id,
  o.number                    as order_number,
  o.channel,
  o.status,
  o.paid_at,
  o.customer_id,
  o.session_id,
  oi.product_id,
  oi.variant_id,
  oi.title,
  oi.size,
  oi.condition,
  coalesce(c.name, '')        as category,
  coalesce(b.name, '')        as brand,
  (oi.quantity - oi.refunded_qty)                    as units,
  (oi.quantity - oi.refunded_qty) * oi.unit_price    as revenue,
  (oi.quantity - oi.refunded_qty) * oi.unit_cost     as cogs,
  round(coalesce(o.payment_fees     * oi.quantity * oi.unit_price / nullif(sum(oi.quantity * oi.unit_price) over w, 0), 0), 2) as fees,
  round(coalesce(o.shipping_cost    * oi.quantity * oi.unit_price / nullif(sum(oi.quantity * oi.unit_price) over w, 0), 0), 2) as shipping_cost,
  round(coalesce(o.shipping_charged * oi.quantity * oi.unit_price / nullif(sum(oi.quantity * oi.unit_price) over w, 0), 0), 2) as shipping_charged,
  round(coalesce(o.tax              * oi.quantity * oi.unit_price / nullif(sum(oi.quantity * oi.unit_price) over w, 0), 0), 2) as tax,
  p.listed_at,
  p.created_at                as product_created_at
from public.orders o
join public.order_items oi on oi.order_id = o.id
left join public.products p on p.id = oi.product_id
left join public.categories c on c.id = p.category_id
left join public.brands b on b.id = p.brand_id
where o.paid_at is not null and o.status not in ('pending', 'cancelled')
window w as (partition by o.id);

-- Nightly rollup into daily_metrics for [p_from, p_to] (inclusive dates, store timezone).
create or replace function public.refresh_daily_metrics(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare v_tz text; v_rows int;
begin
  select timezone into v_tz from public.store_settings where id = 1;
  delete from public.daily_metrics where date between p_from and p_to;

  insert into public.daily_metrics (date, category, brand, views, add_to_carts, purchases, revenue, cost, profit, units_sold)
  with ev as (
    select (e.created_at at time zone v_tz)::date as d,
           coalesce(c.name, e.category, '') as category,
           coalesce(b.name, e.brand, '') as brand,
           count(*) filter (where e.event_type = 'product_view') as views,
           count(*) filter (where e.event_type = 'add_to_cart') as atc
    from public.events e
    left join public.products p on p.id = e.product_id
    left join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where e.event_type in ('product_view', 'add_to_cart')
      and e.created_at >= (p_from::timestamp at time zone v_tz)
      and e.created_at <  ((p_to + 1)::timestamp at time zone v_tz)
    group by 1, 2, 3
  ), sl as (
    select (s.paid_at at time zone v_tz)::date as d, s.category, s.brand,
           count(distinct s.order_id) as purchases,
           sum(s.revenue) as revenue, sum(s.cogs) as cost,
           sum(s.revenue - s.cogs - s.fees - s.shipping_cost + s.shipping_charged - s.tax) as profit,
           sum(s.units) as units
    from public.sales_lines s
    where s.paid_at >= (p_from::timestamp at time zone v_tz)
      and s.paid_at <  ((p_to + 1)::timestamp at time zone v_tz)
    group by 1, 2, 3
  )
  select coalesce(ev.d, sl.d), coalesce(ev.category, sl.category), coalesce(ev.brand, sl.brand),
         coalesce(ev.views, 0), coalesce(ev.atc, 0), coalesce(sl.purchases, 0),
         coalesce(sl.revenue, 0), coalesce(sl.cost, 0), coalesce(sl.profit, 0), coalesce(sl.units, 0)
  from ev full outer join sl on sl.d = ev.d and sl.category = ev.category and sl.brand = ev.brand;

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
