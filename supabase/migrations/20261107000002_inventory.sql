-- Multi-quantity inventory: variants, append-only movement ledger, cost basis, sales & refunds.
--
-- Invariant: product_variants.quantity / reserved_quantity only change via an inventory_movements
-- insert. A guard trigger rejects direct updates, so every stock change has an audit row.

create table public.product_variants (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products (id) on delete cascade,
  size                 text,
  condition            text not null default 'new'
                         check (condition in ('new', 'new_defects', 'used_excellent', 'used_good', 'used_fair')),
  sku                  text unique,
  price                numeric(12,2) not null check (price >= 0),
  cost_price           numeric(12,2) not null default 0,   -- weighted-average landed unit cost
  quantity             int not null default 0 check (quantity >= 0),          -- available to sell
  reserved_quantity    int not null default 0 check (reserved_quantity >= 0), -- held in carts / raffles / offers
  low_stock_threshold  int not null default 1,
  status               text not null default 'active' check (status in ('active', 'sold_out', 'hidden', 'archived')),
  position             int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index product_variants_product_idx on public.product_variants (product_id);
create unique index product_variants_combo_idx on public.product_variants (product_id, coalesce(size, ''), condition);

create trigger product_variants_touch before update on public.product_variants
  for each row execute function public.touch_updated_at();

alter table public.order_items
  add constraint order_items_variant_fk foreign key (variant_id) references public.product_variants (id) on delete set null;
alter table public.offers
  add constraint offers_variant_fk foreign key (variant_id) references public.product_variants (id) on delete set null;
alter table public.waitlist
  add constraint waitlist_variant_fk foreign key (variant_id) references public.product_variants (id) on delete set null;
create index order_items_variant_idx on public.order_items (variant_id);

create table public.inventory_movements (
  id              bigint generated always as identity primary key,
  variant_id      uuid not null references public.product_variants (id) on delete cascade,
  change          int not null check (change <> 0),
  reason          text not null check (reason in ('purchase_in', 'sale', 'return', 'adjustment', 'damaged', 'reserved', 'released')),
  note            text,
  quantity_after  int,
  order_id        uuid references public.orders (id) on delete set null,
  admin_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);
create index inventory_movements_created_idx on public.inventory_movements (created_at);

create table public.product_costs (
  id               uuid primary key default gen_random_uuid(),
  variant_id       uuid not null references public.product_variants (id) on delete cascade,
  quantity         int not null default 1 check (quantity > 0),
  purchase_price   numeric(12,2) not null check (purchase_price >= 0),   -- per unit
  purchase_source  text not null default 'retail' check (purchase_source in ('retail', 'resale', 'consignment', 'private')),
  fees             numeric(12,2) not null default 0,                     -- total for the lot
  shipping_in      numeric(12,2) not null default 0,                     -- total for the lot
  acquired_at      timestamptz not null default now(),
  note             text,
  admin_id         uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index product_costs_variant_idx on public.product_costs (variant_id);

create table public.price_history (
  id          bigint generated always as identity primary key,
  variant_id  uuid not null references public.product_variants (id) on delete cascade,
  old_price   numeric(12,2),
  new_price   numeric(12,2) not null,
  changed_at  timestamptz not null default now()
);
create index price_history_variant_idx on public.price_history (variant_id, changed_at);

-- ---------------------------------------------------------------------------
-- Ledger application
-- ---------------------------------------------------------------------------
create or replace function public.variants_guard_quantity() returns trigger language plpgsql as $$
begin
  if (new.quantity is distinct from old.quantity or new.reserved_quantity is distinct from old.reserved_quantity)
     and coalesce(current_setting('pakz.applying_movement', true), '') <> '1' then
    raise exception 'Stock must be changed through inventory_movements (adjust_stock / receive_stock)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger product_variants_guard before update on public.product_variants
  for each row execute function public.variants_guard_quantity();

create or replace function public.variants_guard_insert() returns trigger language plpgsql as $$
begin
  if (new.quantity <> 0 or new.reserved_quantity <> 0)
     and coalesce(current_setting('pakz.applying_movement', true), '') <> '1' then
    raise exception 'Create variants with quantity 0, then receive_stock' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger product_variants_guard_insert before insert on public.product_variants
  for each row execute function public.variants_guard_insert();

-- Apply a movement to its variant, stamp quantity_after, and keep variant/product status in sync.
create or replace function public.apply_inventory_movement() returns trigger language plpgsql as $$
declare
  v_qty int;
  v_reserved int;
begin
  select quantity, reserved_quantity into v_qty, v_reserved
  from public.product_variants where id = new.variant_id for update;
  if not found then raise exception 'Variant % not found', new.variant_id; end if;

  if new.reason = 'reserved' then
    if new.change > 0 then raise exception 'reserved movements must be negative'; end if;
    v_qty := v_qty + new.change;
    v_reserved := v_reserved - new.change;
  elsif new.reason = 'released' then
    if new.change < 0 then raise exception 'released movements must be positive'; end if;
    if new.change > v_reserved then raise exception 'Cannot release more than is reserved (% reserved)', v_reserved; end if;
    v_qty := v_qty + new.change;
    v_reserved := v_reserved - new.change;
  else
    v_qty := v_qty + new.change;
  end if;

  if v_qty < 0 then
    raise exception 'Insufficient stock: change % would leave % units', new.change, v_qty using errcode = 'P0001';
  end if;

  perform set_config('pakz.applying_movement', '1', true);
  update public.product_variants
     set quantity = v_qty,
         reserved_quantity = v_reserved,
         status = case
                    when status in ('hidden', 'archived') then status
                    when v_qty = 0 then 'sold_out'
                    else 'active'
                  end
   where id = new.variant_id;
  perform set_config('pakz.applying_movement', '', true);

  new.quantity_after := v_qty;
  return new;
end $$;
create trigger inventory_movements_apply before insert on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

create or replace function public.inventory_movements_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'inventory_movements is append-only';
end $$;
create trigger inventory_movements_no_update before update or delete on public.inventory_movements
  for each row execute function public.inventory_movements_immutable();

-- When every variant of an active product is out of stock (and nothing reserved), mark the product sold;
-- when stock comes back to a sold product, reactivate it.
create or replace function public.sync_product_sold_status() returns trigger language plpgsql as $$
declare v_total int; v_reserved int; v_status text;
begin
  select coalesce(sum(quantity), 0), coalesce(sum(reserved_quantity), 0) into v_total, v_reserved
  from public.product_variants where product_id = new.product_id and status <> 'archived';
  select status into v_status from public.products where id = new.product_id;
  if v_total = 0 and v_reserved = 0 and v_status = 'active' then
    update public.products set status = 'sold' where id = new.product_id;
  elsif v_total > 0 and v_status = 'sold' then
    update public.products set status = 'active' where id = new.product_id;
  end if;
  return new;
end $$;
create trigger product_variants_sync_product after update of quantity, reserved_quantity on public.product_variants
  for each row execute function public.sync_product_sold_status();

create or replace function public.record_price_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.price_history (variant_id, old_price, new_price) values (new.id, null, new.price);
  elsif new.price is distinct from old.price then
    insert into public.price_history (variant_id, old_price, new_price) values (new.id, old.price, new.price);
  end if;
  return new;
end $$;
create trigger product_variants_price_history after insert or update of price on public.product_variants
  for each row execute function public.record_price_change();

-- ---------------------------------------------------------------------------
-- RPCs (service role only — the app layer authorises the admin first and passes admin_id)
-- ---------------------------------------------------------------------------

-- Manual adjustment. Reason is required and must be a non-sale reason.
create or replace function public.adjust_stock(
  p_variant_id uuid, p_change int, p_reason text, p_note text, p_admin_id uuid
) returns int language plpgsql security definer set search_path = public as $$
declare v_after int;
begin
  if p_reason not in ('adjustment', 'damaged', 'return', 'reserved', 'released', 'purchase_in') then
    raise exception 'Invalid adjustment reason %', p_reason;
  end if;
  if p_reason = 'adjustment' and coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required for manual adjustments';
  end if;
  if p_reason = 'damaged' and p_change > 0 then
    raise exception 'Damaged write-offs must be negative';
  end if;
  insert into public.inventory_movements (variant_id, change, reason, note, admin_id)
  values (p_variant_id, p_change, p_reason, p_note, p_admin_id)
  returning quantity_after into v_after;
  return v_after;
end $$;

-- Receive stock: logs the purchase lot, moves weighted-average cost, increments quantity.
-- new_avg = (on_hand * old_avg + qty * unit + fees + shipping_in) / (on_hand + qty)
create or replace function public.receive_stock(
  p_variant_id uuid, p_quantity int, p_unit_cost numeric, p_source text,
  p_fees numeric default 0, p_shipping_in numeric default 0,
  p_acquired_at timestamptz default now(), p_note text default null, p_admin_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on_hand int; v_old_cost numeric; v_new_cost numeric; v_after int;
begin
  if p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  select quantity + reserved_quantity, cost_price into v_on_hand, v_old_cost
  from public.product_variants where id = p_variant_id for update;
  if not found then raise exception 'Variant not found'; end if;

  v_new_cost := round(
    (v_on_hand * v_old_cost + p_quantity * p_unit_cost + coalesce(p_fees, 0) + coalesce(p_shipping_in, 0))
    / (v_on_hand + p_quantity), 2);

  insert into public.product_costs (variant_id, quantity, purchase_price, purchase_source, fees, shipping_in, acquired_at, note, admin_id)
  values (p_variant_id, p_quantity, p_unit_cost, p_source, coalesce(p_fees, 0), coalesce(p_shipping_in, 0), coalesce(p_acquired_at, now()), p_note, p_admin_id);

  update public.product_variants set cost_price = v_new_cost where id = p_variant_id;

  insert into public.inventory_movements (variant_id, change, reason, note, admin_id)
  values (p_variant_id, p_quantity, 'purchase_in', p_note, p_admin_id)
  returning quantity_after into v_after;

  return jsonb_build_object('quantity', v_after, 'cost_price', v_new_cost, 'previous_cost', v_old_cost);
end $$;

-- Record a sale in any channel. Items: [{variant_id, quantity, unit_price?, from_reserved?}]
-- Returns the order id. Used by the Stripe webhook (channel 'web') and manual sale entry.
create or replace function public.record_sale(
  p_channel text,
  p_items jsonb,
  p_customer_id uuid default null,
  p_shipping_charged numeric default 0,
  p_shipping_cost numeric default 0,
  p_payment_fees numeric default 0,
  p_tax numeric default 0,
  p_discount numeric default 0,
  p_paid_at timestamptz default now(),
  p_session_id text default null,
  p_external_ref text default null,
  p_note text default null,
  p_stripe_payment_intent_id text default null,
  p_stripe_checkout_session_id text default null,
  p_shipping_address jsonb default null,
  p_admin_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_variant record;
  v_qty int;
  v_price numeric;
  v_subtotal numeric := 0;
begin
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'A sale needs at least one item'; end if;

  insert into public.orders (customer_id, channel, status, paid_at, session_id, external_ref, note,
                             stripe_payment_intent_id, stripe_checkout_session_id, shipping_address,
                             shipping_charged, shipping_cost, payment_fees, tax, discount)
  values (p_customer_id, p_channel, 'paid', coalesce(p_paid_at, now()), p_session_id, p_external_ref, p_note,
          p_stripe_payment_intent_id, p_stripe_checkout_session_id, p_shipping_address,
          coalesce(p_shipping_charged, 0), coalesce(p_shipping_cost, 0), coalesce(p_payment_fees, 0),
          coalesce(p_tax, 0), coalesce(p_discount, 0))
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::int, 1);
    select v.*, p.title as product_title into v_variant
    from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = (v_item ->> 'variant_id')::uuid;
    if not found then raise exception 'Variant % not found', v_item ->> 'variant_id'; end if;

    v_price := coalesce((v_item ->> 'unit_price')::numeric, v_variant.price);

    insert into public.order_items (order_id, product_id, variant_id, title, size, condition, quantity, unit_price, unit_cost)
    values (v_order_id, v_variant.product_id, v_variant.id, v_variant.product_title, v_variant.size,
            v_variant.condition, v_qty, v_price, v_variant.cost_price);

    if coalesce((v_item ->> 'from_reserved')::boolean, false) then
      insert into public.inventory_movements (variant_id, change, reason, note, order_id, admin_id)
      values (v_variant.id, v_qty, 'released', 'released for sale', v_order_id, p_admin_id);
    end if;
    insert into public.inventory_movements (variant_id, change, reason, order_id, admin_id)
    values (v_variant.id, -v_qty, 'sale', v_order_id, p_admin_id);

    v_subtotal := v_subtotal + v_qty * v_price;
  end loop;

  update public.orders
     set subtotal = v_subtotal,
         total = v_subtotal - coalesce(p_discount, 0) + coalesce(p_shipping_charged, 0)
   where id = v_order_id;

  insert into public.order_events (order_id, type, message, admin_id)
  values (v_order_id, 'paid', format('Sale recorded (%s)', p_channel), p_admin_id);

  return v_order_id;
end $$;

-- Refund (full or partial). Items: [{order_item_id, quantity}] — restocks those units when p_restock.
create or replace function public.record_refund(
  p_order_id uuid, p_amount numeric, p_items jsonb, p_restock boolean,
  p_reason text default null, p_stripe_refund_id text default null, p_admin_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_refund_id uuid;
  v_order record;
  v_item jsonb;
  v_line record;
  v_qty int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.refunded_amount + p_amount > v_order.total + 0.005 then
    raise exception 'Refund exceeds order total (% already refunded of %)', v_order.refunded_amount, v_order.total;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_qty := (v_item ->> 'quantity')::int;
    select * into v_line from public.order_items
     where id = (v_item ->> 'order_item_id')::uuid and order_id = p_order_id for update;
    if not found then raise exception 'Order item not found'; end if;
    if v_qty <= 0 or v_line.refunded_qty + v_qty > v_line.quantity then
      raise exception 'Invalid refund quantity for %', v_line.title;
    end if;
    update public.order_items set refunded_qty = refunded_qty + v_qty where id = v_line.id;
    if p_restock and v_line.variant_id is not null then
      insert into public.inventory_movements (variant_id, change, reason, note, order_id, admin_id)
      values (v_line.variant_id, v_qty, 'return', coalesce(p_reason, 'refund'), p_order_id, p_admin_id);
    end if;
  end loop;

  insert into public.refunds (order_id, amount, reason, items, restocked, stripe_refund_id, admin_id)
  values (p_order_id, p_amount, p_reason, coalesce(p_items, '[]'), p_restock, p_stripe_refund_id, p_admin_id)
  returning id into v_refund_id;

  update public.orders
     set refunded_amount = refunded_amount + p_amount,
         status = case when refunded_amount + p_amount >= total - 0.005 then 'refunded' else 'partially_refunded' end
   where id = p_order_id;

  insert into public.order_events (order_id, type, message, data, admin_id)
  values (p_order_id, 'refund', format('Refunded %s', p_amount),
          jsonb_build_object('refund_id', v_refund_id, 'restocked', p_restock), p_admin_id);

  return v_refund_id;
end $$;

-- Storefront-safe view: never exposes cost_price.
create view public.storefront_variants as
  select v.id, v.product_id, v.size, v.condition, v.sku, v.price, v.quantity, v.status, v.position
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where p.status in ('active', 'sold') and v.status in ('active', 'sold_out');
