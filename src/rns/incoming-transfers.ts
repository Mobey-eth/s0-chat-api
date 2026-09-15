import { parseAbiItem } from "viem";
import { config } from "../config.js";
import { pool } from "../db.js";

export const REGISTRY_TRANSFER_EVENT = parseAbiItem("event Transfer(bytes32 indexed node, address owner)");
export type IndexedRegistryTransfer = {
  chainId: number; registry: string; node: string; recipient: string;
  transactionHash: string; logIndex: number; blockNumber: bigint;
};

export async function recordRegistryTransfer(db: Pick<typeof pool, "query">, event: IndexedRegistryTransfer) {
  await db.query(`insert into stage0_rns.registry_transfers
    (chain_id,registry,node,recipient,tx_hash,log_index,block_number)
    values($1,lower($2),lower($3),lower($4),lower($5),$6,$7)
    on conflict(chain_id,registry,tx_hash,log_index) do nothing`,
  [event.chainId,event.registry,event.node,event.recipient,event.transactionHash,event.logIndex,event.blockNumber.toString()]);
}

export async function listIncomingRnsTransfers(address: string) {
  const result = await pool.query<{
    node: string; label: string; tx_hash: string; log_index: number; block_number: string;
  }>(`select n.node,n.label,t.tx_hash,t.log_index,t.block_number::text
    from stage0_rns.names n
    join lateral (
      select * from stage0_rns.registry_transfers t
      where t.chain_id=n.chain_id and t.registry=lower($2) and t.node=n.node
      order by t.block_number desc,t.log_index desc limit 1
    ) t on t.recipient=n.owner
    where n.chain_id=$1 and n.owner=lower($3) and n.owner <> all($4::text[])
      and n.expiry > extract(epoch from now()) and n.released_at is null
      and n.registered_block >= $5 and t.block_number >= n.registered_block
      and n.label is not null and n.label <> ''
      and t.tx_hash is distinct from n.registered_tx_hash
    order by t.block_number desc,t.log_index desc limit 100`,
  [config.riseChainId,config.rnsContracts.registry,address,
    ["0x0000000000000000000000000000000000000000",config.rnsContracts.marketplace.toLowerCase(),config.rnsContracts.auctionHouse.toLowerCase()],
    config.rnsStartBlocks.registrar.toString()]);
  return result.rows.map((row) => ({
    id: `${config.riseChainId}:${config.rnsContracts.registry.toLowerCase()}:${row.tx_hash}:${row.log_index}`,
    node: row.node, label: row.label, name: `${row.label}.rise`,
    transactionHash: row.tx_hash, blockNumber: row.block_number,
  }));
}
