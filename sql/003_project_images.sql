create table if not exists senna.collection_images (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  collection_address text not null,
  image_url text,
  image_mime_type text,
  image_size_bytes integer check (image_size_bytes is null or (image_size_bytes > 0 and image_size_bytes <= 2097152)),
  image_data bytea,
  description text,
  website_url text,
  x_url text,
  telegram_url text,
  discord_url text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, collection_address)
);

create index if not exists idx_senna_collection_images_lookup
  on senna.collection_images(chain_id, collection_address);

create table if not exists senna.token_images (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  token_address text not null,
  image_url text,
  image_mime_type text,
  image_size_bytes integer check (image_size_bytes is null or (image_size_bytes > 0 and image_size_bytes <= 2097152)),
  image_data bytea,
  description text,
  website_url text,
  x_url text,
  telegram_url text,
  discord_url text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, token_address)
);

create index if not exists idx_senna_token_images_lookup
  on senna.token_images(chain_id, token_address);
