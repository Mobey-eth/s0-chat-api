create table if not exists stage0_rns.primary_auctions (
  chain_id integer not null,
  auction_id bigint not null,
  name text not null,
  fqdn text not null,
  duration bigint not null,
  reserve_price numeric(78, 0) not null default 0,
  start_time bigint not null,
  end_time bigint not null,
  current_extension_window bigint,
  bid_count integer not null default 0,
  highest_bidder text,
  highest_bid numeric(78, 0) not null default 0,
  status text not null default 'scheduled',
  winner text,
  settled_amount numeric(78, 0),
  created_tx_hash text,
  created_block bigint,
  created_at timestamptz,
  updated_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, auction_id)
);

create index if not exists idx_stage0_rns_primary_auctions_status
  on stage0_rns.primary_auctions(chain_id, status, end_time);

create index if not exists idx_stage0_rns_primary_auctions_name
  on stage0_rns.primary_auctions(chain_id, name);

create table if not exists stage0_rns.marketplace_listings (
  chain_id integer not null,
  listing_id bigint not null,
  node text not null,
  name text not null,
  fqdn text not null,
  seller text not null,
  price numeric(78, 0) not null,
  status text not null default 'active',
  buyer text,
  purchased_price numeric(78, 0),
  created_tx_hash text,
  created_block bigint,
  created_at timestamptz,
  updated_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, listing_id)
);

create index if not exists idx_stage0_rns_marketplace_listings_status
  on stage0_rns.marketplace_listings(chain_id, status, listing_id desc);

create index if not exists idx_stage0_rns_marketplace_listings_seller
  on stage0_rns.marketplace_listings(chain_id, seller);

create index if not exists idx_stage0_rns_marketplace_listings_node
  on stage0_rns.marketplace_listings(chain_id, node);

create table if not exists stage0_rns.marketplace_auctions (
  chain_id integer not null,
  auction_id bigint not null,
  node text not null,
  name text not null,
  fqdn text not null,
  seller text not null,
  reserve_price numeric(78, 0) not null default 0,
  start_time bigint not null,
  end_time bigint not null,
  current_extension_window bigint,
  bid_count integer not null default 0,
  highest_bidder text,
  highest_bid numeric(78, 0) not null default 0,
  status text not null default 'scheduled',
  winner text,
  settled_amount numeric(78, 0),
  created_tx_hash text,
  created_block bigint,
  created_at timestamptz,
  updated_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, auction_id)
);

create index if not exists idx_stage0_rns_marketplace_auctions_status
  on stage0_rns.marketplace_auctions(chain_id, status, end_time);

create index if not exists idx_stage0_rns_marketplace_auctions_seller
  on stage0_rns.marketplace_auctions(chain_id, seller);

create index if not exists idx_stage0_rns_marketplace_auctions_node
  on stage0_rns.marketplace_auctions(chain_id, node);

create table if not exists stage0_rns.marketplace_events (
  id bigserial primary key,
  chain_id integer not null,
  source text not null,
  entity_type text not null,
  event_type text not null,
  entity_id bigint,
  name text,
  account text,
  counterparty text,
  amount numeric(78, 0),
  tx_hash text not null,
  block_number bigint not null,
  log_index integer not null,
  block_time timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (chain_id, source, tx_hash, log_index)
);

create index if not exists idx_stage0_rns_marketplace_events_entity
  on stage0_rns.marketplace_events(chain_id, source, entity_type, entity_id);

create index if not exists idx_stage0_rns_marketplace_events_recent
  on stage0_rns.marketplace_events(chain_id, block_number desc, log_index desc);
