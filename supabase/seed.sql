-- Demo data: ~150 days of catalogue, traffic and sales so every dashboard has something to show.
-- Deterministic (setseed). Safe to run on an empty database only. `supabase db reset` runs it automatically.

select setseed(0.42);

insert into public.categories (name, slug) values
  ('Sneakers', 'sneakers'), ('Hoodies', 'hoodies'), ('Tees', 'tees'), ('Jackets', 'jackets'),
  ('Trousers', 'trousers'), ('Accessories', 'accessories');

insert into public.brands (name, slug) values
  ('Nike', 'nike'), ('Jordan', 'jordan'), ('Adidas', 'adidas'), ('New Balance', 'new-balance'), ('Stussy', 'stussy'),
  ('Supreme', 'supreme'), ('Carhartt WIP', 'carhartt-wip'), ('The North Face', 'the-north-face'), ('Palace', 'palace'), ('Essentials', 'essentials');

do $$
declare
  cat record; br record;
  v_pid uuid; v_vid uuid; v_listed timestamptz; v_price numeric; v_cost numeric; v_qty int; v_multi boolean;
  v_sizes text[]; v_size text; i int; j int; n int;
  sneaker_models text[];
  apparel text[] := array['Basic Logo','Stock Logo','Box Logo','Heavyweight','Arch Logo','Script','Tri-Ferg','Nuptse','Detroit','Carpenter','Cargo','Fleece','Vintage Wash','Essential'];
  conditions text[] := array['new','new','new','used_excellent','used_excellent','used_good','new_defects'];
begin
  for n in 1..320 loop
    select * into cat from public.categories order by random()::numeric limit 1;
    select * into br from public.brands order by random()::numeric limit 1;
    if cat.name = 'Sneakers' and br.name not in ('Nike','Jordan','Adidas','New Balance') then
      select * into br from public.brands where name in ('Nike','Jordan','Adidas','New Balance') order by random()::numeric limit 1;
    end if;
    sneaker_models := case br.name
      when 'Nike' then array['Dunk Low Panda','Air Max 1','Air Force 1 07','Air Max 95','Blazer Mid 77']
      when 'Jordan' then array['1 High Chicago','4 Military Black','3 White Cement','Spizike Low','1 Low Mocha']
      when 'Adidas' then array['Samba OG','Gazelle Indoor','Campus 00s','Spezial','SL 72']
      else array['550 White Green','990v6 Grey','2002R Protection Pack','9060','1906R'] end;
    v_multi := cat.name in ('Tees','Hoodies') and br.name in ('Essentials','Stussy','Carhartt WIP') and random()::numeric < 0.6;
    v_listed := now() - make_interval(days => (random()::numeric * 150)::int, hours => (random()::numeric * 20)::int);

    insert into public.products (title, slug, category_id, brand_id, status, tags, featured, allow_offers, offer_floor_price, listed_at, created_at, description)
    values (
      br.name || ' ' || case when cat.name = 'Sneakers' then sneaker_models[1 + floor(random()::numeric * array_length(sneaker_models, 1))::int]
                             else apparel[1 + floor(random()::numeric * array_length(apparel, 1))::int] || ' ' || (case cat.name when 'Hoodies' then 'Hoodie' when 'Tees' then 'Tee' when 'Jackets' then 'Jacket' when 'Accessories' then 'Cap' else cat.name end) end,
      'demo-' || n, cat.id, br.id, 'active',
      case when random()::numeric < 0.3 then array['grail'] else '{}' end,
      random()::numeric < 0.08, random()::numeric < 0.5, null, v_listed, v_listed - interval '1 day',
      'Demo listing.'
    ) returning id into v_pid;

    v_sizes := case
      when cat.name = 'Sneakers' then array['UK 6','UK 7','UK 8','UK 9','UK 10','UK 11']
      when cat.name = 'Accessories' then array['One size']
      else array['S','M','L','XL'] end;

    v_price := case cat.name when 'Sneakers' then 90 + random()::numeric * 260 when 'Jackets' then 120 + random()::numeric * 300
                             when 'Hoodies' then 60 + random()::numeric * 140 when 'Tees' then 30 + random()::numeric * 70
                             when 'Trousers' then 50 + random()::numeric * 110 else 25 + random()::numeric * 80 end;
    v_price := round(v_price / 5) * 5;
    v_cost := round(v_price * (0.45 + random()::numeric * 0.35), 2);
    -- Supreme/Palace/Jordan tend to be underpriced (sell fast); Essentials thin margins.
    if br.name in ('Supreme','Palace','Jordan') then v_cost := round(v_price * (0.4 + random()::numeric * 0.2), 2); end if;
    if br.name = 'Essentials' then v_cost := round(v_price * (0.82 + random()::numeric * 0.1), 2); end if;

    if v_multi then
      j := 0;
      foreach v_size in array v_sizes loop
        insert into public.product_variants (product_id, size, condition, price, low_stock_threshold, position, sku)
        values (v_pid, v_size, 'new', v_price, 3, j, 'DEMO-' || n || '-' || v_size) returning id into v_vid;
        perform public.receive_stock(v_vid, 6 + (random()::numeric * 14)::int, v_cost, 'retail', 0, 0, v_listed, 'Demo stock', null);
        j := j + 1;
      end loop;
    else
      v_size := v_sizes[1 + floor(random()::numeric * array_length(v_sizes, 1))::int];
      insert into public.product_variants (product_id, size, condition, price, low_stock_threshold, sku)
      values (v_pid, v_size, conditions[1 + floor(random()::numeric * array_length(conditions, 1))::int], v_price, 1, 'DEMO-' || n)
      returning id into v_vid;
      perform public.receive_stock(v_vid, 1, v_cost, (array['resale','retail','private','consignment'])[1 + floor(random()::numeric * 4)::int], round((random()::numeric * 6)::numeric, 2), round((random()::numeric * 8)::numeric, 2), v_listed, 'Demo stock', null);
    end if;
  end loop;

  -- A couple of drafts and a scheduled drop
  insert into public.drops (name, status, starts_at) values ('Friday Grails Drop', 'scheduled', now() + interval '3 days');
  update public.products set status = 'draft' where slug in ('demo-319', 'demo-320');
end $$;

-- ---------------------------------------------------------------------------
-- Traffic + sales, day by day
-- ---------------------------------------------------------------------------
do $$
declare
  d int; s int; k int; n_sessions int;
  v_day timestamptz; v_sid text; v_vis text; v_src text; v_dev text; v_country text; v_t timestamptz;
  v_prod record; v_pv int; v_bought boolean; v_order uuid; v_cust uuid; v_ship numeric; v_items jsonb;
  sources text[] := array['instagram','instagram','instagram','tiktok','tiktok','google','google','direct','direct','direct','referral','email'];
  devices text[] := array['mobile','mobile','mobile','mobile','desktop','desktop','tablet'];
  countries text[] := array['GB','GB','GB','GB','GB','IE','FR','DE','NL','US'];
  searches text[] := array['dunk','jordan 4','samba','box logo','stussy hoodie','corteiz cargos','corteiz','nike tech','arcteryx beta','990','carhartt','supreme tee','jordan 1','yeezy 350','new balance 550','bape hoodie'];
  sizes text[] := array['UK 8','UK 9','UK 9','UK 10','M','L','L','XL','S'];
  channels text[] := array['instagram','vinted','in_person','ebay','depop'];
begin
  for d in reverse 150..0 loop
    v_day := date_trunc('day', now()) - make_interval(days => d);
    -- Traffic grows over time with a weekend bump.
    n_sessions := (25 + (150 - d) * 0.35 + case when extract(dow from v_day) in (0, 5, 6) then 15 else 0 end + random()::numeric * 20)::int;
    for s in 1..n_sessions loop
      v_sid := 'seed-' || d || '-' || s;
      v_vis := case when random()::numeric < 0.3 then 'vis-' || (random()::numeric * 400)::int else 'vis-' || d || '-' || s end;
      v_src := sources[1 + floor(random()::numeric * array_length(sources, 1))::int];
      v_dev := devices[1 + floor(random()::numeric * array_length(devices, 1))::int];
      v_country := countries[1 + floor(random()::numeric * array_length(countries, 1))::int];
      v_t := v_day + make_interval(secs => (random()::numeric * 86000)::int);
      exit when v_t > now();
      v_pv := 1 + (random()::numeric * random()::numeric * 9)::int;

      insert into public.sessions (id, visitor_id, first_seen, last_seen, landing_page, source, medium, campaign, device, country,
                                   page_views, events_count, consent, is_returning)
      values (v_sid, v_vis, v_t, v_t + make_interval(secs => v_pv * (20 + (random()::numeric * 90)::int)), '/', v_src,
              case when v_src in ('instagram','tiktok') and random()::numeric < 0.4 then 'social' end,
              case when v_src = 'instagram' and random()::numeric < 0.3 then 'friday-drop' when v_src = 'email' then 'newsletter' end,
              v_dev, v_country, v_pv, v_pv, true, v_vis not like 'vis-' || d || '-%');

      insert into public.events (session_id, event_type, path, created_at, device, country, utm_source)
      select v_sid, 'page_view', '/', v_t + make_interval(secs => g * 30), v_dev, v_country, nullif(v_src, 'direct') from generate_series(1, v_pv) g;

      if random()::numeric < 0.25 then
        insert into public.events (session_id, event_type, query, value, created_at, device)
        select v_sid, 'search', q, case when q like 'corteiz%' or q in ('nike tech','arcteryx beta','yeezy 350','bape hoodie') then 0 else 1 + (random()::numeric * 8)::int end, v_t + interval '40 seconds', v_dev
        from (select searches[1 + floor(random()::numeric * array_length(searches, 1))::int] q) x;
      end if;
      if random()::numeric < 0.15 then
        insert into public.events (session_id, event_type, props, created_at)
        values (v_sid, 'filter_used', jsonb_build_object('filter', 'size', 'value', sizes[1 + floor(random()::numeric * array_length(sizes, 1))::int]), v_t + interval '50 seconds');
      end if;

      v_bought := false;
      for k in 1..least(v_pv, 4) loop
        exit when k = 1 and random()::numeric < 0.3; -- not every visit reaches a product page
        select p.id, c.name as category, b.name as brand, p.listed_at,
               exists (select 1 from public.product_variants pv where pv.product_id = p.id and pv.quantity > 0) as in_stock into v_prod
        from public.products p join public.categories c on c.id = p.category_id join public.brands b on b.id = p.brand_id
        where p.listed_at <= v_t and p.status in ('active', 'sold')
        order by random()::numeric * (case when b.name in ('Supreme','Palace','Jordan','Stussy') then 3 else 1 end) desc limit 1;
        exit when v_prod.id is null;
        insert into public.events (session_id, event_type, product_id, category, brand, created_at, device, country)
        values (v_sid, 'product_view', v_prod.id, v_prod.category, v_prod.brand, v_t + make_interval(secs => 60 + k * 45), v_dev, v_country);
        insert into public.events (session_id, event_type, product_id, value, created_at)
        values (v_sid, 'engagement', v_prod.id, 10 + (random()::numeric * 110)::int, v_t + make_interval(secs => 90 + k * 45));

        if v_prod.in_stock and random()::numeric < 0.09 then
          insert into public.events (session_id, event_type, product_id, category, brand, created_at)
          values (v_sid, 'add_to_cart', v_prod.id, v_prod.category, v_prod.brand, v_t + make_interval(secs => 100 + k * 45));
          if random()::numeric < 0.6 then
            insert into public.events (session_id, event_type, created_at) values (v_sid, 'checkout_started', v_t + make_interval(secs => 140 + k * 45));
            if not v_bought and random()::numeric < 0.75 then
              -- Web purchase of an in-stock variant of this product.
              select jsonb_agg(jsonb_build_object('variant_id', v.id, 'quantity', 1)) into v_items
              from (select id from public.product_variants where product_id = v_prod.id and quantity > 0 order by random()::numeric limit 1) v;
              if v_items is not null then
                insert into public.customers (email, name, marketing_opt_in)
                values ('customer' || (random()::numeric * 600)::int || '@example.com', 'Demo Customer', random()::numeric < 0.4)
                on conflict (email) do update set name = excluded.name returning id into v_cust;
                v_ship := case when random()::numeric < 0.7 then 4.99 else 0 end;
                v_order := public.record_sale(p_channel => 'web', p_items => v_items, p_customer_id => v_cust,
                                              p_shipping_charged => v_ship, p_shipping_cost => round((3.2 + random()::numeric * 2)::numeric, 2),
                                              p_paid_at => v_t + make_interval(secs => 200 + k * 45), p_session_id => v_sid);
                update public.orders set payment_fees = round(total * 0.015 + 0.20, 2), stripe_payment_intent_id = null,
                       status = case when v_t < now() - interval '3 days' then 'delivered' when v_t < now() - interval '1 day' then 'shipped' else 'paid' end,
                       shipped_at = case when v_t < now() - interval '1 day' then v_t + interval '1 day' end,
                       shipping_address = jsonb_build_object('line1', '1 Demo Street', 'city', 'London', 'postal_code', 'E1 6AN', 'country', 'GB')
                 where id = v_order;
                insert into public.events (session_id, event_type, product_id, category, brand, value, created_at)
                select v_sid, 'purchase', oi.product_id, v_prod.category, v_prod.brand, oi.unit_price, v_t + make_interval(secs => 210 + k * 45)
                from public.order_items oi where oi.order_id = v_order;
                update public.sessions set converted = true where id = v_sid;
                v_bought := true;
              end if;
            end if;
          end if;
        end if;
      end loop;
    end loop;

    -- Offline sales (Instagram DMs, Vinted, in person): ~1 every other day.
    if random()::numeric < 0.5 then
      select jsonb_agg(jsonb_build_object('variant_id', v.id, 'quantity', 1, 'unit_price', round(v.price * (0.9 + random()::numeric * 0.1)))) into v_items
      from (select v.id, v.price from public.product_variants v join public.products p on p.id = v.product_id
            where v.quantity > 0 and p.listed_at < v_day order by random()::numeric limit 1) v;
      if v_items is not null then
        v_order := public.record_sale(p_channel => channels[1 + floor(random()::numeric * array_length(channels, 1))::int], p_items => v_items,
                                      p_shipping_cost => 3.5, p_paid_at => v_day + interval '15 hours');
        update public.orders set status = 'delivered' where id = v_order;
      end if;
    end if;
  end loop;
end $$;

-- A fast-moving multi-quantity line (shows "Restock now" and stockout predictions).
do $$
declare v_pid uuid; v_m uuid; v_l uuid; d int;
begin
  insert into public.products (title, slug, category_id, brand_id, status, listed_at, created_at)
  select 'Stussy Basic Logo Tee', 'demo-basic-tee', c.id, b.id, 'active', now() - interval '45 days', now() - interval '46 days'
  from public.categories c, public.brands b where c.name = 'Tees' and b.name = 'Stussy'
  returning id into v_pid;
  insert into public.product_variants (product_id, size, condition, price, low_stock_threshold, sku, position)
  values (v_pid, 'M', 'new', 45, 5, 'DEMO-TEE-M', 0) returning id into v_m;
  insert into public.product_variants (product_id, size, condition, price, low_stock_threshold, sku, position)
  values (v_pid, 'L', 'new', 45, 5, 'DEMO-TEE-L', 1) returning id into v_l;
  perform public.receive_stock(v_m, 34, 19, 'retail', 0, 12, now() - interval '45 days', 'Wholesale order', null);
  perform public.receive_stock(v_l, 30, 19, 'retail', 0, 10, now() - interval '45 days', 'Wholesale order', null);
  for d in reverse 30..1 loop
    perform public.record_sale(p_channel => 'web', p_items => jsonb_build_array(jsonb_build_object('variant_id', v_m, 'quantity', 1)),
                               p_shipping_charged => 4.99, p_shipping_cost => 3.4, p_payment_fees => 0.9, p_paid_at => now() - make_interval(days => d, hours => 3));
    if d % 3 = 0 then
      perform public.record_sale(p_channel => 'web', p_items => jsonb_build_array(jsonb_build_object('variant_id', v_l, 'quantity', 1)),
                                 p_shipping_charged => 4.99, p_shipping_cost => 3.4, p_payment_fees => 0.9, p_paid_at => now() - make_interval(days => d, hours => 5));
    end if;
  end loop;
  update public.orders set status = 'delivered' where status = 'paid' and paid_at < now() - interval '3 days';
end $$;

-- A few refunds
do $$
declare r record;
begin
  for r in select ord.id, oi.id as item_id, oi.unit_price from public.orders ord join public.order_items oi on oi.order_id = ord.id
           where ord.channel = 'web' order by random()::numeric limit 4 loop
    perform public.record_refund(r.id, r.unit_price, jsonb_build_array(jsonb_build_object('order_item_id', r.item_id, 'quantity', 1)), true, 'Wrong size', null, null);
  end loop;
end $$;

-- Offers, sell requests, waitlist, expenses
insert into public.offers (product_id, email, amount, status, created_at)
select p.id, 'buyer' || g || '@example.com', round(v.price * (0.6 + random()::numeric * 0.3)), 'pending', now() - make_interval(hours => g * 7)
from generate_series(1, 6) g
cross join lateral (select p.id from public.products p where p.status = 'active' and p.allow_offers order by random()::numeric limit 1) p
cross join lateral (select price from public.product_variants where product_id = p.id limit 1) v;

insert into public.sell_requests (name, email, brand, item, size, condition, asking_price, status, created_at) values
  ('Sam', 'seller1@example.com', 'Corteiz', 'Guerillaz cargos', 'M', 'used_excellent', 120, 'new', now() - interval '5 hours'),
  ('Alex', 'seller2@example.com', 'Arc''teryx', 'Beta LT jacket', 'L', 'used_good', 260, 'new', now() - interval '1 day'),
  ('Jo', 'seller3@example.com', 'Jordan', 'Jordan 4 Bred Reimagined', 'UK 9', 'new', 210, 'reviewing', now() - interval '3 days');

insert into public.waitlist (brand, keyword, size, email, created_at)
select 'Corteiz', 'cargos', 'M', 'wait' || g || '@example.com', now() - make_interval(days => g) from generate_series(1, 7) g;
insert into public.waitlist (brand, keyword, email, created_at)
select 'Arc''teryx', 'beta jacket', 'arc' || g || '@example.com', now() - make_interval(days => g * 2) from generate_series(1, 4) g;

insert into public.expenses (date, category, description, amount)
select (now() - make_interval(days => g * 30))::date, c.category, c.description, c.amount
from generate_series(0, 4) g
cross join (values ('packaging', 'Mailer bags & tissue', 38.50), ('ads', 'Instagram ads', 120.00), ('subscriptions', 'Shopify apps / tools', 29.00)) as c(category, description, amount);

-- Roll everything up.
select public.refresh_daily_metrics((now() - interval '151 days')::date, current_date);
