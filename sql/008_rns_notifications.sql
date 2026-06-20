create table if not exists stage0_rns.notification_subscriptions (
  id bigserial primary key,
  chain_id integer not null,
  scope text not null check (scope in ('marketplace_seller', 'marketplace_bidder')),
  email text not null,
  email_normalized text not null,
  wallet text,
  wallet_normalized text not null default '',
  node text,
  node_normalized text not null default '',
  name text,
  auction_id bigint not null default 0,
  listing_id bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, scope, email_normalized, wallet_normalized, node_normalized, auction_id, listing_id)
);

create index if not exists idx_stage0_rns_notification_subscriptions_scope_node
  on stage0_rns.notification_subscriptions(chain_id, scope, node_normalized);

create index if not exists idx_stage0_rns_notification_subscriptions_scope_auction
  on stage0_rns.notification_subscriptions(chain_id, scope, auction_id);

create table if not exists stage0_rns.notification_dispatches (
  id bigserial primary key,
  channel text not null check (channel in ('email', 'admin_slack')),
  dispatch_key text not null unique,
  subscription_id bigint references stage0_rns.notification_subscriptions(id) on delete cascade,
  event_source text not null,
  event_type text not null,
  tx_hash text,
  log_index integer,
  detail jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

