-- This migration is intentionally replay-safe both before and after migration
-- 016 adds the required notification_dispatches.chain_id column. The migration
-- runner executes every numbered file on each run, so the insert shape must
-- adapt to the schema version that is currently present.
do $migration$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'stage0_rns'
      and table_name = 'notification_dispatches'
      and column_name = 'chain_id'
  ) then
    execute $sql$
      insert into stage0_rns.notification_dispatches (
        chain_id,
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
        subscription.chain_id,
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
      on conflict (dispatch_key) do nothing
    $sql$;
  else
    execute $sql$
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
      on conflict (dispatch_key) do nothing
    $sql$;
  end if;
end
$migration$;
