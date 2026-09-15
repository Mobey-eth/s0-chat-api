import { createPublicClient, getAddress, http, type Hex } from "viem";
import { config } from "../config.js";
import { pool } from "../db.js";
import { getRnsNameByLabel } from "./store.js";
import { readRnsNameOnchain } from "./onchain-read.js";

const client = createPublicClient({ transport: http(config.riseRpcUrl) });
export const PRIMARY_SIGNATURE_TTL_MS = 5 * 60 * 1000;
export class PrimaryNameError extends Error {}

export type PrimaryAuthorization = {
  chainId: number;
  address: string;
  name: string;
  version: string;
  timestamp: number;
};

export function primaryAuthorizationMessage(input: PrimaryAuthorization) {
  return [
    "Stage0 primary name selection",
    "Service: stage0.xyz",
    `Chain ID: ${input.chainId}`,
    `Registry: ${config.rnsContracts.registry.toLowerCase()}`,
    `Wallet: ${getAddress(input.address)}`,
    `Primary name: ${input.name}.rise`,
    `Current version: ${input.version}`,
    `Timestamp: ${input.timestamp}`,
    "Set this name as my public primary identity in the Stage0 RNS API.",
    "This signature does not transfer ownership or submit a transaction. No gas is required.",
  ].join("\n");
}

export async function verifyPrimaryAuthorization(
  input: PrimaryAuthorization & { signature: Hex },
  verify = client.verifyMessage,
) {
  const age = Date.now() - input.timestamp;
  if (input.chainId !== config.riseChainId || age < -30_000 || age > PRIMARY_SIGNATURE_TTL_MS) return false;
  return verify({ address: getAddress(input.address), message: primaryAuthorizationMessage(input), signature: input.signature });
}

export async function getPrimaryVersion(chainId: number, address: string) {
  const result = await pool.query<{ version: string }>(
    "select version::text from stage0_rns.primary_name_preferences where chain_id = $1 and address = lower($2)",
    [chainId, address],
  );
  return result.rows[0]?.version ?? "0";
}

export async function checkPrimaryEligibility(address: string, name: string, deps = { onchain: readRnsNameOnchain, indexed: getRnsNameByLabel }) {
  const record = await deps.onchain(name);
  const wallet = address.toLowerCase();
  if (!record?.registered || record.isExpired) throw new PrimaryNameError("Choose an unexpired registered name.");
  if (record.owner !== wallet) throw new PrimaryNameError("Your wallet must own this name directly. Names in marketplace escrow cannot be primary.");
  if (record.resolvedAddress !== wallet) throw new PrimaryNameError("This name must resolve to your wallet before it can be primary. Update its resolving address first.");
  const indexed = await deps.indexed({ chainId: config.riseChainId, label: name, minRegisteredBlock: config.rnsStartBlocks.registrar });
  if (!indexed || indexed.owner.toLowerCase() !== wallet || indexed.resolvedAddress?.toLowerCase() !== wallet || indexed.expiry <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new PrimaryNameError("This name is still being indexed. Please try again after the next sync.");
  }
  return { node: record.node, selectedBlock: record.blockNumber, registeredBlock: indexed.createdAtBlock.toString() };
}

export async function savePrimaryPreference(input: PrimaryAuthorization & { node: string; selectedBlock: string; registeredBlock: string }): Promise<string | null> {
  // Monotonic compare-and-swap: a signature cannot be replayed to overwrite a
  // newer selection, including signatures signed concurrently in two tabs.
  const result = await pool.query<{ version: string }>(`
    with eligible as (
      select 1 from stage0_rns.names
      where chain_id = $1 and node = lower($3) and owner = lower($2)
        and resolved_address = lower($2) and released_at is null
        and expiry > extract(epoch from now()) and registered_block = $7
        and updated_block <= $6
      for update
    )
    insert into stage0_rns.primary_name_preferences
      (chain_id, address, node, label, version, selected_block, registered_block)
    select $1, lower($2), lower($3), $4, 1, $6, $7 from eligible
    where $5::bigint = 0 or exists (
      select 1 from stage0_rns.primary_name_preferences where chain_id = $1 and address = lower($2)
    )
    on conflict (chain_id, address) do update set
      node = excluded.node, label = excluded.label,
      version = stage0_rns.primary_name_preferences.version + 1,
      selected_block = excluded.selected_block, registered_block = excluded.registered_block,
      invalidated_at = null, updated_at = now()
    where stage0_rns.primary_name_preferences.version = $5::bigint
      and stage0_rns.primary_name_preferences.selected_block <= excluded.selected_block
    returning version::text
  `, [input.chainId, input.address, input.node, input.name, input.version, input.selectedBlock, input.registeredBlock]);
  return result.rows[0]?.version ?? null;
}
