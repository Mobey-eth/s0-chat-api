import { closeDb, pool } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const confirm = process.env.CONFIRM_RNS_RESET === "true";

if (!confirm) {
  logger.error("Refusing to reset RNS index without CONFIRM_RNS_RESET=true", {
    chainId: config.riseTestnetChainId,
  });
  process.exitCode = 1;
  await closeDb();
  process.exit();
}

const client = await pool.connect();

try {
  await client.query("begin");
  const events = await client.query(
    "delete from stage0_rns.marketplace_events where chain_id = $1",
    [config.riseTestnetChainId],
  );
  const marketplaceAuctions = await client.query(
    "delete from stage0_rns.marketplace_auctions where chain_id = $1",
    [config.riseTestnetChainId],
  );
  const listings = await client.query(
    "delete from stage0_rns.marketplace_listings where chain_id = $1",
    [config.riseTestnetChainId],
  );
  const primaryAuctions = await client.query(
    "delete from stage0_rns.primary_auctions where chain_id = $1",
    [config.riseTestnetChainId],
  );
  const names = await client.query(
    "delete from stage0_rns.names where chain_id = $1",
    [config.riseTestnetChainId],
  );
  const sync = await client.query(
    "delete from stage0_rns.sync_state where chain_id = $1",
    [config.riseTestnetChainId],
  );
  await client.query("commit");

  logger.info("RNS index reset complete", {
    chainId: config.riseTestnetChainId,
    deletedNames: names.rowCount,
    deletedPrimaryAuctions: primaryAuctions.rowCount,
    deletedMarketplaceListings: listings.rowCount,
    deletedMarketplaceAuctions: marketplaceAuctions.rowCount,
    deletedMarketplaceEvents: events.rowCount,
    deletedSyncStates: sync.rowCount,
    nextRegistry: config.rnsContracts.registry,
    nextResolver: config.rnsContracts.resolver,
    nextRegistrar: config.rnsContracts.registrar,
    nextAuctionHouse: config.rnsContracts.auctionHouse,
    nextMarketplace: config.rnsContracts.marketplace,
  });
} catch (error) {
  await client.query("rollback");
  logger.error("RNS index reset failed", {
    chainId: config.riseTestnetChainId,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  client.release();
  await closeDb();
}
