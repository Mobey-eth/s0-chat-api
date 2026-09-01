import { config } from "./config.js";
import { assertDatabaseAccessMode, closeDb } from "./db.js";
import { logger } from "./logger.js";
import { buildPublicRnsApp } from "./public-rns-app.js";

const app = await buildPublicRnsApp();
await assertDatabaseAccessMode();

const shutdown = async (signal: string) => {
  logger.info("Shutting down public RNS API", { signal });
  await app.close().catch(() => undefined);
  await closeDb().catch(() => undefined);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT").then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").then(() => process.exit(0));
});

await app.listen({
  host: "0.0.0.0",
  port: config.port,
});

logger.info("Stage0 public RNS API listening", {
  port: config.port,
  network: config.riseNetworkName,
  chainId: config.riseChainId,
  readOnlyDatabase: config.databaseReadOnly,
  routes: "GET /v1/*",
});
