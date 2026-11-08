-- Row-level security. The admin app talks to the DB with the service role after authorising the
-- user server-side; these policies are defence in depth and cover direct storefront (anon) reads.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'categories', 'brands', 'drops', 'products', 'product_images', 'product_variants',
    'inventory_movements', 'product_costs', 'price_history', 'customers', 'orders', 'order_items',
    'order_events', 'refunds', 'offers', 'raffles', 'raffle_entries', 'sell_requests', 'waitlist',
    'expenses', 'purchase_tasks', 'store_settings', 'audit_log', 'notifications', 'sessions', 'events',
    'daily_metrics', 'forecasts', 'recommendations', 'ai_briefs', 'cron_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profiles: read your own; owners read all.
create policy profiles_self on public.profiles for select using (id = auth.uid() or public.is_owner());

-- Public catalogue.
create policy categories_read on public.categories for select using (true);
create policy brands_read on public.brands for select using (true);
create policy drops_read on public.drops for select using (status in ('scheduled', 'live', 'ended') or public.is_admin());
create policy products_read on public.products for select
  using (status in ('active', 'sold') or public.is_admin());
create policy product_images_read on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id and (p.status in ('active', 'sold') or public.is_admin())));

-- Variants hold cost_price, so only owners read the table directly; the storefront reads storefront_variants.
create policy product_variants_owner on public.product_variants for select using (public.is_owner());
grant select on public.storefront_variants to anon, authenticated;

-- Customers can see their own orders.
create policy customers_self on public.customers for select using (user_id = auth.uid());
create policy orders_self on public.orders for select
  using (exists (select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid()));
create policy order_items_self on public.order_items for select
  using (exists (select 1 from public.orders o join public.customers c on c.id = o.customer_id
                 where o.id = order_id and c.user_id = auth.uid()));

-- Everything else: no policies => no access except service_role.

-- Publish products whose scheduled time has passed (called by cron).
create or replace function public.publish_scheduled_products() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.products set status = 'active'
   where status = 'scheduled' and publish_at is not null and publish_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.publish_scheduled_products() from public, anon, authenticated;
grant execute on function public.publish_scheduled_products() to service_role;

