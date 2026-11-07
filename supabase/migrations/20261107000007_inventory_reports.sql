-- Inventory valuation breakdown and stock overview (service role only).

create or replace function public.admin_inventory_valuation()
returns table (category text, units bigint, skus bigint, at_cost numeric, at_retail numeric, potential_profit numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(c.name, 'Uncategorised'),
         sum(v.quantity + v.reserved_quantity)::bigint,
         count(*) filter (where v.quantity + v.reserved_quantity > 0),
         sum((v.quantity + v.reserved_quantity) * v.cost_price),
         sum((v.quantity + v.reserved_quantity) * v.price),
         sum((v.quantity + v.reserved_quantity) * (v.price - v.cost_price))
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.categories c on c.id = p.category_id
  where p.status <> 'archived' and v.status <> 'archived'
  group by 1
  having sum(v.quantity + v.reserved_quantity) > 0
  order by 4 desc;
$$;

create or replace function public.admin_stock_overview(p_product_id uuid default null)
returns table (variant_id uuid, product_id uuid, title text, product_status text, category text, brand text,
               size text, condition text, sku text, price numeric, cost_price numeric, quantity int,
               reserved_quantity int, low_stock_threshold int, variant_status text, is_low boolean,
               last_movement_at timestamptz, units_sold_30d bigint)
language sql stable security definer set search_path = public as $$
  select v.id, p.id, p.title, p.status, coalesce(c.name, ''), coalesce(b.name, ''), v.size, v.condition, v.sku,
         v.price, v.cost_price, v.quantity, v.reserved_quantity, v.low_stock_threshold, v.status,
         v.status = 'active' and v.low_stock_threshold > 1 and v.quantity <= v.low_stock_threshold,
         (select max(m.created_at) from public.inventory_movements m where m.variant_id = v.id),
         coalesce((select sum(sl.units) from public.sales_lines sl where sl.variant_id = v.id and sl.paid_at > now() - interval '30 days'), 0)::bigint
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  where p.status <> 'archived' and v.status <> 'archived'
    and (p_product_id is null or p.id = p_product_id)
  order by p.title, v.position;
$$;

revoke execute on function public.admin_inventory_valuation() from public, anon, authenticated;
revoke execute on function public.admin_stock_overview(uuid) from public, anon, authenticated;
grant execute on function public.admin_inventory_valuation() to service_role;
grant execute on function public.admin_stock_overview(uuid) to service_role;
