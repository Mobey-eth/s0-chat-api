create table if not exists senna.rate_limit_windows (
  scope text not null,
  subject text not null,
  bucket_start timestamptz not null,
  window_seconds integer not null,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, subject, bucket_start, window_seconds)
);

create index if not exists idx_senna_rate_limit_windows_updated_at
  on senna.rate_limit_windows(updated_at);
