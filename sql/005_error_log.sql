create table if not exists senna.error_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references senna.chat_sessions(id) on delete set null,
  scope text not null,
  code text not null,
  internal_message text,
  http_status integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_senna_error_log_created_at
  on senna.error_log(created_at desc);

create index if not exists idx_senna_error_log_session
  on senna.error_log(session_id, created_at desc);

alter table senna.chat_sessions
  add column if not exists off_topic_strikes integer not null default 0;
