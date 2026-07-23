alter table stage0_rns.reserved_names
  add column if not exists auction_duration_seconds bigint;

update stage0_rns.reserved_names
set auction_duration_seconds = 259200
where auction_duration_seconds is null;

alter table stage0_rns.reserved_names
  alter column auction_duration_seconds set default 259200,
  alter column auction_duration_seconds set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stage0_rns_reserved_auction_duration_range'
  ) then
    alter table stage0_rns.reserved_names
      add constraint stage0_rns_reserved_auction_duration_range
      check (auction_duration_seconds between 86400 and 315360000);
  end if;
end
$$;
