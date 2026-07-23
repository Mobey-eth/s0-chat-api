import { pool } from "../db.js";
import { config } from "../config.js";
import { reconcileRnsKnownLabel } from "./service.js";

const labels = process.argv
  .slice(2)
  .flatMap((value) => value.split(","))
  .map((value) => value.trim())
  .filter(Boolean);

if (labels.length === 0) {
  console.error("Usage: npm run rns:reconcile-labels -- tomato tomatoes rorry");
  process.exitCode = 1;
} else {
  try {
    const results = [];
    for (const label of labels) {
      const record = await reconcileRnsKnownLabel({
        label,
        chainId: config.riseTestnetChainId,
        reason: "manual-cli",
      });
      results.push({
        label,
        found: Boolean(record),
        owner: record?.owner ?? null,
        expiry: record?.expiry.toString() ?? null,
        node: record?.node ?? null,
      });
    }
    console.log(JSON.stringify({ ok: true, chainId: config.riseTestnetChainId, results }, null, 2));
  } finally {
    await pool.end();
  }
}
