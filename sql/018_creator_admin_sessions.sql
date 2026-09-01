create table if not exists senna.creator_admin_challenges (
  id uuid primary key,
  chain_id integer not null,
  admin_address text not null,
  nonce text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint creator_admin_challenges_address_format
    check (admin_address ~ '^0x[0-9a-f]{40}$'),
  constraint creator_admin_challenges_nonce_format
    check (nonce ~ '^0x[0-9a-f]{64}$')
);

create index if not exists idx_creator_admin_challenges_expiry
  on senna.creator_admin_challenges(expires_at);

create table if not exists senna.creator_admin_sessions (
  token_hash text primary key,
  chain_id integer not null,
  admin_address text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint creator_admin_sessions_address_format
    check (admin_address ~ '^0x[0-9a-f]{40}$'),
  constraint creator_admin_sessions_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists idx_creator_admin_sessions_expiry
  on senna.creator_admin_sessions(expires_at);
