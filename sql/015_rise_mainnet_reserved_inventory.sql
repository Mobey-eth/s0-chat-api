insert into stage0_rns.reserved_names (
  chain_id,
  label,
  fqdn,
  category,
  enabled,
  sale_mode,
  reserve_price_wei,
  fixed_price_wei,
  notes,
  display_order,
  auction_duration_seconds
)
select
  4153,
  source.label,
  source.label || '.rise',
  source.category,
  false,
  source.sale_mode,
  source.reserve_price_wei,
  source.fixed_price_wei,
  source.notes,
  source.display_order,
  source.auction_duration_seconds
from stage0_rns.reserved_names as source
where source.chain_id = 11155931
on conflict (chain_id, (lower(label))) do nothing;

-- Repair rows created by the earliest mainnet draft, which reset sale details
-- to null. Never overwrite an enabled or already-published mainnet record.
update stage0_rns.reserved_names as mainnet
set
  sale_mode = source.sale_mode,
  reserve_price_wei = source.reserve_price_wei,
  fixed_price_wei = source.fixed_price_wei,
  notes = coalesce(mainnet.notes, source.notes),
  auction_duration_seconds = source.auction_duration_seconds,
  updated_at = now()
from stage0_rns.reserved_names as source
where mainnet.chain_id = 4153
  and source.chain_id = 11155931
  and lower(mainnet.label) = lower(source.label)
  and not mainnet.enabled
  and mainnet.activated_at is null
  and mainnet.reserve_price_wei is null
  and mainnet.fixed_price_wei is null
  and (
    mainnet.sale_mode is distinct from source.sale_mode
    or source.reserve_price_wei is not null
    or source.fixed_price_wei is not null
    or (mainnet.notes is null and source.notes is not null)
    or mainnet.auction_duration_seconds is distinct from source.auction_duration_seconds
  );
