create schema if not exists stage0_rns;

create table if not exists stage0_rns.sync_state (
  job_name text not null,
  chain_id integer not null,
  contract_address text not null,
  last_processed_block bigint not null default 0,
  last_processed_block_hash text,
  last_processed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (job_name, chain_id)
);

create table if not exists stage0_rns.names (
  chain_id integer not null,
  node text not null,
  label text,
  fqdn text,
  registrant text not null default '0x0000000000000000000000000000000000000000',
  owner text not null default '0x0000000000000000000000000000000000000000',
  expiry bigint not null default 0,
  resolver text,
  resolved_address text,
  registered_tx_hash text,
  registered_block bigint,
  registered_at timestamptz,
  renewed_tx_hash text,
  renewed_block bigint,
  renewed_at timestamptz,
  released_tx_hash text,
  released_block bigint,
  released_at timestamptz,
  updated_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, node)
);

create index if not exists idx_stage0_rns_names_owner
  on stage0_rns.names(chain_id, owner);

create index if not exists idx_stage0_rns_names_registrant
  on stage0_rns.names(chain_id, registrant);

create index if not exists idx_stage0_rns_names_label
  on stage0_rns.names(chain_id, label);

create index if not exists idx_stage0_rns_names_fqdn
  on stage0_rns.names(chain_id, fqdn);

create index if not exists idx_stage0_rns_names_released
  on stage0_rns.names(chain_id, released_at);

create index if not exists idx_stage0_rns_names_expiry
  on stage0_rns.names(chain_id, expiry);
