alter table senna.collection_images
  alter column image_url drop not null,
  alter column image_mime_type drop not null,
  alter column image_size_bytes drop not null,
  alter column image_data drop not null;

alter table senna.collection_images
  add column if not exists description text,
  add column if not exists website_url text,
  add column if not exists x_url text,
  add column if not exists telegram_url text,
  add column if not exists discord_url text;

alter table senna.token_images
  alter column image_url drop not null,
  alter column image_mime_type drop not null,
  alter column image_size_bytes drop not null,
  alter column image_data drop not null;

alter table senna.token_images
  add column if not exists description text,
  add column if not exists website_url text,
  add column if not exists x_url text,
  add column if not exists telegram_url text,
  add column if not exists discord_url text;
