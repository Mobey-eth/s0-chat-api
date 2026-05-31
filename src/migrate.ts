import { closeDb, runMigrations } from "./db.js";
import { logger } from "./logger.js";

try {
  await runMigrations();
  logger.info("Senna database migration complete");
} catch (error) {
  logger.error("Senna database migration failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  await closeDb();
}
