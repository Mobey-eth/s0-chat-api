do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'stage0_rns.sync_state'::regclass
      and conname = 'sync_state_pkey'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (job_name, chain_id)'
  ) then
    alter table stage0_rns.sync_state drop constraint sync_state_pkey;
    alter table stage0_rns.sync_state
      add constraint sync_state_pkey primary key (job_name, chain_id, contract_address);
  end if;
end
$$;

create index if not exists idx_stage0_rns_sync_state_active_contract
  on stage0_rns.sync_state(chain_id, contract_address, job_name);
