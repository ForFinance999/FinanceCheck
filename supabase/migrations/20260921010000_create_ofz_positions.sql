create table if not exists public.ofz_positions (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  secid text not null,
  short_name text not null,
  full_name text,
  quantity integer not null check (quantity > 0),
  invested_amount numeric not null check (invested_amount > 0),
  purchase_price_percent numeric not null check (purchase_price_percent > 0),
  current_price_percent numeric not null check (current_price_percent > 0),
  face_value numeric not null default 1000 check (face_value > 0),
  face_currency text not null default 'RUB',
  accrued_interest numeric not null default 0,
  coupon_value numeric not null default 0,
  coupon_percent numeric,
  next_coupon_date date,
  maturity_date date,
  yield_percent numeric,
  broker text,
  purchase_date date not null default current_date,
  quote_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ofz_positions_user_idx on public.ofz_positions (telegram_id, created_at desc);
alter table public.ofz_positions enable row level security;
alter table public.ofz_positions force row level security;
revoke all on table public.ofz_positions from anon, authenticated;
