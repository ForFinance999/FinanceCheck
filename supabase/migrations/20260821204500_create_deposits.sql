-- Deposits for the Telegram Mini App. This migration is additive and preserves existing data.
create extension if not exists pgcrypto;

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  name text not null,
  bank_name text,
  principal numeric not null check (principal > 0),
  currency text not null default 'RUB' check (currency in ('RUB', 'USD', 'CNY')),
  annual_rate numeric not null check (annual_rate >= 0),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  capitalization text not null default 'end' check (capitalization in ('end', 'monthly', 'daily')),
  note text,
  created_at timestamptz not null default now()
);

alter table public.deposits add column if not exists currency text not null default 'RUB';
create index if not exists deposits_telegram_id_idx on public.deposits (telegram_id);
create index if not exists deposits_end_date_idx on public.deposits (telegram_id, end_date);
alter table public.deposits enable row level security;

-- DEVELOPMENT ONLY. Replace after Telegram initData is verified server-side.
drop policy if exists "prototype deposits select" on public.deposits;
drop policy if exists "prototype deposits insert" on public.deposits;
drop policy if exists "prototype deposits update" on public.deposits;
drop policy if exists "prototype deposits delete" on public.deposits;
create policy "prototype deposits select" on public.deposits for select to anon using (true);
create policy "prototype deposits insert" on public.deposits for insert to anon with check (true);
create policy "prototype deposits update" on public.deposits for update to anon using (true) with check (true);
create policy "prototype deposits delete" on public.deposits for delete to anon using (true);
