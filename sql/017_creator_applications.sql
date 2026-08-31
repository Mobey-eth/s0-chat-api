create table if not exists senna.creator_applications (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  application_type text not null check (application_type in ('nft', 'presale')),
  applicant_wallet text not null check (applicant_wallet ~ '^0x[0-9a-f]{40}$'),
  founder_address_input text not null,
  founder_name text not null,
  founder_role text not null,
  founder_email text not null,
  founder_x text,
  founder_telegram text,
  founder_discord text,
  project_name text not null,
  project_description text not null,
  project_stage text not null,
  project_website_url text,
  project_x text,
  project_telegram text,
  project_discord text,
  project_details jsonb not null default '{}'::jsonb,
  team_members jsonb not null default '[]'::jsonb,
  image_url text,
  image_mime_type text,
  image_size_bytes integer check (
    image_size_bytes is null or (image_size_bytes > 0 and image_size_bytes <= 2097152)
  ),
  image_data bytea,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  notification_status text not null default 'pending' check (
    notification_status in ('pending', 'sent', 'partial', 'failed', 'skipped')
  ),
  notification_error text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_senna_creator_applications_admin
  on senna.creator_applications(status, submitted_at desc);

create index if not exists idx_senna_creator_applications_wallet
  on senna.creator_applications(chain_id, applicant_wallet, application_type, submitted_at desc);

create unique index if not exists uq_senna_creator_applications_pending
  on senna.creator_applications(chain_id, application_type, applicant_wallet)
  where status = 'pending';

create table if not exists senna.creator_approvals (
  chain_id integer not null,
  application_type text not null check (application_type in ('nft', 'presale')),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  approved boolean not null default true,
  application_id uuid references senna.creator_applications(id) on delete set null,
  approved_by text not null,
  notes text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, application_type, wallet_address)
);

create index if not exists idx_senna_creator_approvals_active
  on senna.creator_approvals(chain_id, wallet_address, application_type)
  where approved = true;
