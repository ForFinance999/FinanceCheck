-- Explicit Data API grants for new Supabase projects.
grant usage on schema public to anon;
grant select, insert, update, delete on
  public.deposits,
  public.financial_events,
  public.debts,
  public.assets,
  public.category_rules,
  public.net_worth_snapshots
to anon;
grant select on public.exchange_rates to anon;
