-- Storefront checkout: reserve stock atomically when a Stripe Checkout session is opened, convert the
-- reservation into a sale when payment completes, release it when the session expires or is abandoned.

create table public.checkouts (
  id                    uuid primary key default gen_random_uuid(),
  status                text not null default 'open'
                          check (status in ('open', 'awaiting_payment', 'completed', 'released')),
  items                 jsonb not null,            -- [{variant_id, product_id, quantity, unit_price, title, size, condition}]
  subtotal              numeric(12,2) not null,
  analytics_session_id  text,
  stripe_session_id     text unique,
  order_id              uuid references public.orders (id) on delete set null,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null default now() + interval '35 minutes',
  closed_at             timestamptz
);
create index checkouts_open_idx on public.checkouts (expires_at) where status in ('open', 'awaiting_payment');
alter table public.checkouts enable row level security;

-- Validate items, snapshot prices, reserve stock. All or nothing: any shortfall raises and nothing is held.
create or replace function public.checkout_open(p_items jsonb, p_analytics_session_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_lines jsonb := '[]';
  v_subtotal numeric := 0;
  r record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your bag is empty' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 25 then
    raise exception 'Too many items in one order' using errcode = 'P0001';
  end if;

  insert into public.checkouts (items, subtotal, analytics_session_id)
  values ('[]', 0, left(p_analytics_session_id, 64))
  returning id into v_id;

  for r in
    select v.id as variant_id, v.product_id, v.price, v.size, v.condition, v.status as variant_status,
           p.title, p.status as product_status, i.qty
    from (select (e ->> 'variant_id')::uuid as variant_id, sum(greatest(coalesce((e ->> 'quantity')::int, 1), 1))::int as qty
          from jsonb_array_elements(p_items) e group by 1) i
    left join public.product_variants v on v.id = i.variant_id
    left join public.products p on p.id = v.product_id
  loop
    if r.product_id is null or r.product_status <> 'active' or r.variant_status <> 'active' then
      raise exception 'An item in your bag is no longer available' using errcode = 'P0001';
    end if;
    begin
      insert into public.inventory_movements (variant_id, change, reason, note)
      values (r.variant_id, -r.qty, 'reserved', 'checkout ' || v_id);
    exception when sqlstate 'P0001' then
      raise exception 'Sorry — % (%) just sold out', r.title, coalesce(r.size, 'one size') using errcode = 'P0001';
    end;
    v_lines := v_lines || jsonb_build_object(
      'variant_id', r.variant_id, 'product_id', r.product_id, 'quantity', r.qty, 'unit_price', r.price,
      'title', r.title, 'size', r.size, 'condition', r.condition);
    v_subtotal := v_subtotal + r.qty * r.price;
  end loop;

  update public.checkouts set items = v_lines, subtotal = v_subtotal where id = v_id;
  return jsonb_build_object('id', v_id, 'items', v_lines, 'subtotal', v_subtotal);
end $$;

create or replace function public.checkout_attach(p_id uuid, p_stripe_session_id text, p_expires_at timestamptz)
returns void language sql security definer set search_path = public as $$
  update public.checkouts
     set stripe_session_id = p_stripe_session_id,
         expires_at = greatest(expires_at, p_expires_at + interval '5 minutes')
   where id = p_id and status = 'open';
$$;

-- Release held stock. Idempotent; only open / awaiting checkouts are released.
create or replace function public.checkout_release(p_id uuid default null, p_stripe_session_id text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_c public.checkouts; v_item jsonb;
begin
  select * into v_c from public.checkouts
   where (p_id is not null and id = p_id) or (p_stripe_session_id is not null and stripe_session_id = p_stripe_session_id)
   for update;
  if not found or v_c.status not in ('open', 'awaiting_payment') then return false; end if;
  for v_item in select * from jsonb_array_elements(v_c.items) loop
    insert into public.inventory_movements (variant_id, change, reason, note)
    values ((v_item ->> 'variant_id')::uuid, (v_item ->> 'quantity')::int, 'released', 'checkout ' || v_c.id || ' released');
  end loop;
  update public.checkouts set status = 'released', closed_at = now() where id = v_c.id;
  return true;
end $$;

-- Payment started but not yet settled (e.g. bank debit): keep the stock held for up to a week.
create or replace function public.checkout_mark_awaiting(p_stripe_session_id text)
returns void language sql security definer set search_path = public as $$
  update public.checkouts set status = 'awaiting_payment', expires_at = now() + interval '7 days'
   where stripe_session_id = p_stripe_session_id and status = 'open';
$$;

-- Paid: turn the reservation into a sale exactly once. Returns the order id.
create or replace function public.checkout_complete(
  p_stripe_session_id text,
  p_customer_id uuid,
  p_shipping_charged numeric,
  p_payment_fees numeric,
  p_tax numeric,
  p_discount numeric,
  p_paid_at timestamptz,
  p_payment_intent_id text,
  p_shipping_address jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_c public.checkouts; v_order uuid; v_from_reserved boolean;
begin
  select * into v_c from public.checkouts where stripe_session_id = p_stripe_session_id for update;
  if not found then raise exception 'Unknown checkout session %', p_stripe_session_id; end if;
  if v_c.status = 'completed' then return v_c.order_id; end if;

  -- A released checkout means the hold lapsed; sell from available stock (raises if it's gone).
  v_from_reserved := v_c.status in ('open', 'awaiting_payment');
  v_order := public.record_sale(
    p_channel => 'web',
    p_items => (select jsonb_agg(jsonb_build_object(
                  'variant_id', e ->> 'variant_id', 'quantity', (e ->> 'quantity')::int,
                  'unit_price', (e ->> 'unit_price')::numeric, 'from_reserved', v_from_reserved))
                from jsonb_array_elements(v_c.items) e),
    p_customer_id => p_customer_id,
    p_shipping_charged => p_shipping_charged,
    p_payment_fees => p_payment_fees,
    p_tax => p_tax,
    p_discount => p_discount,
    p_paid_at => p_paid_at,
    p_session_id => v_c.analytics_session_id,
    p_stripe_payment_intent_id => p_payment_intent_id,
    p_stripe_checkout_session_id => p_stripe_session_id,
    p_shipping_address => p_shipping_address);

  update public.checkouts set status = 'completed', order_id = v_order, closed_at = now() where id = v_c.id;
  if v_c.analytics_session_id is not null then
    perform public.track_purchase(v_c.analytics_session_id, v_order);
  end if;
  return v_order;
end $$;

-- Safety net for missed webhooks (hourly cron): release holds whose Stripe session can no longer be paid.
create or replace function public.checkout_release_expired()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.checkouts where status in ('open', 'awaiting_payment') and expires_at < now() loop
    if public.checkout_release(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'checkout_open(jsonb, text)', 'checkout_attach(uuid, text, timestamptz)', 'checkout_release(uuid, text)',
    'checkout_mark_awaiting(text)',
    'checkout_complete(text, uuid, numeric, numeric, numeric, numeric, timestamptz, text, jsonb)',
    'checkout_release_expired()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
