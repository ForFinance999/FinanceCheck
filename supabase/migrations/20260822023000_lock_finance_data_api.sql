-- Financial data is accessible only through finance-api after Telegram initData verification.
begin;

revoke all privileges on table
  public.profiles,
  public.accounts,
  public.categories,
  public.transactions,
  public.deposits,
  public.financial_events,
  public.debts,
  public.assets,
  public.exchange_rates,
  public.category_rules,
  public.net_worth_snapshots
from anon, authenticated;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','accounts','categories','transactions','deposits',
        'financial_events','debts','assets','exchange_rates',
        'category_rules','net_worth_snapshots'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

alter table public.profiles force row level security;
alter table public.accounts force row level security;
alter table public.categories force row level security;
alter table public.transactions force row level security;
alter table public.deposits force row level security;
alter table public.financial_events force row level security;
alter table public.debts force row level security;
alter table public.assets force row level security;
alter table public.exchange_rates force row level security;
alter table public.category_rules force row level security;
alter table public.net_worth_snapshots force row level security;

commit;
