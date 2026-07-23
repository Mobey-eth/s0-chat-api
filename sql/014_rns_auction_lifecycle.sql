create table if not exists stage0_rns.auction_lifecycle_dispatches (
  dispatch_key text primary key,
  chain_id integer not null,
  channel text not null check (channel in ('email', 'admin_slack')),
  subscription_id bigint references stage0_rns.notification_subscriptions(id) on delete cascade,
  event_type text not null,
  recipient text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  next_attempt_at timestamptz,
  last_error text,
  detail jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stage0_rns_lifecycle_retry
  on stage0_rns.auction_lifecycle_dispatches(status, next_attempt_at)
  where status = 'failed';

create index if not exists idx_stage0_rns_lifecycle_chain_event
  on stage0_rns.auction_lifecycle_dispatches(chain_id, event_type, created_at desc);
