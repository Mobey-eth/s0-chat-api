// Explicit opt-in. Never runs against the configured production database.
// RNS_TEST_DATABASE_URL=postgresql://.../test_rns_primary npm run test:rns-primary:db
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";

const target = new URL(process.env.RNS_TEST_DATABASE_URL ?? "http://missing.invalid");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/test_rns_primary" || !["postgres:", "postgresql:"].includes(target.protocol)) {
  throw new Error("This destructive fixture suite requires an explicit loopback RNS_TEST_DATABASE_URL ending in /test_rns_primary.");
}
process.env.DATABASE_URL = target.href;
process.env.DATABASE_SSL = "false";
process.env.DATABASE_READ_ONLY = "false";
const { pool } = await import("../db.js");
const { savePrimaryPreference, getPrimaryVersion } = await import("./primary-name.js");
const { getRnsPrimaryNameForAddress, applyRnsOwnerTransfer } = await import("./store.js");
await pool.query(await readFile("rns-mirror/01-schema.sql", "utf8"));
const migration = await readFile("sql/019_rns_primary_name_preferences.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // Idempotency.
const address = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const node = `0x${"a".repeat(64)}` as const;
const fallbackNode = `0x${"b".repeat(64)}` as const;
const choice = { chainId: 4153, address, name: "longer", node, version: "0", timestamp: Date.now(), selectedBlock: "30000000", registeredBlock: "20079523" };
const reverse = () => getRnsPrimaryNameForAddress({ chainId: 4153, address, nowUnix: BigInt(Math.floor(Date.now() / 1000)), minRegisteredBlock: 20079523n });
beforeEach(async () => {
  await pool.query("truncate stage0_rns.primary_name_preferences, stage0_rns.names cascade");
  for (const [n, label] of [[node, "longer"], [fallbackNode, "bob"]]) {
    await pool.query(`insert into stage0_rns.names (chain_id,node,label,fqdn,registrant,owner,resolved_address,expiry,registered_block,updated_block)
      values (4153,$1,$2,$2 || '.rise',$3,$3,$3,9999999999,20079523,29999999)`, [n, label, address]);
  }
});
after(async () => { await pool.end(); });

test("explicit preference wins, persists across reads, and an old signature cannot overwrite it", async () => {
  assert.equal((await reverse())?.label, "bob");
  assert.equal(await getPrimaryVersion(4153, address), "0");
  assert.equal(await savePrimaryPreference(choice), "1");
  assert.equal((await reverse())?.label, "longer");
  assert.equal(await savePrimaryPreference({ ...choice, node: fallbackNode, name: "bob" }), null);
  assert.equal((await reverse())?.label, "longer");
  assert.equal(await savePrimaryPreference({ ...choice, node: fallbackNode, name: "bob", version: "1" }), "2");
  assert.equal((await reverse())?.label, "bob");
});

test("concurrent choices at the same version produce exactly one successful write", async () => {
  const versions = await Promise.all([savePrimaryPreference(choice), savePrimaryPreference({ ...choice, node: fallbackNode, name: "bob" })]);
  assert.deepEqual(versions.sort(), ["1", null].sort());
  assert.equal(await getPrimaryVersion(4153, address), "1");
});

test("transfer invalidates a selection and it does not revive if the name returns", async () => {
  await savePrimaryPreference(choice);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await applyRnsOwnerTransfer(client, { chainId: 4153, node, owner: other, blockNumber: 30000001n });
    await client.query("commit");
  } finally { client.release(); }
  assert.equal(await getPrimaryVersion(4153, address), "2");
  assert.equal((await reverse())?.label, "bob");
  await applyRnsOwnerTransfer(pool, { chainId: 4153, node, owner: address, blockNumber: 30000002n });
  assert.equal((await reverse())?.label, "bob");
  assert.equal(await savePrimaryPreference({ ...choice, version: "1", selectedBlock: "30000003" }), null);
  assert.equal(await savePrimaryPreference({ ...choice, version: "2", selectedBlock: "30000003" }), "3");
});

test("historical transfers older than the selection do not invalidate it", async () => {
  await savePrimaryPreference(choice);
  await applyRnsOwnerTransfer(pool, { chainId: 4153, node, owner: other, blockNumber: 20079524n });
  assert.equal((await reverse())?.label, "longer");
  assert.equal(await getPrimaryVersion(4153, address), "1");
  // A block-pinned selection includes the final state of that entire block.
  await applyRnsOwnerTransfer(pool, { chainId: 4153, node, owner: other, blockNumber: 30000000n });
  await applyRnsOwnerTransfer(pool, { chainId: 4153, node, owner: address, blockNumber: 30000000n });
  assert.equal((await reverse())?.label, "longer");
  assert.equal(await getPrimaryVersion(4153, address), "1");
});

test("expiry, release, escrow, mismatched resolution or a new registration fall back safely", async () => {
  await savePrimaryPreference(choice);
  for (const patch of ["expiry = 1", "released_at = now()", `owner = '${other}'`, `resolved_address = '${other}'`, "registered_block = 30000001"]) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`update stage0_rns.names set ${patch} where node = $1`, [node]);
      await client.query("commit");
      assert.equal((await reverse())?.label, "bob");
      await client.query(`update stage0_rns.names set expiry=9999999999,released_at=null,owner=$2,resolved_address=$2,registered_block=20079523 where node=$1`, [node, address]);
    } finally { client.release(); }
  }
});

test("save rechecks indexed ownership, resolution, registration and block to close the validation race", async () => {
  await applyRnsOwnerTransfer(pool, { chainId: 4153, node, owner: other, blockNumber: 30000001n });
  assert.equal(await savePrimaryPreference(choice), null);
  await pool.query("update stage0_rns.names set owner=$2 where node=$1", [node, address]);
  assert.equal(await savePrimaryPreference(choice), null); // Snapshot is behind the index.
  assert.equal(await savePrimaryPreference({ ...choice, selectedBlock: "30000002" }), "1");
});

test("testnet preferences cannot affect a mainnet reverse lookup", async () => {
  await pool.query(`insert into stage0_rns.primary_name_preferences(chain_id,address,node,label,version,selected_block,registered_block)
    values(11155931,$1,$2,'longer',1,30000000,20079523)`, [address, node]);
  assert.equal((await reverse())?.label, "bob");
});
