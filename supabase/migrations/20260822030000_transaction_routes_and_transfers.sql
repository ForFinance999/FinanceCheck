alter table public.transactions add column if not exists from_name text;
alter table public.transactions add column if not exists to_name text;
alter table public.transactions add column if not exists destination_account_id uuid references public.accounts(id) on delete restrict;

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type in ('income','expense','transfer'));
alter table public.transactions drop constraint if exists transactions_transfer_accounts_check;
alter table public.transactions add constraint transactions_transfer_accounts_check check (
  type <> 'transfer' or (destination_account_id is not null and destination_account_id <> account_id)
);

create index if not exists transactions_destination_account_idx
  on public.transactions (telegram_id, destination_account_id, transaction_date desc)
  where destination_account_id is not null;
