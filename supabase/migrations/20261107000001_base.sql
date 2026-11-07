-- PAKZ base commerce schema: catalog, customers, orders, offers, drops, sell requests, settings, audit.
-- All money columns are numeric(12,2) in the store currency (store_settings.currency).

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Users & roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'customer' check (role in ('owner', 'staff', 'customer')),
  created_at  timestamptz not null default now()
);

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_name() in ('owner', 'staff');
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role_name() = 'owner';
$$;

-- Create a profile row for every new auth user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.categories (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  slug  text not null unique
);

create table public.brands (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique,
  slug  text not null unique
);

create table public.drops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  status      text not null default 'draft' check (status in ('draft', 'scheduled', 'live', 'ended')),
  created_at  timestamptz not null default now()
);

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  slug                text not null unique,
  description         text,
  category_id         uuid references public.categories (id) on delete set null,
  brand_id            uuid references public.brands (id) on delete set null,
  status              text not null default 'draft'
                        check (status in ('draft', 'scheduled', 'active', 'sold', 'archived')),
  tags                text[] not null default '{}',
  featured            boolean not null default false,
  allow_offers        boolean not null default false,
  offer_floor_price   numeric(12,2),           -- offers below this are auto-declined
  seo_title           text,
  seo_description     text,
  authenticity_notes  text,
  publish_at          timestamptz,             -- scheduled publish
  drop_id             uuid references public.drops (id) on delete set null,
  listed_at           timestamptz,             -- first time it went active (drives aging / days-to-sell)
  sold_at             timestamptz,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index products_status_idx on public.products (status);
create index products_category_idx on public.products (category_id);
create index products_brand_idx on public.products (brand_id);
create index products_title_trgm on public.products using gin (title gin_trgm_ops);

create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  path        text not null,                  -- storage path in the "product-images" bucket
  position    int not null default 0,
  is_cover    boolean not null default false,
  width       int,
  height      int,
  created_at  timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Stamp listed_at / sold_at / archived_at on status transitions.
create or replace function public.products_status_stamps() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.listed_at is null then new.listed_at := now(); end if;
  if new.status = 'sold' and (tg_op = 'INSERT' or old.status <> 'sold') then new.sold_at := coalesce(new.sold_at, now()); end if;
  if new.status <> 'sold' then new.sold_at := null; end if;
  if new.status = 'archived' and (tg_op = 'INSERT' or old.status <> 'archived') then new.archived_at := now(); end if;
  return new;
end $$;

create trigger products_status_stamps before insert or update of status on public.products
  for each row execute function public.products_status_stamps();

-- ---------------------------------------------------------------------------
-- Customers & orders
-- ---------------------------------------------------------------------------
create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users (id) on delete set null,
  email             text unique,
  name              text,
  phone             text,
  instagram_handle  text,
  marketing_opt_in  boolean not null default false,
  created_at        timestamptz not null default now()
);

create sequence public.order_number_seq start 1001;

create table public.orders (
  id                        uuid primary key default gen_random_uuid(),
  number                    bigint not null unique default nextval('public.order_number_seq'),
  customer_id               uuid references public.customers (id) on delete set null,
  channel                   text not null default 'web'
                              check (channel in ('web', 'in_person', 'instagram', 'vinted', 'ebay', 'depop', 'other')),
  status                    text not null default 'pending'
                              check (status in ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded', 'partially_refunded')),
  subtotal                  numeric(12,2) not null default 0,   -- sum of line totals
  discount                  numeric(12,2) not null default 0,
  shipping_charged          numeric(12,2) not null default 0,   -- what the customer paid for shipping
  tax                       numeric(12,2) not null default 0,
  total                     numeric(12,2) not null default 0,
  payment_fees              numeric(12,2) not null default 0,   -- Stripe / marketplace fees
  shipping_cost             numeric(12,2) not null default 0,   -- what the label actually cost us
  refunded_amount           numeric(12,2) not null default 0,
  currency                  text not null default 'GBP',
  stripe_payment_intent_id  text unique,
  stripe_checkout_session_id text unique,
  shipping_address          jsonb,
  carrier                   text,
  tracking_number           text,
  shipped_at                timestamptz,
  delivered_at              timestamptz,
  paid_at                   timestamptz,
  session_id                text,           -- analytics session that converted
  external_ref              text,           -- marketplace order id for offline sales
  note                      text,
  created_at                timestamptz not null default now()
);
create index orders_paid_at_idx on public.orders (paid_at);
create index orders_status_idx on public.orders (status);
create index orders_customer_idx on public.orders (customer_id);

create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  product_id    uuid references public.products (id) on delete set null,
  variant_id    uuid,                         -- FK added in inventory migration
  title         text not null,                -- snapshot
  size          text,
  condition     text,
  quantity      int not null check (quantity > 0),
  unit_price    numeric(12,2) not null,
  unit_cost     numeric(12,2) not null default 0,   -- cost basis snapshot at sale time
  refunded_qty  int not null default 0 check (refunded_qty >= 0)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

create table public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  type        text not null,      -- created | paid | shipped | email_sent | refund | note | status
  message     text,
  data        jsonb,
  admin_id    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  amount            numeric(12,2) not null check (amount > 0),
  reason            text,
  items             jsonb not null default '[]',   -- [{order_item_id, quantity}]
  restocked         boolean not null default false,
  stripe_refund_id  text,
  admin_id          uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Offers, raffles, sell-to-us, waitlist
-- ---------------------------------------------------------------------------
create table public.offers (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  variant_id      uuid,
  customer_id     uuid references public.customers (id) on delete set null,
  email           text not null,
  amount          numeric(12,2) not null check (amount > 0),
  counter_amount  numeric(12,2),
  message         text,
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'declined', 'countered', 'expired', 'auto_declined')),
  responded_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index offers_status_idx on public.offers (status, created_at);

-- Auto-decline offers under the product's floor price.
create or replace function public.offers_auto_decline() returns trigger language plpgsql as $$
declare v_floor numeric;
begin
  select offer_floor_price into v_floor from public.products where id = new.product_id;
  if v_floor is not null and new.amount < v_floor then
    new.status := 'auto_declined';
    new.responded_at := now();
  end if;
  return new;
end $$;
create trigger offers_auto_decline before insert on public.offers
  for each row execute function public.offers_auto_decline();

create table public.raffles (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  product_id       uuid references public.products (id) on delete set null,
  drop_id          uuid references public.drops (id) on delete set null,
  starts_at        timestamptz,
  ends_at          timestamptz,
  status           text not null default 'draft' check (status in ('draft', 'open', 'closed', 'drawn')),
  winner_entry_id  uuid,
  created_at       timestamptz not null default now()
);

create table public.raffle_entries (
  id           uuid primary key default gen_random_uuid(),
  raffle_id    uuid not null references public.raffles (id) on delete cascade,
  customer_id  uuid references public.customers (id) on delete set null,
  email        text not null,
  size         text,
  is_winner    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (raffle_id, email)
);

create table public.sell_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  brand         text,
  item          text not null,
  size          text,
  condition     text,
  asking_price  numeric(12,2),
  offer_price   numeric(12,2),
  images        text[] not null default '{}',
  status        text not null default 'new'
                  check (status in ('new', 'reviewing', 'offer_sent', 'accepted', 'rejected', 'completed')),
  notes         text,
  created_at    timestamptz not null default now()
);
create index sell_requests_status_idx on public.sell_requests (status, created_at);

create table public.waitlist (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid references public.products (id) on delete cascade,
  variant_id   uuid,
  brand        text,
  category     text,
  size         text,
  keyword      text,
  email        text not null,
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index waitlist_created_idx on public.waitlist (created_at);

-- ---------------------------------------------------------------------------
-- Expenses, purchase tasks
-- ---------------------------------------------------------------------------
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  category     text not null default 'other'
                 check (category in ('packaging', 'ads', 'subscriptions', 'shipping_supplies', 'fees', 'software', 'travel', 'other')),
  description  text,
  amount       numeric(12,2) not null check (amount >= 0),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (date);

create table public.purchase_tasks (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  notes              text,
  recommendation_id  uuid,
  status             text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_date           date,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings, audit log, notifications
-- ---------------------------------------------------------------------------
create table public.store_settings (
  id                   int primary key default 1 check (id = 1),
  store_name           text not null default 'PAKZ',
  contact_email        text,
  currency             text not null default 'GBP',
  timezone             text not null default 'Europe/London',
  shipping_rates       jsonb not null default '[{"name":"Standard","price":4.99,"free_over":150},{"name":"Express","price":9.99}]',
  vat_registered       boolean not null default false,
  vat_rate             numeric(5,2) not null default 20,
  prices_include_vat   boolean not null default true,
  vat_scheme           text not null default 'standard' check (vat_scheme in ('standard', 'margin')),
  email_from           text,
  report_recipients    text[] not null default '{}',
  report_weekly        boolean not null default true,
  report_monthly       boolean not null default true,
  alerts               jsonb not null default '{"low_stock":true,"big_order_threshold":300,"offer_received":true,"traffic_spike_pct":100}',
  low_stock_default    int not null default 1,
  updated_at           timestamptz not null default now()
);
insert into public.store_settings (id) values (1);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  admin_email text,
  action      text not null,       -- e.g. product.update, stock.adjust, order.refund
  entity      text,
  entity_id   text,
  diff        jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

create table public.notifications (
  id          bigint generated always as identity primary key,
  type        text not null,       -- low_stock | big_order | offer_received | traffic_spike | sell_request
  title       text not null,
  body        text,
  data        jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_unread_idx on public.notifications (created_at desc) where read_at is null;
