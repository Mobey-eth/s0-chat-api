import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";

const target = new URL(process.env.RNS_TEST_DATABASE_URL ?? "http://missing.invalid");
if (!["localhost","127.0.0.1"].includes(target.hostname) || target.pathname !== "/test_rns_incoming" || !["postgres:","postgresql:"].includes(target.protocol)) throw new Error("Requires an explicit loopback RNS_TEST_DATABASE_URL ending in /test_rns_incoming.");
process.env.DATABASE_URL=target.href;
process.env.DATABASE_SSL="false";
process.env.DATABASE_READ_ONLY="false";
const {pool}=await import("../db.js");
const {config}=await import("../config.js");
const {recordRegistryTransfer,listIncomingRnsTransfers}=await import("./incoming-transfers.js");
await pool.query(await readFile("rns-mirror/01-schema.sql","utf8"));
const migration=await readFile("sql/020_rns_incoming_transfers.sql","utf8");
await pool.query(migration);await pool.query(migration);
const recipient="0x1111111111111111111111111111111111111111";
const other="0x2222222222222222222222222222222222222222";
const node=`0x${"a".repeat(64)}`;
const event={chainId:4153,registry:config.rnsContracts.registry,node,recipient,transactionHash:`0x${"b".repeat(64)}`,logIndex:1,blockNumber:30000000n};
beforeEach(async()=>{
  await pool.query("truncate stage0_rns.names,stage0_rns.registry_transfers cascade");
  await pool.query(`insert into stage0_rns.names(chain_id,node,label,fqdn,registrant,owner,expiry,registered_block,updated_block)
    values(4153,$1,'alice','alice.rise',$2,$2,9999999999,20079523,30000000)`,[node,recipient]);
});
after(async()=>{await pool.end();});

test("records transfers idempotently without changing name data",async()=>{
  await recordRegistryTransfer(pool,event);await recordRegistryTransfer(pool,event);
  const rows=await listIncomingRnsTransfers(recipient);
  assert.equal(rows.length,1);assert.equal(rows[0].name,"alice.rise");
  assert.equal(rows[0].transactionHash,event.transactionHash);
  assert.equal((await pool.query("select count(*)::int as count from stage0_rns.registry_transfers")).rows[0].count,1);
  assert.equal((await pool.query("select owner from stage0_rns.names")).rows[0].owner,recipient);
});
test("does not notify for ordinary registrations",async()=>{
  assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
  await recordRegistryTransfer(pool,event);
  await pool.query("update stage0_rns.names set registered_tx_hash=$1",[event.transactionHash]);
  assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
});
test("only the current owner receives the latest transfer, including a return transfer",async()=>{
  await recordRegistryTransfer(pool,event);
  const original=(await listIncomingRnsTransfers(recipient))[0].id;
  const outgoing={...event,recipient:other,transactionHash:`0x${"c".repeat(64)}`,blockNumber:30000001n};
  await recordRegistryTransfer(pool,outgoing);
  await pool.query("update stage0_rns.names set owner=$1",[other]);
  assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
  assert.equal((await listIncomingRnsTransfers(other)).length,1);
  await recordRegistryTransfer(pool,{...event,transactionHash:`0x${"d".repeat(64)}`,blockNumber:30000002n});
  await pool.query("update stage0_rns.names set owner=$1",[recipient]);
  const returned=await listIncomingRnsTransfers(recipient);
  assert.equal(returned.length,1);assert.notEqual(returned[0].id,original);
  assert.deepEqual(await listIncomingRnsTransfers(other),[]);
});
test("excludes expired, released and re-registered names",async()=>{
  await recordRegistryTransfer(pool,event);
  for(const patch of ["expiry=1","released_at=now()","registered_block=30000001"]){
    await pool.query(`update stage0_rns.names set ${patch}`);
    assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
    await pool.query("update stage0_rns.names set expiry=9999999999,released_at=null,registered_block=20079523");
  }
});
test("chain and registry scopes cannot leak notifications",async()=>{
  await recordRegistryTransfer(pool,{...event,chainId:11155931});
  await recordRegistryTransfer(pool,{...event,registry:other});
  assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
});
test("escrow custody is not an incoming wallet name",async()=>{
  const recipient=config.rnsContracts.marketplace.toLowerCase();
  await recordRegistryTransfer(pool,{...event,recipient});
  await pool.query("update stage0_rns.names set owner=$1",[recipient]);
  assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
});
test("incomplete index and older events cannot restore an outdated notification",async()=>{
  await recordRegistryTransfer(pool,{...event,recipient:other,blockNumber:30000001n,transactionHash:`0x${"c".repeat(64)}`});
  await recordRegistryTransfer(pool,event);
  assert.deepEqual(await listIncomingRnsTransfers(recipient),[]);
});
