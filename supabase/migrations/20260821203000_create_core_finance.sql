-- Core tables required by the Telegram finance application.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  telegram_id bigint primary key,
  first_name text,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  name text not null,
  currency text not null default 'RUB'
    check (currency in ('RUB','USD','CNY','BTC','ETH','USDT','TRX')),
  initial_balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  name text not null,
  emoji text,
  type text not null check (type in ('income','expense')),
  created_at timestamptz not null default now(),
  unique (telegram_id, type, name)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income','expense')),
  amount numeric not null check (amount > 0),
  note text,
  transaction_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists accounts_user_idx on public.accounts (telegram_id, created_at);
create index if not exists categories_user_idx on public.categories (telegram_id, type, created_at);
create index if not exists transactions_user_date_idx on public.transactions (telegram_id, transaction_date desc);

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "prototype profiles all" on public.profiles;
drop policy if exists "prototype accounts all" on public.accounts;
drop policy if exists "prototype categories all" on public.categories;
drop policy if exists "prototype transactions all" on public.transactions;
create policy "prototype profiles all" on public.profiles for all to anon using (true) with check (true);
create policy "prototype accounts all" on public.accounts for all to anon using (true) with check (true);
create policy "prototype categories all" on public.categories for all to anon using (true) with check (true);
create policy "prototype transactions all" on public.transactions for all to anon using (true) with check (true);

-- New Supabase projects may not expose SQL-created tables automatically.
grant usage on schema public to anon;
grant select, insert, update, delete on public.profiles to anon;
grant select, insert, update, delete on public.accounts to anon;
grant select, insert, update, delete on public.categories to anon;
grant select, insert, update, delete on public.transactions to anon;
