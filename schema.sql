-- CocoBiz Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor.
-- This is designed to mirror the main CocoBiz data domains.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  name text,
  category text,
  price numeric default 0,
  cost_price numeric default 0,
  stock integer default 0,
  description text,
  image text,
  images jsonb default '[]'::jsonb,
  return_policy text default 'no_return',
  dropshipping boolean default false,
  supplier_name text,
  supplier_mobile text,
  supplier_link text,
  supplier_cost numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.orders (
  id text primary key,
  customer_name text,
  customer_mobile text,
  customer_address text,
  items jsonb default '[]'::jsonb,
  subtotal numeric default 0,
  delivery_charge numeric default 0,
  platform_fee numeric default 0,
  coupon_code text,
  coupon_discount numeric default 0,
  total numeric default 0,
  payment_method text,
  payment_status text default 'pending',
  status text default 'pending',
  salesman_id text,
  tracking_id text,
  return_items jsonb default '[]'::jsonb,
  payment_history jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.customers (
  id text primary key,
  name text,
  mobile text unique,
  address text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.salesmen (
  id text primary key,
  name text,
  mobile text,
  email text,
  password_hash text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.offers (
  id text primary key,
  title text,
  description text,
  discount_text text,
  image text,
  start_at timestamptz,
  end_at timestamptz,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.coupons (
  id text primary key,
  code text unique,
  visibility text default 'public',
  private_customer_hashes jsonb default '[]'::jsonb,
  benefit text default 'product_discount',
  discount_type text default 'percent',
  value numeric default 0,
  min_order numeric default 0,
  max_discount numeric,
  total_uses integer,
  used_count integer default 0,
  uses_per_customer integer,
  usage_by_customer jsonb default '{}'::jsonb,
  expires_at timestamptz,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.store_settings (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.public_order_tracking (
  id text primary key,
  order_id text,
  tracking_data jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Enable RLS. The frontend should use Supabase Auth for admin/salesman identity.
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.customers enable row level security;
alter table public.salesmen enable row level security;
alter table public.offers enable row level security;
alter table public.coupons enable row level security;
alter table public.store_settings enable row level security;
alter table public.public_order_tracking enable row level security;

-- Public catalogue/tracking reads.
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select using (true);

drop policy if exists offers_public_read on public.offers;
create policy offers_public_read on public.offers for select using (active = true);

drop policy if exists coupons_public_read on public.coupons;
create policy coupons_public_read on public.coupons for select using (visibility = 'public' and active = true);

drop policy if exists tracking_public_read on public.public_order_tracking;
create policy tracking_public_read on public.public_order_tracking for select using (true);

-- Orders can be inserted by the storefront. Admin authorization should be tightened
-- with a custom claim/role before production launch.
drop policy if exists orders_public_insert on public.orders;
create policy orders_public_insert on public.orders for insert with check (true);

-- NOTE: Do not expose private customer/coupon fields to anonymous clients in production.
-- Admin policies should be added after Supabase Auth is configured.
