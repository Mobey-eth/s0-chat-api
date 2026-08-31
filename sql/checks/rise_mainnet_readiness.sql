-- Read-only RISE Mainnet RNS database readiness report.
-- Run after migrations with: psql "$DATABASE_URL" -f sql/checks/rise_mainnet_readiness.sql

select
  chain_id,
  count(*) as reserved_names,
  count(*) filter (where enabled) as enabled_names,
  count(*) filter (where activated_at is not null) as activated_names,
  count(*) filter (where sale_mode = 'auction') as auction_names,
  count(*) filter (where sale_mode = 'buy_now') as fixed_price_names,
  count(*) filter (
    where sale_mode = 'auction'
      and enabled
      and coalesce(reserve_price_wei, 0) <= 0
  ) as enabled_auctions_without_price,
  count(*) filter (
    where sale_mode = 'buy_now'
      and enabled
      and coalesce(fixed_price_wei, 0) <= 0
  ) as enabled_fixed_sales_without_price
from stage0_rns.reserved_names
where chain_id in (11155931, 4153)
group by chain_id
order by chain_id;

select source.label
from stage0_rns.reserved_names as source
left join stage0_rns.reserved_names as mainnet
  on mainnet.chain_id = 4153
 and lower(mainnet.label) = lower(source.label)
where source.chain_id = 11155931
  and mainnet.id is null
order by source.display_order, source.label;

select
  lower(label) as normalized_label,
  count(*) as duplicate_count
from stage0_rns.reserved_names
where chain_id = 4153
group by lower(label)
having count(*) > 1;

select
  label,
  fqdn,
  sale_mode,
  enabled,
  reserve_price_wei,
  fixed_price_wei,
  auction_duration_seconds,
  activation_tx_hash,
  activated_at
from stage0_rns.reserved_names
where chain_id = 4153
  and (
    fqdn <> lower(label) || '.rise'
    or label !~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'
    or auction_duration_seconds not between 86400 and 315360000
    or (enabled and sale_mode = 'auction' and coalesce(reserve_price_wei, 0) <= 0)
    or (enabled and sale_mode = 'buy_now' and coalesce(fixed_price_wei, 0) <= 0)
  )
order by display_order, label;

select
  job_name,
  chain_id,
  contract_address,
  last_processed_block,
  last_processed_at
from stage0_rns.sync_state
where chain_id = 4153
order by job_name, contract_address;
