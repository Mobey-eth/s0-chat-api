create extension if not exists pgcrypto;

create schema if not exists senna;

create table if not exists senna.doc_sources (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  title text,
  content_hash text not null,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists senna.doc_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references senna.doc_sources(id) on delete cascade,
  chunk_index integer not null,
  title text,
  heading_path text,
  chunk_text text not null,
  tsv tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(heading_path, '') || ' ' || coalesce(chunk_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index if not exists idx_senna_doc_chunks_tsv on senna.doc_chunks using gin (tsv);

create table if not exists senna.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text,
  evm_address text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists senna.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references senna.chat_sessions(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null,
  citations_json jsonb,
  meta_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_senna_chat_messages_session on senna.chat_messages(session_id, created_at);

create table if not exists senna.action_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references senna.chat_sessions(id) on delete set null,
  action_type text not null,
  route text not null,
  required_wallet text,
  required_chain text,
  prefill_json jsonb not null,
  summary text not null,
  warnings_json jsonb,
  missing_fields_json jsonb,
  next_steps_json jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists senna.tool_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references senna.chat_sessions(id) on delete set null,
  tool_name text not null,
  input_json jsonb not null,
  output_json jsonb,
  status text not null,
  created_at timestamptz not null default now()
);
