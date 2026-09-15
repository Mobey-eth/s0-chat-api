-- Public chain receipts. Acknowledgement is a browser preference, not permission.
create table if not exists stage0_rns.registry_transfers (
  chain_id integer not null,
  registry text not null check (registry ~ '^0x[0-9a-f]{40}$'),
  node text not null check (node ~ '^0x[0-9a-f]{64}$'),
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number numeric(78, 0) not null,
  primary key (chain_id, registry, tx_hash, log_index)
);
create index if not exists idx_rns_registry_transfers_node
  on stage0_rns.registry_transfers (chain_id, registry, node, block_number desc, log_index desc);
