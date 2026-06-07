import { pool } from "../db.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Queryable = Pick<typeof pool, "query">;

export interface RnsSyncState {
  jobName: "registrar" | "registry" | "resolver";
  chainId: number;
  contractAddress: string;
  lastProcessedBlock: bigint;
  lastProcessedBlockHash: string | null;
  lastProcessedAt: string | null;
  updatedAt: string;
}

export interface RnsNameRecord {
  chainId: number;
  node: `0x${string}`;
  label: string | null;
  fqdn: string | null;
  registrant: `0x${string}`;
  owner: `0x${string}`;
  expiry: bigint;
  resolver: `0x${string}` | null;
  resolvedAddress: `0x${string}` | null;
  registeredTxHash: `0x${string}` | null;
  registeredAt: bigint;
  renewedAt: bigint | null;
  releasedAt: bigint | null;
  createdAtBlock: bigint;
}

export interface RnsNameSnapshot {
  chainId: number;
  node: `0x${string}`;
  label: string | null;
  fqdn: string | null;
  registrant: `0x${string}`;
  owner: `0x${string}`;
  expiry: bigint;
  resolver: `0x${string}` | null;
  resolvedAddress: `0x${string}` | null;
}

function lower(value: string | null | undefined) {
  return value?.toLowerCase() ?? null;
}

function nullableEpoch(value: Date | null | undefined) {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

function normalizeResolver(value: string | null | undefined) {
  return value ? value.toLowerCase() : null;
}

function toNameRecord(row: {
  chain_id: number;
  node: string;
  label: string | null;
  fqdn: string | null;
  registrant: string;
  owner: string;
  expiry: string;
  resolver: string | null;
  resolved_address: string | null;
  registered_tx_hash: string | null;
  registered_at: string | null;
  renewed_at: string | null;
  released_at: string | null;
  registered_block: string | null;
}): RnsNameRecord {
  return {
    chainId: row.chain_id,
    node: row.node as `0x${string}`,
    label: row.label,
    fqdn: row.fqdn,
    registrant: row.registrant as `0x${string}`,
    owner: row.owner as `0x${string}`,
    expiry: BigInt(row.expiry),
    resolver: row.resolver as `0x${string}` | null,
    resolvedAddress: row.resolved_address as `0x${string}` | null,
    registeredTxHash: row.registered_tx_hash as `0x${string}` | null,
    registeredAt: BigInt(row.registered_at ?? "0"),
    renewedAt: row.renewed_at ? BigInt(row.renewed_at) : null,
    releasedAt: row.released_at ? BigInt(row.released_at) : null,
    createdAtBlock: BigInt(row.registered_block ?? "0"),
  };
}

export async function getRnsSyncStates(chainId: number) {
  const result = await pool.query<{
    job_name: "registrar" | "registry" | "resolver";
    chain_id: number;
    contract_address: string;
    last_processed_block: string;
    last_processed_block_hash: string | null;
    last_processed_at: string | null;
    updated_at: string;
  }>(
    `
      select
        job_name,
        chain_id,
        contract_address,
        last_processed_block::text,
        last_processed_block_hash,
        last_processed_at,
        updated_at
      from stage0_rns.sync_state
      where chain_id = $1
    `,
    [chainId],
  );

  return result.rows.map((row) => ({
    jobName: row.job_name,
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    lastProcessedBlock: BigInt(row.last_processed_block),
    lastProcessedBlockHash: row.last_processed_block_hash,
    lastProcessedAt: row.last_processed_at,
    updatedAt: row.updated_at,
  })) satisfies RnsSyncState[];
}

export async function upsertRnsSyncState(input: {
  jobName: "registrar" | "registry" | "resolver";
  chainId: number;
  contractAddress: string;
  lastProcessedBlock: bigint;
  lastProcessedBlockHash: string | null;
}) {
  await pool.query(
    `
      insert into stage0_rns.sync_state (
        job_name,
        chain_id,
        contract_address,
        last_processed_block,
        last_processed_block_hash,
        last_processed_at
      )
      values ($1, $2, lower($3), $4, $5, now())
      on conflict (job_name, chain_id)
      do update set
        contract_address = excluded.contract_address,
        last_processed_block = excluded.last_processed_block,
        last_processed_block_hash = excluded.last_processed_block_hash,
        last_processed_at = now(),
        updated_at = now()
    `,
    [
      input.jobName,
      input.chainId,
      input.contractAddress,
      input.lastProcessedBlock.toString(),
      input.lastProcessedBlockHash,
    ],
  );
}

export async function upsertRnsRegistration(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    label: string | null;
    fqdn: string | null;
    registrant: `0x${string}`;
    owner: `0x${string}`;
    resolver: `0x${string}` | null;
    expiry: bigint;
    txHash: `0x${string}`;
    blockNumber: bigint;
    blockTime: Date;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        label,
        fqdn,
        registrant,
        owner,
        expiry,
        resolver,
        registered_tx_hash,
        registered_block,
        registered_at,
        renewed_tx_hash,
        renewed_block,
        renewed_at,
        released_tx_hash,
        released_block,
        released_at,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, $4, lower($5), lower($6), $7, lower($8), $9, $10, $11, null, null, null, null, null, null, $10, now())
      on conflict (chain_id, node)
      do update set
        label = coalesce(excluded.label, stage0_rns.names.label),
        fqdn = coalesce(excluded.fqdn, stage0_rns.names.fqdn),
        registrant = excluded.registrant,
        owner = excluded.owner,
        expiry = excluded.expiry,
        resolver = coalesce(excluded.resolver, stage0_rns.names.resolver),
        registered_tx_hash = excluded.registered_tx_hash,
        registered_block = excluded.registered_block,
        registered_at = excluded.registered_at,
        released_tx_hash = null,
        released_block = null,
        released_at = null,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [
      input.chainId,
      input.node,
      input.label,
      input.fqdn,
      input.registrant,
      input.owner,
      input.expiry.toString(),
      input.resolver,
      input.txHash,
      input.blockNumber.toString(),
      input.blockTime.toISOString(),
    ],
  );
}

export async function applyRnsRenewal(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    label: string | null;
    fqdn: string | null;
    expiry: bigint;
    txHash: `0x${string}`;
    blockNumber: bigint;
    blockTime: Date;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        label,
        fqdn,
        registrant,
        owner,
        expiry,
        renewed_tx_hash,
        renewed_block,
        renewed_at,
        released_tx_hash,
        released_block,
        released_at,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, $4, $5, $5, $6, $7, $8, $9, null, null, null, $8, now())
      on conflict (chain_id, node)
      do update set
        label = coalesce(stage0_rns.names.label, excluded.label),
        fqdn = coalesce(stage0_rns.names.fqdn, excluded.fqdn),
        expiry = excluded.expiry,
        renewed_tx_hash = excluded.renewed_tx_hash,
        renewed_block = excluded.renewed_block,
        renewed_at = excluded.renewed_at,
        released_tx_hash = null,
        released_block = null,
        released_at = null,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [
      input.chainId,
      input.node,
      input.label,
      input.fqdn,
      ZERO_ADDRESS,
      input.expiry.toString(),
      input.txHash,
      input.blockNumber.toString(),
      input.blockTime.toISOString(),
    ],
  );
}

export async function applyRnsRelease(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    label: string | null;
    fqdn: string | null;
    txHash: `0x${string}`;
    blockNumber: bigint;
    blockTime: Date;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        label,
        fqdn,
        registrant,
        owner,
        expiry,
        released_tx_hash,
        released_block,
        released_at,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, $4, $5, $5, 0, $6, $7, $8, $7, now())
      on conflict (chain_id, node)
      do update set
        label = coalesce(stage0_rns.names.label, excluded.label),
        fqdn = coalesce(stage0_rns.names.fqdn, excluded.fqdn),
        owner = excluded.owner,
        resolved_address = null,
        released_tx_hash = excluded.released_tx_hash,
        released_block = excluded.released_block,
        released_at = excluded.released_at,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [
      input.chainId,
      input.node,
      input.label,
      input.fqdn,
      ZERO_ADDRESS,
      input.txHash,
      input.blockNumber.toString(),
      input.blockTime.toISOString(),
    ],
  );
}

export async function applyRnsOwnerTransfer(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    owner: `0x${string}`;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        registrant,
        owner,
        expiry,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, lower($3), 0, $4, now())
      on conflict (chain_id, node)
      do update set
        owner = excluded.owner,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [input.chainId, input.node, ZERO_ADDRESS, input.blockNumber.toString()],
  );
}

export async function applyRnsResolverUpdate(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    resolver: `0x${string}` | null;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        registrant,
        owner,
        expiry,
        resolver,
        resolved_address,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, $3, 0, lower($4), null, $5, now())
      on conflict (chain_id, node)
      do update set
        resolver = excluded.resolver,
        resolved_address = case when excluded.resolver is null then null else stage0_rns.names.resolved_address end,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [input.chainId, input.node, ZERO_ADDRESS, input.resolver, input.blockNumber.toString()],
  );
}

export async function applyRnsResolvedAddressUpdate(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    resolvedAddress: `0x${string}` | null;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        registrant,
        owner,
        expiry,
        resolved_address,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, $3, 0, lower($4), $5, now())
      on conflict (chain_id, node)
      do update set
        resolved_address = excluded.resolved_address,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [input.chainId, input.node, ZERO_ADDRESS, input.resolvedAddress, input.blockNumber.toString()],
  );
}

export async function applyRnsReconciliation(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    label: string | null;
    fqdn: string | null;
    owner: `0x${string}`;
    resolver: `0x${string}` | null;
    resolvedAddress: `0x${string}` | null;
    expiry: bigint | null;
    updatedBlock: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.names (
        chain_id,
        node,
        label,
        fqdn,
        registrant,
        owner,
        expiry,
        resolver,
        resolved_address,
        updated_block,
        updated_at
      )
      values ($1, lower($2), $3, $4, $5, lower($6), $7, lower($8), lower($9), $10, now())
      on conflict (chain_id, node)
      do update set
        label = coalesce(excluded.label, stage0_rns.names.label),
        fqdn = coalesce(excluded.fqdn, stage0_rns.names.fqdn),
        owner = excluded.owner,
        expiry = coalesce(excluded.expiry, stage0_rns.names.expiry),
        resolver = excluded.resolver,
        resolved_address = excluded.resolved_address,
        updated_block = excluded.updated_block,
        updated_at = now()
    `,
    [
      input.chainId,
      input.node,
      input.label,
      input.fqdn,
      ZERO_ADDRESS,
      input.owner,
      input.expiry?.toString() ?? null,
      input.resolver,
      input.resolvedAddress,
      input.updatedBlock.toString(),
    ],
  );
}

export async function getRnsOwnedNames(input: { chainId: number; owner: string; nowUnix: bigint }) {
  const result = await pool.query<{
    chain_id: number;
    node: string;
    label: string | null;
    fqdn: string | null;
    registrant: string;
    owner: string;
    expiry: string;
    resolver: string | null;
    resolved_address: string | null;
    registered_tx_hash: string | null;
    registered_at: string | null;
    renewed_at: string | null;
    released_at: string | null;
    registered_block: string | null;
  }>(
    `
      select
        chain_id,
        node,
        label,
        fqdn,
        registrant,
        owner,
        expiry::text,
        resolver,
        resolved_address,
        registered_tx_hash,
        case when registered_at is null then null else extract(epoch from registered_at)::bigint::text end as registered_at,
        case when renewed_at is null then null else extract(epoch from renewed_at)::bigint::text end as renewed_at,
        case when released_at is null then null else extract(epoch from released_at)::bigint::text end as released_at,
        registered_block::text
      from stage0_rns.names
      where chain_id = $1
        and owner = lower($2)
        and released_at is null
        and expiry > $3
      order by expiry desc, label asc nulls last, node asc
    `,
    [input.chainId, input.owner, input.nowUnix.toString()],
  );

  return result.rows.map(toNameRecord);
}

export async function getRnsNamesForReconciliation(chainId: number) {
  const result = await pool.query<{
    chain_id: number;
    node: string;
    label: string | null;
    fqdn: string | null;
    registrant: string;
    owner: string;
    expiry: string;
    resolver: string | null;
    resolved_address: string | null;
  }>(
    `
      select
        chain_id,
        node,
        label,
        fqdn,
        registrant,
        owner,
        expiry::text,
        resolver,
        resolved_address
      from stage0_rns.names
      where chain_id = $1
        and released_at is null
      order by updated_block asc, node asc
    `,
    [chainId],
  );

  return result.rows.map((row) => ({
    chainId: row.chain_id,
    node: row.node as `0x${string}`,
    label: row.label,
    fqdn: row.fqdn,
    registrant: row.registrant as `0x${string}`,
    owner: row.owner as `0x${string}`,
    expiry: BigInt(row.expiry),
    resolver: normalizeResolver(row.resolver) as `0x${string}` | null,
    resolvedAddress: normalizeResolver(row.resolved_address) as `0x${string}` | null,
  })) satisfies RnsNameSnapshot[];
}

export async function getRnsNameCount(chainId: number) {
  const result = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from stage0_rns.names
      where chain_id = $1
    `,
    [chainId],
  );

  return Number(result.rows[0]?.count ?? "0");
}

export { ZERO_ADDRESS, lower, nullableEpoch };
