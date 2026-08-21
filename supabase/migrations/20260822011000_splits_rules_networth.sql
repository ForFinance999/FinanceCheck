-- Split transactions, linked refunds, categorization rules and net-worth history.
alter table public.transactions add column if not exists split_group uuid;
alter table public.transactions add column if not exists original_transaction_id uuid references public.transactions(id) on delete set null;
alter table public.transactions add column if not exists is_refund boolean not null default false;
create index if not exists transactions_split_group_idx on public.transactions (telegram_id, split_group);
create index if not exists transactions_original_idx on public.transactions (telegram_id, original_transaction_id);

create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  match_field text not null default 'text' check (match_field in ('text','merchant','note')),
  pattern text not null,
  category_id uuid references public.categories(id) on delete cascade,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists category_rules_user_idx on public.category_rules (telegram_id, priority, created_at);
alter table public.category_rules enable row level security;
drop policy if exists "prototype rules all" on public.category_rules;
create policy "prototype rules all" on public.category_rules for all to anon using (true) with check (true);

create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  snapshot_date date not null,
  accounts_rub numeric not null default 0,
  deposits_rub numeric not null default 0,
  assets_rub numeric not null default 0,
  debts_rub numeric not null default 0,
  net_worth_rub numeric not null,
  created_at timestamptz not null default now(),
  unique (telegram_id, snapshot_date)
);
create index if not exists net_worth_user_date_idx on public.net_worth_snapshots (telegram_id, snapshot_date);
alter table public.net_worth_snapshots enable row level security;
drop policy if exists "prototype net worth all" on public.net_worth_snapshots;
create policy "prototype net worth all" on public.net_worth_snapshots for all to anon using (true) with check (true);
