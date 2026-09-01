import { writeFile } from "node:fs/promises";
import { config as loadEnv } from "dotenv";
import pg, { type PoolClient, type QueryResult } from "pg";
import { logger } from "../logger.js";

loadEnv();

const { Pool } = pg;
const sourceDatabaseUrl = process.env.RNS_SOURCE_DATABASE_URL;
const mirrorDatabaseUrl = process.env.RNS_MIRROR_DATABASE_URL;
const chainId = Number(process.env.RISE_CHAIN_ID ?? "4153");
const intervalSeconds = Number(process.env.RNS_MIRROR_INTERVAL_SECONDS ?? "30");

if (!sourceDatabaseUrl || !mirrorDatabaseUrl) {
  throw new Error("RNS_SOURCE_DATABASE_URL and RNS_MIRROR_DATABASE_URL are required");
}
if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("RISE_CHAIN_ID must be a positive integer");
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10) {
  throw new Error("RNS_MIRROR_INTERVAL_SECONDS must be at least 10");
}

const sourcePool = new Pool({
  connectionString: sourceDatabaseUrl,
  max: 2,
  idleTimeoutMillis: 30_000,
  ssl: process.env.RNS_SOURCE_DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
});
const mirrorPool = new Pool({
  connectionString: mirrorDatabaseUrl,
  max: 2,
  idleTimeoutMillis: 30_000,
});

const MIRRORED_TABLES = [
  "sync_state",
  "names",
  "primary_auctions",
  "marketplace_listings",
  "marketplace_auctions",
  "marketplace_events",
] as const;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function insertRows(
  client: PoolClient,
  table: string,
  result: QueryResult<Record<string, unknown>>,
) {
  if (result.rows.length === 0) return;
  const columns = result.fields.map((field) => field.name);
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const batchSize = Math.max(1, Math.floor(5_000 / columns.length));

  for (let offset = 0; offset < result.rows.length; offset += batchSize) {
    const rows = result.rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders = rows.map((row) => {
      const rowPlaceholders = columns.map((column) => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });
    await client.query(
      `insert into stage0_rns.${quoteIdentifier(table)} (${quotedColumns}) values ${placeholders.join(", ")}`,
      values,
    );
  }
}

async function syncOnce(reason: string) {
  const source = await sourcePool.connect();
  const mirror = await mirrorPool.connect();
  const startedAt = Date.now();
  const counts: Record<string, number> = {};

  try {
    await source.query("begin isolation level repeatable read read only");
    await mirror.query("begin");

    for (const table of MIRRORED_TABLES) {
      const snapshot = await source.query<Record<string, unknown>>(
        `select * from stage0_rns.${quoteIdentifier(table)} where chain_id = $1`,
        [chainId],
      );
      await mirror.query(
        `delete from stage0_rns.${quoteIdentifier(table)} where chain_id = $1`,
        [chainId],
      );
      await insertRows(mirror, table, snapshot);
      counts[table] = snapshot.rowCount ?? snapshot.rows.length;
    }

    await mirror.query(
      `
        insert into stage0_rns.mirror_status (chain_id, last_synced_at, source_counts, sync_duration_ms)
        values ($1, now(), $2::jsonb, $3)
        on conflict (chain_id)
        do update set
          last_synced_at = excluded.last_synced_at,
          source_counts = excluded.source_counts,
          sync_duration_ms = excluded.sync_duration_ms
      `,
      [chainId, JSON.stringify(counts), Date.now() - startedAt],
    );

    await mirror.query("commit");
    await source.query("commit");
    await writeFile("/tmp/rns-mirror-ready", new Date().toISOString(), "utf8");
    logger.info("RNS public mirror synchronized", {
      reason,
      chainId,
      counts,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await mirror.query("rollback").catch(() => undefined);
    await source.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    mirror.release();
    source.release();
  }
}

let running = false;
async function run(reason: string) {
  if (running) return;
  running = true;
  try {
    await syncOnce(reason);
  } catch (error) {
    logger.error("RNS public mirror synchronization failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

await run("startup");
const timer = setInterval(() => void run("interval"), intervalSeconds * 1_000);

async function shutdown(signal: string) {
  clearInterval(timer);
  logger.info("Shutting down RNS public mirror", { signal });
  await Promise.all([sourcePool.end(), mirrorPool.end()]);
}

process.on("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown("SIGTERM").then(() => process.exit(0)));
