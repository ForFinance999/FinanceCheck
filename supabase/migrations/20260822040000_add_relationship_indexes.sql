-- Cover foreign-key lookups used by deletes and related finance queries.
create index if not exists transactions_account_fk_idx
  on public.transactions (account_id);
create index if not exists transactions_category_fk_idx
  on public.transactions (category_id)
  where category_id is not null;
create index if not exists transactions_destination_account_fk_idx
  on public.transactions (destination_account_id)
  where destination_account_id is not null;
create index if not exists transactions_original_transaction_fk_idx
  on public.transactions (original_transaction_id)
  where original_transaction_id is not null;
create index if not exists category_rules_category_fk_idx
  on public.category_rules (category_id)
  where category_id is not null;
