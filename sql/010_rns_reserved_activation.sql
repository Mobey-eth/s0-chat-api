alter table stage0_rns.reserved_names
  add column if not exists primary_auction_id bigint,
  add column if not exists activation_tx_hash text,
  add column if not exists activated_at timestamptz;

create index if not exists idx_stage0_rns_reserved_names_primary_auction
  on stage0_rns.reserved_names(chain_id, primary_auction_id)
  where primary_auction_id is not null;
