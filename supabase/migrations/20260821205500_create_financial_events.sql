create table if not exists public.financial_events (
  id uuid primary key default gen_random_uuid(), telegram_id bigint not null,
  title text not null, event_type text not null default 'other' check (event_type in ('salary','rent','credit','subscription','other')),
  amount numeric not null default 0 check (amount >= 0), currency text not null default 'RUB' check (currency in ('RUB','USD','CNY')),
  event_date date not null, recurrence text not null default 'none' check (recurrence in ('none','monthly','yearly')),
  note text, created_at timestamptz not null default now()
);
create index if not exists financial_events_user_date_idx on public.financial_events (telegram_id, event_date);
alter table public.financial_events enable row level security;
drop policy if exists "prototype events select" on public.financial_events;
drop policy if exists "prototype events insert" on public.financial_events;
drop policy if exists "prototype events update" on public.financial_events;
drop policy if exists "prototype events delete" on public.financial_events;
create policy "prototype events select" on public.financial_events for select to anon using (true);
create policy "prototype events insert" on public.financial_events for insert to anon with check (true);
create policy "prototype events update" on public.financial_events for update to anon using (true) with check (true);
create policy "prototype events delete" on public.financial_events for delete to anon using (true);
