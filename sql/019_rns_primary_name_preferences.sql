create table if not exists stage0_rns.primary_name_preferences (
  chain_id integer not null,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  node text not null check (node ~ '^0x[0-9a-f]{64}$'),
  label text not null,
  version bigint not null check (version > 0),
  selected_block numeric(78, 0) not null,
  registered_block numeric(78, 0) not null,
  invalidated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (chain_id, address)
);

create index if not exists idx_rns_primary_preferences_node
  on stage0_rns.primary_name_preferences (chain_id, node);

comment on table stage0_rns.primary_name_preferences is
  'Wallet-signed API primary choices. Versions are retained to prevent signature replay; registry ownership remains authoritative.';
