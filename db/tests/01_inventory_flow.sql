-- Run after migrations: exercises ledger, cost basis, sale, refund and every admin RPC.
\set ON_ERROR_STOP 1
begin;
insert into categories (id, name, slug) values ('00000000-0000-0000-0000-0000000000c1', 'Sneakers', 'sneakers');
insert into brands (id, name, slug) values ('00000000-0000-0000-0000-0000000000b1', 'Nike', 'nike');
insert into products (id, title, slug, category_id, brand_id, status)
values ('00000000-0000-0000-0000-0000000000a1', 'Dunk Low Panda', 'dunk-low-panda',
        '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'active');
insert into product_variants (id, product_id, size, condition, price)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'UK 9', 'new', 150);

-- receive 2 @ 80 + 10 fees  => avg (160+10)/2 = 85
select receive_stock('00000000-0000-0000-0000-0000000000d1', 2, 80, 'retail', 10, 0);
-- receive 2 @ 100           => (2*85 + 200)/4 = 92.50
select receive_stock('00000000-0000-0000-0000-0000000000d1', 2, 100, 'resale');
do $$ begin
  assert (select cost_price from product_variants where id = '00000000-0000-0000-0000-0000000000d1') = 92.50, 'weighted avg';
  assert (select quantity from product_variants where id = '00000000-0000-0000-0000-0000000000d1') = 4, 'qty 4';
end $$;

-- direct update must fail
do $$ begin
  begin
    update product_variants set quantity = 99 where id = '00000000-0000-0000-0000-0000000000d1';
    raise exception 'guard did not fire';
  exception when sqlstate 'P0001' then null; end;
end $$;

-- adjustment without note must fail
do $$ begin
  begin perform adjust_stock('00000000-0000-0000-0000-0000000000d1', -1, 'adjustment', '', null);
    raise exception 'note not required?';
  exception when others then if sqlerrm not like '%note is required%' then raise; end if; end;
end $$;
select adjust_stock('00000000-0000-0000-0000-0000000000d1', -1, 'damaged', 'scuffed', null);

-- reserve 1, then sell 3 (one from reserved)
select adjust_stock('00000000-0000-0000-0000-0000000000d1', -1, 'reserved', 'cart', null);
select record_sale('instagram', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","quantity":2,"unit_price":140},
                                   {"variant_id":"00000000-0000-0000-0000-0000000000d1","quantity":1,"from_reserved":true}]'::jsonb,
                   p_shipping_charged => 5, p_payment_fees => 6, p_shipping_cost => 4);
do $$ begin
  assert (select quantity from product_variants where id = '00000000-0000-0000-0000-0000000000d1') = 0, 'sold out';
  assert (select status from product_variants where id = '00000000-0000-0000-0000-0000000000d1') = 'sold_out', 'variant status';
  assert (select status from products where id = '00000000-0000-0000-0000-0000000000a1') = 'sold', 'product sold';
  assert (select total from orders limit 1) = 435, 'order total 2*140+150+5';
end $$;

-- overselling must fail
do $$ begin
  begin perform record_sale('web', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","quantity":1}]');
    raise exception 'oversold';
  exception when sqlstate 'P0001' then null; end;
end $$;

-- refund 1 unit with restock => product back to active
select record_refund((select id from orders limit 1), 140,
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from order_items where unit_price = 140), 'quantity', 1)),
  true, 'wrong size');
do $$ begin
  assert (select quantity from product_variants where id = '00000000-0000-0000-0000-0000000000d1') = 1, 'restocked';
  assert (select status from products where id = '00000000-0000-0000-0000-0000000000a1') = 'active', 'reactivated';
  assert (select status from orders limit 1) = 'partially_refunded', 'partial';
  assert (select count(*) from price_history) = 1, 'price history on insert';
end $$;

-- movements are append-only
do $$ begin
  begin delete from inventory_movements; raise exception 'deleted'; exception when others then
    if sqlerrm not like '%append-only%' then raise; end if; end;
end $$;

-- analytics
insert into sessions (id, source, device, page_views, converted) values ('s1', 'instagram', 'mobile', 3, true), ('s2', 'google', 'desktop', 1, false);
insert into events (session_id, event_type, product_id, created_at) values
  ('s1', 'product_view', '00000000-0000-0000-0000-0000000000a1', now()),
  ('s2', 'product_view', '00000000-0000-0000-0000-0000000000a1', now()),
  ('s1', 'add_to_cart', '00000000-0000-0000-0000-0000000000a1', now()),
  ('s1', 'checkout_started', null, now()),
  ('s1', 'purchase', '00000000-0000-0000-0000-0000000000a1', now());
insert into events (session_id, event_type, query, value) values ('s2', 'search', 'jordan 4', 0), ('s1', 'search', 'jordan 4', 0);
insert into expenses (amount, category) values (12, 'packaging');

select refresh_daily_metrics(current_date - 1, current_date + 1) as rollup_rows;
select * from daily_metrics;
select admin_kpis(now() - interval '1 day', now() + interval '1 day');
select admin_pnl(now() - interval '1 day', now() + interval '1 day');
select admin_inventory_value();
select * from admin_timeseries(now() - interval '2 days', now() + interval '1 hour', 'day');
select admin_alerts();
select * from admin_product_stats(now() - interval '1 day', now() + interval '1 day');
select admin_product_insight('00000000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() + interval '1 day');
select * from admin_aging();
select * from admin_variant_velocity(30);
select * from admin_breakdown(now() - interval '1 day', now() + interval '1 day', 'size');
select * from admin_breakdown(now() - interval '1 day', now() + interval '1 day', 'month');
select * from admin_days_to_sell(now() - interval '1 day', now() + interval '1 day');
select * from admin_customers();
select admin_traffic_summary(now() - interval '1 day', now() + interval '1 day');
select * from admin_sources(now() - interval '1 day', now() + interval '1 day');
select * from admin_campaigns(now() - interval '1 day', now() + interval '1 day');
select * from admin_funnel(now() - interval '1 day', now() + interval '1 day');
select * from admin_funnel(now() - interval '1 day', now() + interval '1 day', 'Sneakers', null, 'mobile');
select * from admin_top_viewed(now() - interval '1 day', now() + interval '1 day');
select * from admin_search_terms(now() - interval '1 day', now() + interval '1 day');
select * from admin_filters_used(now() - interval '1 day', now() + interval '1 day');
select * from admin_session_breakdown(now() - interval '1 day', now() + interval '1 day', 'device');
select admin_realtime();
select count(*) from admin_forecast_series(365);
select jsonb_pretty(admin_reco_inputs(30)) is not null as reco_ok;
select publish_scheduled_products();
rollback;
