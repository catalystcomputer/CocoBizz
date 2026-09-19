create extension if not exists pgcrypto;

create table if not exists public.products (
 id text primary key, name text, category text, price numeric default 0, sale_price numeric default 0,
 cost_price numeric default 0, stock integer default 0, description text, image text, images jsonb default '[]'::jsonb,
 return_policy text default 'no_return', active boolean default true, dropshipping boolean default false,
 supplier_name text, supplier_mobile text, supplier_link text, supplier_cost numeric default 0,
 created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.orders (
 id text primary key, client_id text unique, customer jsonb default '{}'::jsonb, items jsonb default '[]'::jsonb,
 returns jsonb default '[]'::jsonb, subtotal numeric default 0, delivery_charge numeric default 0, platform_fee numeric default 0,
 coupon_code text, coupon_discount numeric default 0, total numeric default 0, original_total numeric default 0,
 returned_total numeric default 0, net_total numeric default 0, paid_amount numeric default 0, due_amount numeric default 0,
 payment_method text, payment_status text default 'pending', payment_history jsonb default '[]'::jsonb,
 status text default 'pending', salesman_id text, salesman_name text, salesman_number text, delivery_estimate text,
 delivery_distance_km numeric, mobile_hash text, utr text, payment_id text, source text, date text,
 created_at bigint, updated_at bigint
);
create table if not exists public.customers (
 id text primary key, name text, mobile text unique, address text, data jsonb default '{}'::jsonb,
 created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.users (
 id text primary key, name text, number text, email text, role text default 'admin', rates jsonb default '{}'::jsonb,
 active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.salesmen (
 id text primary key, name text, mobile text, email text, password_hash text, active boolean default true,
 created_at timestamptz default now()
);
create table if not exists public.public_salesmen (
 id text primary key, role text default 'salesman', rates jsonb default '{}'::jsonb, name text, number text,
 active boolean default true, updated_at timestamptz default now()
);
create table if not exists public.offers (
 id text primary key, title text, description text, discount_text text, image text, start_at bigint, end_at bigint,
 active boolean default true, created_at timestamptz default now(), updated_at bigint
);
create table if not exists public.coupons (
 id text primary key, code text unique, visibility text default 'public', private_customers jsonb default '[]'::jsonb,
 private_customer_hashes jsonb default '[]'::jsonb, benefit text default 'product_discount', type text default 'percent',
 value numeric default 0, min_order numeric default 0, max_discount numeric, usage_limit integer, usage_count integer default 0,
 uses_per_customer integer, usage_by_customer jsonb default '{}'::jsonb, expires_at bigint, valid_until bigint,
 active boolean default true, created_at timestamptz default now()
);
create table if not exists public.store_settings (
 id text primary key default 'main', data jsonb not null default '{}'::jsonb, updated_at bigint
);
create table if not exists public.public_order_tracking (
 id text primary key, order_id text, tracking_data jsonb default '{}'::jsonb, updated_at bigint
);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.customers enable row level security;
alter table public.users enable row level security;
alter table public.salesmen enable row level security;
alter table public.public_salesmen enable row level security;
alter table public.offers enable row level security;
alter table public.coupons enable row level security;
alter table public.store_settings enable row level security;
alter table public.public_order_tracking enable row level security;

-- TEMPORARY MIGRATION POLICIES: the current app still uses Firebase Auth for login,
-- so Supabase cannot evaluate the Firebase user's identity in auth.uid().
-- Replace these with Supabase Auth/RLS policies before production.
do $$ declare t text; begin
  foreach t in array array['products','orders','customers','users','salesmen','public_salesmen','offers','coupons','store_settings','public_order_tracking'] loop
    execute format('drop policy if exists cocobiz_migration_all on public.%I', t);
    execute format('create policy cocobiz_migration_all on public.%I for all using (true) with check (true)', t);
  end loop;
end $$;

grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
