// Receipt-only, idempotent backfill. Never resets ownership, cursors or notifications.
import { createPublicClient, http } from "viem";
import { config } from "../config.js";
import { pool } from "../db.js";
import { recordRegistryTransfer, REGISTRY_TRANSFER_EVENT } from "./incoming-transfers.js";

const rpc = createPublicClient({ transport: http(config.riseRpcUrl) });
try {
  if (await rpc.getChainId() !== config.riseChainId) throw new Error("RPC chain mismatch; refusing transfer backfill.");
  const result = await pool.query<{ last_processed_block: string }>(`select last_processed_block::text
    from stage0_rns.sync_state where chain_id=$1 and contract_address=lower($2) and job_name='registry'`,
  [config.riseChainId,config.rnsContracts.registry]);
  if (!result.rows[0]) throw new Error("Registry indexing must be initialized before backfill.");
  const end = BigInt(result.rows[0].last_processed_block);
  let scanned = 0;
  for (let start=config.rnsStartBlocks.registry; start<=end; start+=5000n) {
    const toBlock = start+4999n < end ? start+4999n : end;
    const logs = await rpc.getLogs({ address: config.rnsContracts.registry as `0x${string}`, event: REGISTRY_TRANSFER_EVENT, fromBlock:start, toBlock });
    if (logs.length === 0) continue;
    const db = await pool.connect();
    try {
      await db.query("begin");
      for (const log of logs) {
        if (log.removed || !log.args.node || !log.args.owner || !log.transactionHash || log.logIndex === null || log.blockNumber === null) continue;
        await recordRegistryTransfer(db,{ chainId:config.riseChainId,registry:config.rnsContracts.registry,node:log.args.node,recipient:log.args.owner,transactionHash:log.transactionHash,logIndex:log.logIndex,blockNumber:log.blockNumber });
        scanned++;
      }
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; } finally { db.release(); }
  }
  console.log(JSON.stringify({chainId:config.riseChainId,throughBlock:end.toString(),transferEvents:scanned,ownershipUnchanged:true}));
} finally { await pool.end(); }
