import { closeDb, pool } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const confirm = process.env.CONFIRM_RNS_RESET === "true";

if (!confirm) {
  logger.error("Refusing to reset RNS index without CONFIRM_RNS_RESET=true", {
    chainId: config.riseChainId,
  });
  process.exitCode = 1;
  await closeDb();
  process.exit();
}

const client = await pool.connect();

try {
  await client.query("begin");
  const lifecycleDispatches = await client.query(
    "delete from stage0_rns.auction_lifecycle_dispatches where chain_id = $1",
    [config.riseChainId],
  );
  const notificationDispatches = await client.query(
    "delete from stage0_rns.notification_dispatches where chain_id = $1",
    [config.riseChainId],
  );
  const notificationSubscriptions = await client.query(
    "delete from stage0_rns.notification_subscriptions where chain_id = $1",
    [config.riseChainId],
  );
  const events = await client.query(
    "delete from stage0_rns.marketplace_events where chain_id = $1",
    [config.riseChainId],
  );
  const marketplaceAuctions = await client.query(
    "delete from stage0_rns.marketplace_auctions where chain_id = $1",
    [config.riseChainId],
  );
  const listings = await client.query(
    "delete from stage0_rns.marketplace_listings where chain_id = $1",
    [config.riseChainId],
  );
  const primaryAuctions = await client.query(
    "delete from stage0_rns.primary_auctions where chain_id = $1",
    [config.riseChainId],
  );
  const names = await client.query(
    "delete from stage0_rns.names where chain_id = $1",
    [config.riseChainId],
  );
  const sync = await client.query(
    "delete from stage0_rns.sync_state where chain_id = $1",
    [config.riseChainId],
  );
  const reservedActivations = await client.query(
    `
      update stage0_rns.reserved_names
      set primary_auction_id = null,
          activation_tx_hash = null,
          activated_at = null,
          updated_at = now()
      where chain_id = $1
        and (primary_auction_id is not null or activation_tx_hash is not null or activated_at is not null)
    `,
    [config.riseChainId],
  );
  await client.query("commit");

  logger.info("RNS index reset complete", {
    chainId: config.riseChainId,
    deletedNames: names.rowCount,
    deletedPrimaryAuctions: primaryAuctions.rowCount,
    deletedMarketplaceListings: listings.rowCount,
    deletedMarketplaceAuctions: marketplaceAuctions.rowCount,
    deletedMarketplaceEvents: events.rowCount,
    deletedSyncStates: sync.rowCount,
    deletedNotificationSubscriptions: notificationSubscriptions.rowCount,
    deletedNotificationDispatches: notificationDispatches.rowCount,
    deletedLifecycleDispatches: lifecycleDispatches.rowCount,
    clearedReservedActivations: reservedActivations.rowCount,
    nextRegistry: config.rnsContracts.registry,
    nextResolver: config.rnsContracts.resolver,
    nextRegistrar: config.rnsContracts.registrar,
    nextAuctionHouse: config.rnsContracts.auctionHouse,
    nextMarketplace: config.rnsContracts.marketplace,
  });
} catch (error) {
  await client.query("rollback");
  logger.error("RNS index reset failed", {
    chainId: config.riseChainId,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  client.release();
  await closeDb();
}
