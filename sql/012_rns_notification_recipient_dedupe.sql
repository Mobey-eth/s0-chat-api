insert into stage0_rns.notification_dispatches (
  channel,
  dispatch_key,
  subscription_id,
  event_source,
  event_type,
  tx_hash,
  log_index,
  detail,
  sent_at
)
select
  'email',
  concat(
    'email:',
    lower(subscription.email),
    ':',
    subscription.chain_id,
    ':',
    lower(dispatch.tx_hash),
    ':',
    dispatch.log_index
  ),
  dispatch.subscription_id,
  dispatch.event_source,
  dispatch.event_type,
  lower(dispatch.tx_hash),
  dispatch.log_index,
  dispatch.detail,
  dispatch.sent_at
from stage0_rns.notification_dispatches dispatch
join stage0_rns.notification_subscriptions subscription
  on subscription.id = dispatch.subscription_id
where dispatch.channel = 'email'
  and dispatch.tx_hash is not null
  and dispatch.log_index is not null
on conflict (dispatch_key) do nothing;
