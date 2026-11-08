-- Dashboard aggregation RPCs. Every heavy number is computed here, never client-side.
-- All take [p_from, p_to) as timestamptz; the app converts date ranges in the store timezone.
-- Execution is restricted to service_role (see end of file); the app authorises the admin first
-- and strips cost/profit fields for staff.

create or replace function public.store_tz() returns text language sql stable as $$
  select coalesce((select timezone from public.store_settings where id = 1), 'UTC');
$$;

-- ---------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------
create or replace function public.admin_kpis(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with sales as (
    select count(distinct order_id) as orders,
           coalesce(sum(units), 0) as units,
           coalesce(sum(revenue + shipping_charged), 0) as revenue,
           coalesce(sum(revenue - cogs - fees - shipping_cost + shipping_charged - tax), 0) as profit,
           coalesce(sum(cogs), 0) as cogs
    from public.sales_lines where paid_at >= p_from and paid_at < p_to
  ), traffic as (
    select count(*) as sessions,
           count(distinct coalesce(visitor_id, id)) as visitors,
           count(*) filter (where converted) as converted
    from public.sessions where first_seen >= p_from and first_seen < p_to and not is_bot
  )
  select jsonb_build_object(
    'revenue', s.revenue,
    'profit', s.profit,
    'cogs', s.cogs,
    'orders', s.orders,
    'units', s.units,
    'aov', case when s.orders > 0 then round(s.revenue / s.orders, 2) else 0 end,
    'sessions', t.sessions,
    'visitors', t.visitors,
    'conversion_rate', case when t.sessions > 0 then round(t.converted::numeric / t.sessions, 4) else 0 end
  ) from sales s, traffic t;
$$;

create or replace function public.admin_inventory_value()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'units', coalesce(sum(v.quantity + v.reserved_quantity), 0),
    'skus', count(*) filter (where v.quantity + v.reserved_quantity > 0),
    'at_cost', coalesce(sum((v.quantity + v.reserved_quantity) * v.cost_price), 0),
    'at_retail', coalesce(sum((v.quantity + v.reserved_quantity) * v.price), 0),
    'potential_profit', coalesce(sum((v.quantity + v.reserved_quantity) * (v.price - v.cost_price)), 0)
  )
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where p.status not in ('archived') and v.status <> 'archived';
$$;

create or replace function public.admin_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text default 'day')
returns table (bucket date, revenue numeric, profit numeric, orders bigint, units bigint,
               sessions bigint, visitors bigint, page_views bigint)
language sql stable security definer set search_path = public as $$
  with tz as (select public.store_tz() as z),
  buckets as (
    select generate_series(
      date_trunc(p_bucket, (p_from at time zone (select z from tz))),
      date_trunc(p_bucket, ((p_to - interval '1 second') at time zone (select z from tz))),
      ('1 ' || p_bucket)::interval)::date as b
  ), s as (
    select date_trunc(p_bucket, paid_at at time zone (select z from tz))::date as b,
           sum(revenue + shipping_charged) as revenue,
           sum(revenue - cogs - fees - shipping_cost + shipping_charged - tax) as profit,
           count(distinct order_id) as orders, sum(units) as units
    from public.sales_lines where paid_at >= p_from and paid_at < p_to group by 1
  ), t as (
    select date_trunc(p_bucket, first_seen at time zone (select z from tz))::date as b,
           count(*) as sessions, count(distinct coalesce(visitor_id, id)) as visitors, sum(page_views) as page_views
    from public.sessions where first_seen >= p_from and first_seen < p_to and not is_bot group by 1
  )
  select buckets.b, coalesce(s.revenue, 0), coalesce(s.profit, 0), coalesce(s.orders, 0), coalesce(s.units, 0)::bigint,
         coalesce(t.sessions, 0), coalesce(t.visitors, 0), coalesce(t.page_views, 0)::bigint
  from buckets left join s on s.b = buckets.b left join t on t.b = buckets.b
  order by buckets.b;
$$;

create or replace function public.admin_alerts(p_unshipped_hours int default 48)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'low_stock', coalesce((
      select jsonb_agg(x order by x.quantity) from (
        select v.id as variant_id, p.id as product_id, p.title, v.size, v.quantity, v.low_stock_threshold
        from public.product_variants v join public.products p on p.id = v.product_id
        where p.status = 'active' and v.status = 'active' and v.quantity <= v.low_stock_threshold
          and v.low_stock_threshold > 1            -- multi-quantity lines only; one-offs are expected to hit 0
        limit 25) x), '[]'),
    'reserved_stuck', coalesce((
      select jsonb_agg(x) from (
        select v.id as variant_id, p.id as product_id, p.title, v.size, v.reserved_quantity,
               max(m.created_at) as reserved_since
        from public.product_variants v
        join public.products p on p.id = v.product_id
        join public.inventory_movements m on m.variant_id = v.id and m.reason = 'reserved'
        where v.reserved_quantity > 0
        group by v.id, p.id, p.title, v.size, v.reserved_quantity
        having max(m.created_at) < now() - interval '24 hours'
        limit 25) x), '[]'),
    'pending_offers', coalesce((
      select jsonb_agg(x) from (
        select o.id, o.amount, o.email, o.created_at, p.title, p.id as product_id
        from public.offers o join public.products p on p.id = o.product_id
        where o.status = 'pending' order by o.created_at limit 25) x), '[]'),
    'unshipped', coalesce((
      select jsonb_agg(x) from (
        select o.id, o.number, o.paid_at, o.total
        from public.orders o
        where o.status = 'paid' and o.channel = 'web' and o.shipped_at is null
          and o.paid_at < now() - make_interval(hours => p_unshipped_hours)
        order by o.paid_at limit 25) x), '[]'),
    'sell_requests', coalesce((
      select jsonb_agg(x) from (
        select id, name, brand, item, asking_price, created_at
        from public.sell_requests where status = 'new' order by created_at desc limit 25) x), '[]'),
    'top_recommendation', (
      select to_jsonb(r) from (
        select id, type, title, reason, score from public.recommendations
        where status = 'new' order by score desc, created_at desc limit 1) r)
  );
$$;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create or replace function public.admin_product_stats(p_from timestamptz, p_to timestamptz)
returns table (product_id uuid, views bigint, view_sessions bigint, add_to_carts bigint,
               purchase_sessions bigint, conversion numeric)
language sql stable security definer set search_path = public as $$
  select e.product_id,
         count(*) filter (where e.event_type = 'product_view'),
         count(distinct e.session_id) filter (where e.event_type = 'product_view'),
         count(*) filter (where e.event_type = 'add_to_cart'),
         count(distinct e.session_id) filter (where e.event_type = 'purchase'),
         round(count(distinct e.session_id) filter (where e.event_type = 'purchase')::numeric
               / nullif(count(distinct e.session_id) filter (where e.event_type = 'product_view'), 0), 4)
  from public.events e
  where e.product_id is not null and e.created_at >= p_from and e.created_at < p_to
    and e.event_type in ('product_view', 'add_to_cart', 'purchase')
  group by e.product_id;
$$;

create or replace function public.admin_product_insight(p_product_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with ev as (
    select * from public.events
    where product_id = p_product_id and created_at >= p_from and created_at < p_to
  ), prod as (
    select p.*, c.name as category_name, b.name as brand_name
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.id = p_product_id
  )
  select jsonb_build_object(
    'views', (select count(*) from ev where event_type = 'product_view'),
    'view_sessions', (select count(distinct session_id) from ev where event_type = 'product_view'),
    'add_to_carts', (select count(*) from ev where event_type = 'add_to_cart'),
    'purchases', (select count(distinct session_id) from ev where event_type = 'purchase'),
    'offers', (select count(*) from public.offers where product_id = p_product_id and created_at >= p_from and created_at < p_to),
    'avg_seconds_on_page', (select round(avg(value), 1) from ev where event_type = 'engagement'),
    'sources', coalesce((
      select jsonb_agg(x order by x.sessions desc) from (
        select s.source, count(distinct s.id) as sessions
        from ev join public.sessions s on s.id = ev.session_id
        where ev.event_type = 'product_view' and not s.is_bot
        group by s.source) x), '[]'),
    'daily_views', coalesce((
      select jsonb_agg(x order by x.date) from (
        select (created_at at time zone public.store_tz())::date as date, count(*) as views
        from ev where event_type = 'product_view' group by 1) x), '[]'),
    'price_history', coalesce((
      select jsonb_agg(x order by x.changed_at) from (
        select ph.changed_at, ph.old_price, ph.new_price, v.size
        from public.price_history ph join public.product_variants v on v.id = ph.variant_id
        where v.product_id = p_product_id) x), '[]'),
    'comparables', coalesce((
      select jsonb_agg(x order by x.paid_at desc) from (
        select sl.title, sl.size, sl.condition, sl.revenue / nullif(sl.units, 0) as price, sl.paid_at,
               round(extract(epoch from (sl.paid_at - coalesce(sl.listed_at, sl.product_created_at))) / 86400) as days_to_sell
        from public.sales_lines sl, prod
        where sl.product_id <> p_product_id and sl.units > 0
          and sl.category = coalesce(prod.category_name, '') and sl.brand = coalesce(prod.brand_name, '')
          and sl.paid_at > now() - interval '365 days'
        order by sl.paid_at desc limit 10) x), '[]')
  );
$$;

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
create or replace function public.admin_aging()
returns table (variant_id uuid, product_id uuid, title text, size text, condition text, category text, brand text,
               quantity int, price numeric, cost_price numeric, days_listed int, views_30d bigint,
               bucket text, suggested_markdown_pct int, suggested_price numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select v.id as variant_id, p.id as product_id, p.title, v.size, v.condition,
           coalesce(c.name, '') as category, coalesce(b.name, '') as brand,
           v.quantity, v.price, v.cost_price,
           floor(extract(epoch from (now() - coalesce(p.listed_at, p.created_at))) / 86400)::int as days_listed
    from public.product_variants v
    join public.products p on p.id = v.product_id
    left join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.status = 'active' and v.status = 'active' and v.quantity > 0
  ), views as (
    select product_id, count(*) as views from public.events
    where event_type = 'product_view' and created_at > now() - interval '30 days' and product_id is not null
    group by product_id
  )
  select b.variant_id, b.product_id, b.title, b.size, b.condition, b.category, b.brand,
         b.quantity, b.price, b.cost_price, b.days_listed, coalesce(vw.views, 0),
         case when b.days_listed >= 90 then '90+' when b.days_listed >= 60 then '60-89'
              when b.days_listed >= 30 then '30-59' else '0-29' end,
         m.pct,
         -- never suggest below cost + 5%
         greatest(round(b.price * (100 - m.pct) / 100, 0), round(b.cost_price * 1.05, 0))
  from base b
  left join views vw on vw.product_id = b.product_id
  cross join lateral (select case when b.days_listed >= 90 then 25 when b.days_listed >= 60 then 15
                                  when b.days_listed >= 30 then 10 else 0 end as pct) m
  where b.days_listed >= 30
  order by b.days_listed desc;
$$;

-- Units sold per variant over the last p_days (for sell-through & stockout prediction).
create or replace function public.admin_variant_velocity(p_days int default 30)
returns table (variant_id uuid, product_id uuid, title text, size text, quantity int,
               reserved_quantity int, low_stock_threshold int, units_sold bigint, first_sale timestamptz)
language sql stable security definer set search_path = public as $$
  select v.id, v.product_id, p.title, v.size, v.quantity, v.reserved_quantity, v.low_stock_threshold,
         coalesce(sum(sl.units), 0), min(sl.paid_at)
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.sales_lines sl on sl.variant_id = v.id and sl.paid_at > now() - make_interval(days => p_days)
  where p.status in ('active', 'sold') and v.status in ('active', 'sold_out')
  group by v.id, p.title;
$$;

-- ---------------------------------------------------------------------------
-- Revenue & profit
-- ---------------------------------------------------------------------------
create or replace function public.admin_pnl(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select coalesce(sum(revenue), 0) as item_revenue, coalesce(sum(shipping_charged), 0) as shipping_charged,
           coalesce(sum(cogs), 0) as cogs, coalesce(sum(fees), 0) as fees,
           coalesce(sum(shipping_cost), 0) as shipping_cost, coalesce(sum(tax), 0) as tax,
           count(distinct order_id) as orders, coalesce(sum(units), 0) as units
    from public.sales_lines where paid_at >= p_from and paid_at < p_to
  ), refunded_items as (
    -- value of refunded units already removed from item_revenue
    select coalesce(sum(oi.refunded_qty * oi.unit_price), 0) as v
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.paid_at >= p_from and o.paid_at < p_to
  ), r as (
    select coalesce(sum(amount), 0) as refunds from public.refunds rf
    join public.orders o on o.id = rf.order_id
    where o.paid_at >= p_from and o.paid_at < p_to
  ), e as (
    select coalesce(sum(amount), 0) as expenses from public.expenses
    where date >= (p_from at time zone public.store_tz())::date and date < (p_to at time zone public.store_tz())::date
  )
  select jsonb_build_object(
    'gross_revenue', l.item_revenue + ri.v + l.shipping_charged,
    'refunds', r.refunds,
    -- money refunded beyond the refunded units (goodwill / shipping refunds)
    'other_refunds', greatest(r.refunds - ri.v, 0),
    'net_revenue', l.item_revenue + l.shipping_charged - greatest(r.refunds - ri.v, 0),
    'item_revenue', l.item_revenue,
    'shipping_charged', l.shipping_charged,
    'payment_fees', l.fees,
    'shipping_costs', l.shipping_cost,
    'tax', l.tax,
    'cogs', l.cogs,
    'gross_profit', l.item_revenue + l.shipping_charged - greatest(r.refunds - ri.v, 0) - l.cogs - l.fees - l.shipping_cost - l.tax,
    'expenses', e.expenses,
    'net_profit', l.item_revenue + l.shipping_charged - greatest(r.refunds - ri.v, 0) - l.cogs - l.fees - l.shipping_cost - l.tax - e.expenses,
    'orders', l.orders,
    'units', l.units
  ) from l, refunded_items ri, r, e;
$$;

create or replace function public.admin_breakdown(p_from timestamptz, p_to timestamptz, p_dim text)
returns table (key text, label text, revenue numeric, cogs numeric, fees numeric, profit numeric,
               units bigint, orders bigint, margin numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_dim not in ('category', 'brand', 'product', 'size', 'channel', 'month') then
    raise exception 'Unknown dimension %', p_dim;
  end if;
  return query
  select k.key, k.label,
         sum(sl.revenue + sl.shipping_charged),
         sum(sl.cogs),
         sum(sl.fees + sl.shipping_cost),
         sum(sl.revenue - sl.cogs - sl.fees - sl.shipping_cost + sl.shipping_charged - sl.tax),
         sum(sl.units)::bigint,
         count(distinct sl.order_id),
         round(sum(sl.revenue - sl.cogs - sl.fees - sl.shipping_cost + sl.shipping_charged - sl.tax)
               / nullif(sum(sl.revenue + sl.shipping_charged), 0), 4)
  from public.sales_lines sl
  cross join lateral (
    select case p_dim
             when 'category' then nullif(sl.category, '')
             when 'brand' then nullif(sl.brand, '')
             when 'product' then sl.product_id::text
             when 'size' then nullif(sl.size, '')
             when 'channel' then sl.channel
             when 'month' then to_char(sl.paid_at at time zone public.store_tz(), 'YYYY-MM')
           end as key,
           case p_dim
             when 'product' then sl.title
             when 'size' then coalesce(nullif(sl.category, '') || ' · ', '') || sl.size
             else null
           end as label
  ) k
  where sl.paid_at >= p_from and sl.paid_at < p_to
  group by k.key, k.label
  order by 6 desc nulls last;
end $$;

create or replace function public.admin_days_to_sell(p_from timestamptz, p_to timestamptz)
returns table (category text, units bigint, avg_days numeric, median_days numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(category, ''), 'Uncategorised'), sum(units)::bigint,
         round(avg(d), 1), round((percentile_cont(0.5) within group (order by d))::numeric, 1)
  from (
    select category, units,
           extract(epoch from (paid_at - coalesce(listed_at, product_created_at))) / 86400 as d
    from public.sales_lines
    where paid_at >= p_from and paid_at < p_to and units > 0
  ) x
  group by 1 order by 3;
$$;

create or replace function public.admin_customers(p_search text default null, p_limit int default 200)
returns table (id uuid, name text, email text, instagram_handle text, orders bigint, lifetime_value numeric,
               first_order timestamptz, last_order timestamptz, is_repeat boolean, marketing_opt_in boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.email, c.instagram_handle,
         count(o.id) filter (where o.paid_at is not null),
         coalesce(sum(o.total - o.refunded_amount) filter (where o.paid_at is not null), 0),
         min(o.paid_at), max(o.paid_at),
         count(o.id) filter (where o.paid_at is not null) > 1,
         c.marketing_opt_in
  from public.customers c
  left join public.orders o on o.customer_id = c.id and o.status not in ('pending', 'cancelled')
  where p_search is null or c.email ilike '%' || p_search || '%' or c.name ilike '%' || p_search || '%'
  group by c.id
  order by 6 desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Traffic
-- ---------------------------------------------------------------------------
create or replace function public.admin_traffic_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sessions', count(*),
    'visitors', count(distinct coalesce(visitor_id, id)),
    'page_views', coalesce(sum(page_views), 0),
    'bounce_rate', round(count(*) filter (where page_views <= 1)::numeric / nullif(count(*), 0), 4),
    'avg_session_seconds', round(avg(extract(epoch from (last_seen - first_seen))) filter (where page_views > 1), 0),
    'new_sessions', count(*) filter (where not is_returning),
    'returning_sessions', count(*) filter (where is_returning),
    'conversion_rate', round(count(*) filter (where converted)::numeric / nullif(count(*), 0), 4)
  )
  from public.sessions where first_seen >= p_from and first_seen < p_to and not is_bot;
$$;

create or replace function public.admin_sources(p_from timestamptz, p_to timestamptz)
returns table (source text, sessions bigint, visitors bigint, conversions bigint, conversion_rate numeric, revenue numeric)
language sql stable security definer set search_path = public as $$
  select s.source, count(*), count(distinct coalesce(s.visitor_id, s.id)),
         count(*) filter (where s.converted),
         round(count(*) filter (where s.converted)::numeric / nullif(count(*), 0), 4),
         coalesce(sum(o.rev), 0)
  from public.sessions s
  left join (select session_id, sum(total - refunded_amount) as rev from public.orders
             where paid_at is not null and session_id is not null group by session_id) o on o.session_id = s.id
  where s.first_seen >= p_from and s.first_seen < p_to and not s.is_bot
  group by s.source order by 2 desc;
$$;

create or replace function public.admin_campaigns(p_from timestamptz, p_to timestamptz)
returns table (campaign text, source text, medium text, sessions bigint, conversions bigint, revenue numeric)
language sql stable security definer set search_path = public as $$
  select s.campaign, s.source, s.medium, count(*), count(*) filter (where s.converted), coalesce(sum(o.rev), 0)
  from public.sessions s
  left join (select session_id, sum(total - refunded_amount) as rev from public.orders
             where paid_at is not null and session_id is not null group by session_id) o on o.session_id = s.id
  where s.first_seen >= p_from and s.first_seen < p_to and not s.is_bot and s.campaign is not null
  group by 1, 2, 3 order by 4 desc limit 50;
$$;

create or replace function public.admin_funnel(p_from timestamptz, p_to timestamptz,
  p_category text default null, p_source text default null, p_device text default null)
returns table (step int, name text, sessions bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select id from public.sessions
    where first_seen >= p_from and first_seen < p_to and not is_bot
      and (p_source is null or source = p_source)
      and (p_device is null or device = p_device)
  ), e as (
    select e.session_id, e.event_type from public.events e
    join s on s.id = e.session_id
    left join public.products p on p.id = e.product_id
    left join public.categories c on c.id = p.category_id
    where e.created_at >= p_from and e.created_at < p_to + interval '1 day'
      and e.event_type in ('product_view', 'add_to_cart', 'checkout_started', 'purchase')
      and (p_category is null or e.event_type = 'checkout_started' or c.name = p_category or e.category = p_category)
  )
  select 1, 'Visit', (select count(*) from s)
  union all select 2, 'Product view', (select count(distinct session_id) from e where event_type = 'product_view')
  union all select 3, 'Add to cart', (select count(distinct session_id) from e where event_type = 'add_to_cart')
  union all select 4, 'Checkout started', (select count(distinct session_id) from e where event_type = 'checkout_started'
                                              and (p_category is null or session_id in (select session_id from e where event_type = 'add_to_cart')))
  union all select 5, 'Purchase', (select count(distinct session_id) from e where event_type = 'purchase')
  order by 1;
$$;

create or replace function public.admin_top_viewed(p_from timestamptz, p_to timestamptz, p_limit int default 20)
returns table (product_id uuid, title text, status text, views bigint, add_to_carts bigint, purchases bigint)
language sql stable security definer set search_path = public as $$
  select e.product_id, p.title, p.status,
         count(*) filter (where e.event_type = 'product_view'),
         count(*) filter (where e.event_type = 'add_to_cart'),
         count(distinct e.session_id) filter (where e.event_type = 'purchase')
  from public.events e join public.products p on p.id = e.product_id
  where e.created_at >= p_from and e.created_at < p_to
    and e.event_type in ('product_view', 'add_to_cart', 'purchase')
  group by e.product_id, p.title, p.status
  order by 4 desc limit p_limit;
$$;

create or replace function public.admin_search_terms(p_from timestamptz, p_to timestamptz, p_limit int default 30)
returns table (query text, searches bigint, zero_result_searches bigint, avg_results numeric)
language sql stable security definer set search_path = public as $$
  select e.query, count(*), count(*) filter (where coalesce(e.value, 0) = 0), round(avg(e.value), 1)
  from public.events e
  where e.event_type = 'search' and e.query is not null and e.query <> ''
    and e.created_at >= p_from and e.created_at < p_to
  group by e.query order by 2 desc limit p_limit;
$$;

create or replace function public.admin_filters_used(p_from timestamptz, p_to timestamptz, p_limit int default 30)
returns table (filter text, value text, uses bigint)
language sql stable security definer set search_path = public as $$
  select e.props ->> 'filter', e.props ->> 'value', count(*)
  from public.events e
  where e.event_type = 'filter_used' and e.created_at >= p_from and e.created_at < p_to
  group by 1, 2 order by 3 desc limit p_limit;
$$;

create or replace function public.admin_session_breakdown(p_from timestamptz, p_to timestamptz, p_dim text)
returns table (key text, sessions bigint, conversions bigint, conversion_rate numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(case p_dim when 'device' then device when 'country' then country end, 'Unknown'),
         count(*), count(*) filter (where converted),
         round(count(*) filter (where converted)::numeric / nullif(count(*), 0), 4)
  from public.sessions
  where first_seen >= p_from and first_seen < p_to and not is_bot
  group by 1 order by 2 desc limit 30;
$$;

create or replace function public.admin_realtime(p_minutes int default 5)
returns jsonb language sql stable security definer set search_path = public as $$
  with active as (
    select id from public.sessions
    where last_seen > now() - make_interval(mins => p_minutes) and not is_bot
  ), latest as (
    select distinct on (e.session_id) e.session_id, e.path, e.product_id
    from public.events e join active a on a.id = e.session_id
    where e.event_type in ('page_view', 'product_view') and e.created_at > now() - interval '30 minutes'
    order by e.session_id, e.created_at desc
  )
  select jsonb_build_object(
    'active', (select count(*) from active),
    'pages', coalesce((
      select jsonb_agg(x order by x.visitors desc) from (
        select l.path, p.title, count(*) as visitors
        from latest l left join public.products p on p.id = l.product_id
        group by l.path, p.title order by 3 desc limit 10) x), '[]')
  );
$$;

-- ---------------------------------------------------------------------------
-- Forecasting & recommendation inputs
-- ---------------------------------------------------------------------------
-- Daily units & revenue per scope over the last p_days (zero-filled by the app).
create or replace function public.admin_forecast_series(p_days int default 365)
returns table (date date, scope text, scope_value text, units bigint, revenue numeric)
language sql stable security definer set search_path = public as $$
  with sl as (
    select (paid_at at time zone public.store_tz())::date as d, * from public.sales_lines
    where paid_at > now() - make_interval(days => p_days)
  )
  select d, 'overall', '', sum(units)::bigint, sum(revenue) from sl group by d
  union all select d, 'category', category, sum(units)::bigint, sum(revenue) from sl where category <> '' group by d, category
  union all select d, 'brand', brand, sum(units)::bigint, sum(revenue) from sl where brand <> '' group by d, brand
  union all select d, 'size', coalesce(nullif(category, '') || ' · ', '') || size, sum(units)::bigint, sum(revenue)
            from sl where size is not null and size <> '' group by d, 3
  union all select d, 'product', product_id::text, sum(units)::bigint, sum(revenue)
            from sl where product_id is not null group by d, product_id;
$$;

-- Everything the recommendation engine needs, computed in one pass.
create or replace function public.admin_reco_inputs(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with win as (select now() - make_interval(days => p_days) as cur_from,
                      now() - make_interval(days => p_days * 2) as prev_from),
  ev as (
    select e.product_id,
           count(*) filter (where e.event_type = 'product_view' and e.created_at >= (select cur_from from win)) as views,
           count(*) filter (where e.event_type = 'product_view' and e.created_at < (select cur_from from win)) as views_prev,
           count(distinct e.session_id) filter (where e.event_type = 'product_view' and e.created_at >= (select cur_from from win)) as view_sessions,
           count(*) filter (where e.event_type = 'add_to_cart' and e.created_at >= (select cur_from from win)) as atc,
           count(distinct e.session_id) filter (where e.event_type = 'purchase' and e.created_at >= (select cur_from from win)) as purchase_sessions
    from public.events e
    where e.product_id is not null and e.created_at >= (select prev_from from win)
      and e.event_type in ('product_view', 'add_to_cart', 'purchase')
    group by e.product_id
  ),
  stock as (
    select product_id, sum(quantity + reserved_quantity) as on_hand,
           round(avg(price), 2) as avg_price, round(avg(cost_price), 2) as avg_cost
    from public.product_variants where status <> 'archived' group by product_id
  ),
  sold as (
    select product_id, sum(units) as units, sum(revenue) as revenue,
           sum(revenue - cogs - fees - shipping_cost + shipping_charged - tax) as profit,
           avg(extract(epoch from (paid_at - coalesce(listed_at, product_created_at))) / 86400) as avg_days_to_sell,
           count(*) filter (where extract(epoch from (paid_at - coalesce(listed_at, product_created_at))) < 3 * 86400) as fast_sales
    from public.sales_lines where paid_at >= (select now() - make_interval(days => greatest(p_days, 90))) and units > 0
    group by product_id
  ),
  offers as (
    select product_id, count(*) as offers from public.offers
    where created_at >= (select cur_from from win) group by product_id
  ),
  wl as (
    select product_id, count(*) as waitlist from public.waitlist
    where created_at >= (select cur_from from win) and product_id is not null group by product_id
  )
  select jsonb_build_object(
    'window_days', p_days,
    'products', coalesce((select jsonb_agg(x) from (
      select p.id, p.title, p.status, coalesce(c.name, '') as category, coalesce(b.name, '') as brand,
             floor(extract(epoch from (now() - coalesce(p.listed_at, p.created_at))) / 86400)::int as days_listed,
             coalesce(ev.views, 0) as views, coalesce(ev.views_prev, 0) as views_prev,
             coalesce(ev.view_sessions, 0) as view_sessions, coalesce(ev.atc, 0) as add_to_carts,
             coalesce(ev.purchase_sessions, 0) as purchase_sessions,
             coalesce(st.on_hand, 0) as on_hand, st.avg_price, st.avg_cost,
             coalesce(sd.units, 0) as units_sold, coalesce(sd.revenue, 0) as revenue, coalesce(sd.profit, 0) as profit,
             round(sd.avg_days_to_sell::numeric, 1) as avg_days_to_sell, coalesce(sd.fast_sales, 0) as fast_sales,
             coalesce(o.offers, 0) as offers, coalesce(w.waitlist, 0) as waitlist
      from public.products p
      left join public.categories c on c.id = p.category_id
      left join public.brands b on b.id = p.brand_id
      left join ev on ev.product_id = p.id
      left join stock st on st.product_id = p.id
      left join sold sd on sd.product_id = p.id
      left join offers o on o.product_id = p.id
      left join wl w on w.product_id = p.id
      where p.status in ('active', 'sold') and (p.status = 'active' or p.sold_at > now() - interval '120 days')
    ) x), '[]'),
    'sizes', coalesce((select jsonb_agg(x) from (
      select coalesce(c.name, '') as category, v.size,
             sum(v.quantity + v.reserved_quantity) as on_hand,
             coalesce(sum(sl.units), 0) as units_sold,
             round(avg(extract(epoch from (sl.paid_at - coalesce(sl.listed_at, sl.product_created_at))) / 86400)::numeric, 1) as avg_days_to_sell
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.categories c on c.id = p.category_id
      left join public.sales_lines sl on sl.variant_id = v.id and sl.paid_at > now() - interval '90 days' and sl.units > 0
      where v.size is not null and v.size <> ''
      group by 1, 2
    ) x), '[]'),
    'size_filters', coalesce((select jsonb_agg(x) from (
      select e.props ->> 'value' as size, count(*) as uses
      from public.events e
      where e.event_type = 'filter_used' and e.props ->> 'filter' = 'size' and e.created_at >= (select cur_from from win)
      group by 1
    ) x), '[]'),
    'zero_result_searches', coalesce((select jsonb_agg(x) from (
      select e.query, count(*) as searches
      from public.events e
      where e.event_type = 'search' and coalesce(e.value, 0) = 0 and e.query is not null
        and e.created_at >= (select cur_from from win)
      group by e.query having count(*) >= 2 order by 2 desc limit 50
    ) x), '[]'),
    'waitlist_unmatched', coalesce((select jsonb_agg(x) from (
      select coalesce(brand, '') as brand, coalesce(category, '') as category, coalesce(keyword, '') as keyword,
             coalesce(size, '') as size, count(*) as signups
      from public.waitlist
      where product_id is null and created_at >= (select cur_from from win)
      group by 1, 2, 3, 4
    ) x), '[]'),
    'brands', coalesce((select jsonb_agg(name) from public.brands), '[]'),
    'categories', coalesce((select jsonb_agg(name) from public.categories), '[]')
  );
$$;

-- ---------------------------------------------------------------------------
-- Lock down: these functions bypass RLS (security definer), so only service_role may call them.
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname in (
        'adjust_stock', 'receive_stock', 'record_sale', 'record_refund', 'refresh_daily_metrics'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
