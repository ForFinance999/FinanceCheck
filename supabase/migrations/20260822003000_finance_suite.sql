-- Extended finance suite: historical FX, tags, merchants, debts and manually tracked assets.
alter table public.transactions add column if not exists currency text;
alter table public.transactions add column if not exists fx_rate_to_rub numeric;
alter table public.transactions add column if not exists merchant text;
alter table public.transactions add column if not exists tags text[] not null default '{}';
alter table public.transactions add column if not exists source text not null default 'manual';
alter table public.transactions add column if not exists external_id text;

create index if not exists transactions_merchant_idx on public.transactions (telegram_id, merchant);
create index if not exists transactions_tags_idx on public.transactions using gin (tags);
create unique index if not exists transactions_external_id_idx
  on public.transactions (telegram_id, external_id) where external_id is not null;

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  person text not null,
  direction text not null check (direction in ('owed_to_me','i_owe')),
  amount numeric not null check (amount > 0),
  currency text not null default 'RUB' check (currency in ('RUB','USD','CNY','USDT')),
  due_date date,
  note text,
  is_settled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists debts_user_idx on public.debts (telegram_id, is_settled, due_date);
alter table public.debts enable row level security;
drop policy if exists "prototype debts all" on public.debts;
create policy "prototype debts all" on public.debts for all to anon using (true) with check (true);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  name text not null,
  asset_type text not null check (asset_type in ('cash','crypto','stock','etf','gold','real_estate','vehicle','brokerage','other')),
  symbol text,
  quantity numeric not null default 1 check (quantity >= 0),
  purchase_price numeric,
  current_price numeric,
  currency text not null default 'RUB' check (currency in ('RUB','USD','CNY')),
  valuation_mode text not null default 'manual' check (valuation_mode in ('manual','live')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assets_user_idx on public.assets (telegram_id, asset_type);
alter table public.assets enable row level security;
drop policy if exists "prototype assets all" on public.assets;
create policy "prototype assets all" on public.assets for all to anon using (true) with check (true);

create table if not exists public.exchange_rates (
  rate_date date not null,
  base_currency text not null,
  quote_currency text not null,
  rate numeric not null check (rate > 0),
  source text not null,
  created_at timestamptz not null default now(),
  primary key (rate_date, base_currency, quote_currency)
);
alter table public.exchange_rates enable row level security;
drop policy if exists "public rates read" on public.exchange_rates;
create policy "public rates read" on public.exchange_rates for select to anon using (true);
