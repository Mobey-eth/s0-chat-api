#!/bin/sh
set -eu

export PGPASSWORD="$(cat /run/rns-writer/password)"
reader_password="$(cat /run/rns-reader/password)"

psql -v ON_ERROR_STOP=1 \
  --host stage0-rns-postgres \
  --username stage0_rns_mirror \
  --dbname stage0_rns \
  --set=reader_password="$reader_password" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'stage0_rns_reader') then
    create role stage0_rns_reader login;
  end if;
end
$$;

alter role stage0_rns_reader password :'reader_password';
alter role stage0_rns_reader nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role stage0_rns_reader set default_transaction_read_only = on;
alter role stage0_rns_reader set statement_timeout = '5s';
alter role stage0_rns_reader set idle_in_transaction_session_timeout = '10s';
revoke create on schema public from public;
revoke temporary on database stage0_rns from public;
grant connect on database stage0_rns to stage0_rns_reader;
grant usage on schema stage0_rns to stage0_rns_reader;
grant select on all tables in schema stage0_rns to stage0_rns_reader;
alter default privileges in schema stage0_rns grant select on tables to stage0_rns_reader;
SQL
