alter table stage0_rns.notification_dispatches
  add column if not exists chain_id integer;

update stage0_rns.notification_dispatches as dispatch
set chain_id = subscription.chain_id
from stage0_rns.notification_subscriptions as subscription
where dispatch.chain_id is null
  and dispatch.subscription_id = subscription.id;

update stage0_rns.notification_dispatches
set chain_id = ((regexp_match(dispatch_key, '^email:[^:]+:([0-9]+):'))[1])::integer
where chain_id is null
  and dispatch_key ~ '^email:[^:]+:[0-9]+:';

update stage0_rns.notification_dispatches
set chain_id = ((regexp_match(dispatch_key, '^admin:registration:([0-9]+):'))[1])::integer
where chain_id is null
  and dispatch_key ~ '^admin:registration:[0-9]+:';

update stage0_rns.notification_dispatches
set chain_id = ((regexp_match(dispatch_key, '^admin:[^:]+:([0-9]+):'))[1])::integer
where chain_id is null
  and dispatch_key ~ '^admin:[^:]+:[0-9]+:';

-- Any unparseable legacy dispatch predates the RISE Mainnet cutover and belongs
-- to the historical testnet index. New writes always provide chain_id.
update stage0_rns.notification_dispatches
set chain_id = 11155931
where chain_id is null;

alter table stage0_rns.notification_dispatches
  alter column chain_id set not null;

create index if not exists idx_stage0_rns_notification_dispatches_chain
  on stage0_rns.notification_dispatches(chain_id, sent_at desc);
