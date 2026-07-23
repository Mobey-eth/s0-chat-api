import { pool } from "../db.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Queryable = Pick<typeof pool, "query">;

export interface RnsSyncState {
  jobName: RnsJobName;
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
  updatedBlock: bigint;
  updatedAt: string;
  custody: "wallet" | "marketplace_listing" | "marketplace_auction";
  seller: `0x${string}` | null;
  marketplace: RnsNameMarketplaceSummary | null;
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

export type RnsNameMarketplaceSummary =
  | {
      kind: "listing";
      listingId: bigint;
      status: string;
      seller: `0x${string}`;
      price: bigint;
      buyer: `0x${string}` | null;
      purchasedPrice: bigint | null;
      createdTxHash: `0x${string}` | null;
      createdBlock: bigint | null;
      createdAt: string | null;
      updatedBlock: bigint;
      updatedAt: string;
    }
  | {
      kind: "auction";
      auctionId: bigint;
      status: string;
      seller: `0x${string}`;
      reservePrice: bigint;
      startTime: bigint;
      endTime: bigint;
      currentExtensionWindow: bigint | null;
      bidCount: number;
      highestBidder: `0x${string}` | null;
      highestBid: bigint;
      winner: `0x${string}` | null;
      settledAmount: bigint | null;
      createdTxHash: `0x${string}` | null;
      createdBlock: bigint | null;
      createdAt: string | null;
      updatedBlock: bigint;
      updatedAt: string;
    };

export type RnsJobName = "registrar" | "registry" | "resolver" | "primary_auction" | "marketplace";

export interface RnsPrimaryAuctionRecord {
  chainId: number;
  auctionId: bigint;
  name: string;
  fqdn: string;
  duration: bigint;
  reservePrice: bigint;
  startTime: bigint;
  endTime: bigint;
  currentExtensionWindow: bigint | null;
  bidCount: number;
  highestBidder: `0x${string}` | null;
  highestBid: bigint;
  status: string;
  winner: `0x${string}` | null;
  settledAmount: bigint | null;
  createdTxHash: `0x${string}` | null;
  createdBlock: bigint | null;
  createdAt: string | null;
  updatedBlock: bigint;
  updatedAt: string;
}

export interface RnsMarketplaceListingRecord {
  chainId: number;
  listingId: bigint;
  node: `0x${string}`;
  name: string;
  fqdn: string;
  seller: `0x${string}`;
  price: bigint;
  status: string;
  buyer: `0x${string}` | null;
  purchasedPrice: bigint | null;
  createdTxHash: `0x${string}` | null;
  createdBlock: bigint | null;
  createdAt: string | null;
  updatedBlock: bigint;
  updatedAt: string;
}

export interface RnsMarketplaceAuctionRecord {
  chainId: number;
  auctionId: bigint;
  node: `0x${string}`;
  name: string;
  fqdn: string;
  seller: `0x${string}`;
  reservePrice: bigint;
  startTime: bigint;
  endTime: bigint;
  currentExtensionWindow: bigint | null;
  bidCount: number;
  highestBidder: `0x${string}` | null;
  highestBid: bigint;
  status: string;
  winner: `0x${string}` | null;
  settledAmount: bigint | null;
  createdTxHash: `0x${string}` | null;
  createdBlock: bigint | null;
  createdAt: string | null;
  updatedBlock: bigint;
  updatedAt: string;
}

export interface RnsMarketplaceEventRecord {
  id: bigint;
  chainId: number;
  source: string;
  entityType: string;
  eventType: string;
  entityId: bigint | null;
  name: string | null;
  account: `0x${string}` | null;
  counterparty: `0x${string}` | null;
  amount: bigint | null;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  blockTime: string | null;
  payload: unknown;
}

export type RnsNotificationScope =
  | "marketplace_seller"
  | "marketplace_bidder"
  | "marketplace_watcher";

export type RnsReservedSaleMode = "auction" | "buy_now";

export interface RnsNotificationSubscription {
  id: number;
  chainId: number;
  scope: RnsNotificationScope;
  email: string;
  wallet: `0x${string}` | null;
  node: `0x${string}` | null;
  name: string | null;
  auctionId: bigint;
  listingId: bigint;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RnsReservedNameRecord {
  id: number;
  chainId: number;
  label: string;
  fqdn: string;
  category: string;
  enabled: boolean;
  saleMode: RnsReservedSaleMode;
  reservePrice: bigint | null;
  fixedPrice: bigint | null;
  auctionDurationSeconds: bigint;
  notes: string | null;
  displayOrder: number;
  primaryAuctionId: bigint | null;
  activationTxHash: `0x${string}` | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  updated_block: string | null;
  updated_at: string;
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
    updatedBlock: BigInt(row.updated_block ?? "0"),
    updatedAt: row.updated_at,
    custody: "wallet",
    seller: null,
    marketplace: null,
  };
}

function toBigIntOrNull(value: string | null | undefined) {
  return value == null ? null : BigInt(value);
}

function toPrimaryAuctionRecord(row: {
  chain_id: number;
  auction_id: string;
  name: string;
  fqdn: string;
  duration: string;
  reserve_price: string;
  start_time: string;
  end_time: string;
  current_extension_window: string | null;
  bid_count: number;
  highest_bidder: string | null;
  highest_bid: string;
  status: string;
  winner: string | null;
  settled_amount: string | null;
  created_tx_hash: string | null;
  created_block: string | null;
  created_at: string | null;
  updated_block: string;
  updated_at: string;
}): RnsPrimaryAuctionRecord {
  return {
    chainId: row.chain_id,
    auctionId: BigInt(row.auction_id),
    name: row.name,
    fqdn: row.fqdn,
    duration: BigInt(row.duration),
    reservePrice: BigInt(row.reserve_price),
    startTime: BigInt(row.start_time),
    endTime: BigInt(row.end_time),
    currentExtensionWindow: toBigIntOrNull(row.current_extension_window),
    bidCount: row.bid_count,
    highestBidder: row.highest_bidder as `0x${string}` | null,
    highestBid: BigInt(row.highest_bid),
    status: row.status,
    winner: row.winner as `0x${string}` | null,
    settledAmount: toBigIntOrNull(row.settled_amount),
    createdTxHash: row.created_tx_hash as `0x${string}` | null,
    createdBlock: toBigIntOrNull(row.created_block),
    createdAt: row.created_at,
    updatedBlock: BigInt(row.updated_block),
    updatedAt: row.updated_at,
  };
}

function toMarketplaceListingRecord(row: {
  chain_id: number;
  listing_id: string;
  node: string;
  name: string;
  fqdn: string;
  seller: string;
  price: string;
  status: string;
  buyer: string | null;
  purchased_price: string | null;
  created_tx_hash: string | null;
  created_block: string | null;
  created_at: string | null;
  updated_block: string;
  updated_at: string;
}): RnsMarketplaceListingRecord {
  return {
    chainId: row.chain_id,
    listingId: BigInt(row.listing_id),
    node: row.node as `0x${string}`,
    name: row.name,
    fqdn: row.fqdn,
    seller: row.seller as `0x${string}`,
    price: BigInt(row.price),
    status: row.status,
    buyer: row.buyer as `0x${string}` | null,
    purchasedPrice: toBigIntOrNull(row.purchased_price),
    createdTxHash: row.created_tx_hash as `0x${string}` | null,
    createdBlock: toBigIntOrNull(row.created_block),
    createdAt: row.created_at,
    updatedBlock: BigInt(row.updated_block),
    updatedAt: row.updated_at,
  };
}

function toMarketplaceAuctionRecord(row: {
  chain_id: number;
  auction_id: string;
  node: string;
  name: string;
  fqdn: string;
  seller: string;
  reserve_price: string;
  start_time: string;
  end_time: string;
  current_extension_window: string | null;
  bid_count: number;
  highest_bidder: string | null;
  highest_bid: string;
  status: string;
  winner: string | null;
  settled_amount: string | null;
  created_tx_hash: string | null;
  created_block: string | null;
  created_at: string | null;
  updated_block: string;
  updated_at: string;
}): RnsMarketplaceAuctionRecord {
  return {
    chainId: row.chain_id,
    auctionId: BigInt(row.auction_id),
    node: row.node as `0x${string}`,
    name: row.name,
    fqdn: row.fqdn,
    seller: row.seller as `0x${string}`,
    reservePrice: BigInt(row.reserve_price),
    startTime: BigInt(row.start_time),
    endTime: BigInt(row.end_time),
    currentExtensionWindow: toBigIntOrNull(row.current_extension_window),
    bidCount: row.bid_count,
    highestBidder: row.highest_bidder as `0x${string}` | null,
    highestBid: BigInt(row.highest_bid),
    status: row.status,
    winner: row.winner as `0x${string}` | null,
    settledAmount: toBigIntOrNull(row.settled_amount),
    createdTxHash: row.created_tx_hash as `0x${string}` | null,
    createdBlock: toBigIntOrNull(row.created_block),
    createdAt: row.created_at,
    updatedBlock: BigInt(row.updated_block),
    updatedAt: row.updated_at,
  };
}

function toNotificationSubscription(row: {
  id: string | number;
  chain_id: number;
  scope: RnsNotificationScope;
  email: string;
  wallet: string | null;
  node: string | null;
  name: string | null;
  auction_id: string;
  listing_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}): RnsNotificationSubscription {
  return {
    id: Number(row.id),
    chainId: row.chain_id,
    scope: row.scope,
    email: row.email,
    wallet: row.wallet as `0x${string}` | null,
    node: row.node as `0x${string}` | null,
    name: row.name,
    auctionId: BigInt(row.auction_id),
    listingId: BigInt(row.listing_id),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReservedNameRecord(row: {
  id: string | number;
  chain_id: number;
  label: string;
  fqdn: string;
  category: string;
  enabled: boolean;
  sale_mode: RnsReservedSaleMode;
  reserve_price_wei: string | null;
  fixed_price_wei: string | null;
  auction_duration_seconds: string;
  notes: string | null;
  display_order: number;
  primary_auction_id?: string | null;
  activation_tx_hash?: string | null;
  activated_at?: string | null;
  created_at: string;
  updated_at: string;
}): RnsReservedNameRecord {
  return {
    id: Number(row.id),
    chainId: row.chain_id,
    label: row.label,
    fqdn: row.fqdn,
    category: row.category,
    enabled: row.enabled,
    saleMode: row.sale_mode,
    reservePrice: row.reserve_price_wei ? BigInt(row.reserve_price_wei) : null,
    fixedPrice: row.fixed_price_wei ? BigInt(row.fixed_price_wei) : null,
    auctionDurationSeconds: BigInt(row.auction_duration_seconds),
    notes: row.notes,
    displayOrder: row.display_order,
    primaryAuctionId: row.primary_auction_id ? BigInt(row.primary_auction_id) : null,
    activationTxHash: row.activation_tx_hash as `0x${string}` | null,
    activatedAt: row.activated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getRnsSyncStates(chainId: number) {
  const result = await pool.query<{
    job_name: RnsJobName;
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
  jobName: RnsJobName;
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
      on conflict (job_name, chain_id, contract_address)
      do update set
        last_processed_block = greatest(stage0_rns.sync_state.last_processed_block, excluded.last_processed_block),
        last_processed_block_hash = case
          when excluded.last_processed_block >= stage0_rns.sync_state.last_processed_block
            then excluded.last_processed_block_hash
          else stage0_rns.sync_state.last_processed_block_hash
        end,
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
        owner = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.owner
          else stage0_rns.names.owner
        end,
        expiry = greatest(stage0_rns.names.expiry, excluded.expiry),
        resolver = coalesce(excluded.resolver, stage0_rns.names.resolver),
        registered_tx_hash = case
          when stage0_rns.names.registered_tx_hash is null
            or excluded.registered_block >= coalesce(stage0_rns.names.registered_block, 0)
          then excluded.registered_tx_hash
          else stage0_rns.names.registered_tx_hash
        end,
        registered_block = case
          when stage0_rns.names.registered_block is null
            or excluded.registered_block >= coalesce(stage0_rns.names.registered_block, 0)
            or stage0_rns.names.registered_tx_hash is null
          then excluded.registered_block
          else stage0_rns.names.registered_block
        end,
        registered_at = case
          when stage0_rns.names.registered_at is null
            or excluded.registered_block >= coalesce(stage0_rns.names.registered_block, 0)
          then excluded.registered_at
          else stage0_rns.names.registered_at
        end,
        released_tx_hash = case
          when excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_tx_hash
        end,
        released_block = case
          when excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_block
        end,
        released_at = case
          when excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_at
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
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
        expiry = greatest(stage0_rns.names.expiry, excluded.expiry),
        renewed_tx_hash = case
          when excluded.renewed_block >= coalesce(stage0_rns.names.renewed_block, 0) then excluded.renewed_tx_hash
          else stage0_rns.names.renewed_tx_hash
        end,
        renewed_block = greatest(coalesce(stage0_rns.names.renewed_block, 0), excluded.renewed_block),
        renewed_at = case
          when excluded.renewed_block >= coalesce(stage0_rns.names.renewed_block, 0) then excluded.renewed_at
          else stage0_rns.names.renewed_at
        end,
        released_tx_hash = case
          when excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_tx_hash
        end,
        released_block = case
          when excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_block
        end,
        released_at = case
          when excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_at
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
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
        owner = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.owner
          else stage0_rns.names.owner
        end,
        expiry = case
          when excluded.updated_block >= stage0_rns.names.updated_block then 0
          else stage0_rns.names.expiry
        end,
        resolved_address = case
          when excluded.updated_block >= stage0_rns.names.updated_block then null
          else stage0_rns.names.resolved_address
        end,
        released_tx_hash = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.released_tx_hash
          else stage0_rns.names.released_tx_hash
        end,
        released_block = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.released_block
          else stage0_rns.names.released_block
        end,
        released_at = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.released_at
          else stage0_rns.names.released_at
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
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
      values ($1, lower($2), $3, lower($4), 0, $5, now())
      on conflict (chain_id, node)
      do update set
        owner = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.owner
          else stage0_rns.names.owner
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
        updated_at = now()
    `,
    [input.chainId, input.node, ZERO_ADDRESS, input.owner, input.blockNumber.toString()],
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
        resolver = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.resolver
          else stage0_rns.names.resolver
        end,
        resolved_address = case
          when excluded.updated_block < stage0_rns.names.updated_block then stage0_rns.names.resolved_address
          when excluded.resolver is null then null
          else stage0_rns.names.resolved_address
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
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
        resolved_address = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.resolved_address
          else stage0_rns.names.resolved_address
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
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
    owner: `0x${string}` | null;
    resolver: `0x${string}` | null;
    resolvedAddress: `0x${string}` | null;
    expiry: bigint | null;
    updatedBlock: bigint;
    ownerKnown: boolean;
    resolverKnown: boolean;
    resolvedAddressKnown: boolean;
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
      values ($1, lower($2), $3, $4, $5, coalesce(lower($6), $14), coalesce($7, 0), lower($8), lower($9), $10, now())
      on conflict (chain_id, node)
      do update set
        label = coalesce(excluded.label, stage0_rns.names.label),
        fqdn = coalesce(excluded.fqdn, stage0_rns.names.fqdn),
        owner = case
          when $11 and excluded.updated_block >= stage0_rns.names.updated_block then excluded.owner
          else stage0_rns.names.owner
        end,
        expiry = case
          when excluded.expiry is not null
            and (excluded.updated_block >= stage0_rns.names.updated_block or excluded.expiry > stage0_rns.names.expiry)
          then excluded.expiry
          else stage0_rns.names.expiry
        end,
        resolver = case
          when $12 and excluded.updated_block >= stage0_rns.names.updated_block then excluded.resolver
          else stage0_rns.names.resolver
        end,
        resolved_address = case
          when $13 and excluded.updated_block >= stage0_rns.names.updated_block then excluded.resolved_address
          else stage0_rns.names.resolved_address
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
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
      input.ownerKnown,
      input.resolverKnown,
      input.resolvedAddressKnown,
      ZERO_ADDRESS,
    ],
  );
}

export async function upsertRnsKnownLabelSnapshot(
  db: Queryable,
  input: {
    chainId: number;
    node: `0x${string}`;
    label: string;
    fqdn: string;
    owner: `0x${string}`;
    resolver: `0x${string}` | null;
    resolvedAddress: `0x${string}` | null;
    expiry: bigint;
    blockNumber: bigint;
    minRegisteredBlock: bigint;
    resolverKnown: boolean;
    resolvedAddressKnown: boolean;
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
        registered_block,
        updated_block,
        updated_at
      )
      values ($1, lower($2), lower($3), lower($4), lower($5), lower($5), $6, lower($7), lower($8), $9, $10, now())
      on conflict (chain_id, node)
      do update set
        label = excluded.label,
        fqdn = excluded.fqdn,
        registrant = case
          when stage0_rns.names.registrant = $11 then excluded.registrant
          else stage0_rns.names.registrant
        end,
        owner = case
          when excluded.updated_block >= stage0_rns.names.updated_block then excluded.owner
          else stage0_rns.names.owner
        end,
        expiry = case
          when excluded.updated_block >= stage0_rns.names.updated_block or excluded.expiry > stage0_rns.names.expiry
          then excluded.expiry
          else stage0_rns.names.expiry
        end,
        resolver = case
          when $12 and excluded.updated_block >= stage0_rns.names.updated_block then excluded.resolver
          else coalesce(stage0_rns.names.resolver, excluded.resolver)
        end,
        resolved_address = case
          when $13 and excluded.updated_block >= stage0_rns.names.updated_block then excluded.resolved_address
          else coalesce(stage0_rns.names.resolved_address, excluded.resolved_address)
        end,
        registered_block = case
          when stage0_rns.names.registered_block is null
            or stage0_rns.names.registered_block < $9
          then excluded.registered_block
          else stage0_rns.names.registered_block
        end,
        released_tx_hash = case
          when excluded.expiry > 0 and excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_tx_hash
        end,
        released_block = case
          when excluded.expiry > 0 and excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_block
        end,
        released_at = case
          when excluded.expiry > 0 and excluded.updated_block >= coalesce(stage0_rns.names.released_block, 0) then null
          else stage0_rns.names.released_at
        end,
        updated_block = greatest(stage0_rns.names.updated_block, excluded.updated_block),
        updated_at = now()
    `,
    [
      input.chainId,
      input.node,
      input.label,
      input.fqdn,
      input.owner,
      input.expiry.toString(),
      input.resolver,
      input.resolvedAddress,
      input.minRegisteredBlock.toString(),
      input.blockNumber.toString(),
      ZERO_ADDRESS,
      input.resolverKnown,
      input.resolvedAddressKnown,
    ],
  );
}

export async function getRnsOwnedNames(input: {
  chainId: number;
  owner: string;
  nowUnix: bigint;
  minRegisteredBlock: bigint;
}) {
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
    updated_block: string | null;
    updated_at: string;
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
        registered_block::text,
        updated_block::text,
        updated_at
      from stage0_rns.names
      where chain_id = $1
        and owner = lower($2)
        and released_at is null
        and expiry > $3
        and registered_block >= $4
      order by expiry desc, label asc nulls last, node asc
    `,
    [input.chainId, input.owner, input.nowUnix.toString(), input.minRegisteredBlock.toString()],
  );

  return result.rows.map(toNameRecord);
}

export async function getRnsMarketplaceNamesBySeller(input: {
  chainId: number;
  seller: string;
  nowUnix: bigint;
  escrowOwner: string;
  minRegisteredBlock: bigint;
}) {
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
    updated_block: string | null;
    updated_at: string;
    custody: "marketplace_listing" | "marketplace_auction";
    seller: string;
    marketplace_kind: "listing" | "auction";
    marketplace_status: string;
    listing_id: string | null;
    auction_id: string | null;
    price: string | null;
    reserve_price: string | null;
    start_time: string | null;
    end_time: string | null;
    current_extension_window: string | null;
    bid_count: number | null;
    highest_bidder: string | null;
    highest_bid: string | null;
    buyer: string | null;
    purchased_price: string | null;
    winner: string | null;
    settled_amount: string | null;
    marketplace_created_tx_hash: string | null;
    marketplace_created_block: string | null;
    marketplace_created_at: string | null;
    marketplace_updated_block: string;
    marketplace_updated_at: string;
  }>(
    `
      with escrowed as (
        select
          l.chain_id,
          l.node,
          l.name,
          l.fqdn,
          l.seller,
          'marketplace_listing'::text as custody,
          'listing'::text as marketplace_kind,
          l.status as marketplace_status,
          l.listing_id::text,
          null::text as auction_id,
          l.price::text,
          null::text as reserve_price,
          null::text as start_time,
          null::text as end_time,
          null::text as current_extension_window,
          null::integer as bid_count,
          null::text as highest_bidder,
          null::text as highest_bid,
          l.buyer,
          l.purchased_price::text,
          null::text as winner,
          null::text as settled_amount,
          l.created_tx_hash as marketplace_created_tx_hash,
          l.created_block::text as marketplace_created_block,
          l.created_at as marketplace_created_at,
          l.updated_block::text as marketplace_updated_block,
          l.updated_at as marketplace_updated_at
        from stage0_rns.marketplace_listings l
        where l.chain_id = $1
          and l.seller = lower($2)
          and l.status = 'active'

        union all

        select
          a.chain_id,
          a.node,
          a.name,
          a.fqdn,
          a.seller,
          'marketplace_auction'::text as custody,
          'auction'::text as marketplace_kind,
          a.status as marketplace_status,
          null::text as listing_id,
          a.auction_id::text,
          null::text as price,
          a.reserve_price::text,
          a.start_time::text,
          a.end_time::text,
          a.current_extension_window::text,
          a.bid_count,
          a.highest_bidder,
          a.highest_bid::text,
          null::text as buyer,
          null::text as purchased_price,
          a.winner,
          a.settled_amount::text,
          a.created_tx_hash as marketplace_created_tx_hash,
          a.created_block::text as marketplace_created_block,
          a.created_at as marketplace_created_at,
          a.updated_block::text as marketplace_updated_block,
          a.updated_at as marketplace_updated_at
        from stage0_rns.marketplace_auctions a
        where a.chain_id = $1
          and a.seller = lower($2)
          and a.status not in ('cancelled', 'settled')
      )
      select
        e.chain_id,
        e.node,
        coalesce(n.label, e.name) as label,
        coalesce(n.fqdn, e.fqdn) as fqdn,
        case when n.registrant is null or n.registrant = '${ZERO_ADDRESS}' then e.seller else n.registrant end as registrant,
        case when n.owner is null or n.owner = '${ZERO_ADDRESS}' then lower($4) else n.owner end as owner,
        coalesce(n.expiry, 0)::text as expiry,
        n.resolver,
        n.resolved_address,
        n.registered_tx_hash,
        case when n.registered_at is null then null else extract(epoch from n.registered_at)::bigint::text end as registered_at,
        case when n.renewed_at is null then null else extract(epoch from n.renewed_at)::bigint::text end as renewed_at,
        case when n.released_at is null then null else extract(epoch from n.released_at)::bigint::text end as released_at,
        coalesce(n.registered_block, 0)::text as registered_block,
        greatest(coalesce(n.updated_block, 0), e.marketplace_updated_block::bigint)::text as updated_block,
        coalesce(n.updated_at, e.marketplace_updated_at, now()) as updated_at,
        e.custody as custody,
        e.seller,
        e.marketplace_kind,
        e.marketplace_status,
        e.listing_id,
        e.auction_id,
        e.price,
        e.reserve_price,
        e.start_time,
        e.end_time,
        e.current_extension_window,
        e.bid_count,
        e.highest_bidder,
        e.highest_bid,
        e.buyer,
        e.purchased_price,
        e.winner,
        e.settled_amount,
        e.marketplace_created_tx_hash,
        e.marketplace_created_block,
        e.marketplace_created_at,
        e.marketplace_updated_block,
        e.marketplace_updated_at
      from escrowed e
      left join stage0_rns.names n
        on n.chain_id = e.chain_id
       and n.node = e.node
       and n.registered_block >= $5
      where n.node is null
         or (n.released_at is null and (n.expiry = 0 or n.expiry > $3))
      order by updated_block desc, label asc nulls last, node asc
    `,
    [
      input.chainId,
      input.seller,
      input.nowUnix.toString(),
      input.escrowOwner,
      input.minRegisteredBlock.toString(),
    ],
  );

  return result.rows.map((row): RnsNameRecord => {
    const base = toNameRecord(row);
    const seller = row.seller as `0x${string}`;

    if (row.marketplace_kind === "listing") {
      return {
        ...base,
        custody: "marketplace_listing",
        seller,
        marketplace: {
          kind: "listing",
          listingId: BigInt(row.listing_id ?? "0"),
          status: row.marketplace_status,
          seller,
          price: BigInt(row.price ?? "0"),
          buyer: row.buyer as `0x${string}` | null,
          purchasedPrice: toBigIntOrNull(row.purchased_price),
          createdTxHash: row.marketplace_created_tx_hash as `0x${string}` | null,
          createdBlock: toBigIntOrNull(row.marketplace_created_block),
          createdAt: row.marketplace_created_at,
          updatedBlock: BigInt(row.marketplace_updated_block),
          updatedAt: row.marketplace_updated_at,
        },
      };
    }

    return {
      ...base,
      custody: "marketplace_auction",
      seller,
      marketplace: {
        kind: "auction",
        auctionId: BigInt(row.auction_id ?? "0"),
        status: row.marketplace_status,
        seller,
        reservePrice: BigInt(row.reserve_price ?? "0"),
        startTime: BigInt(row.start_time ?? "0"),
        endTime: BigInt(row.end_time ?? "0"),
        currentExtensionWindow: toBigIntOrNull(row.current_extension_window),
        bidCount: row.bid_count ?? 0,
        highestBidder: row.highest_bidder as `0x${string}` | null,
        highestBid: BigInt(row.highest_bid ?? "0"),
        winner: row.winner as `0x${string}` | null,
        settledAmount: toBigIntOrNull(row.settled_amount),
        createdTxHash: row.marketplace_created_tx_hash as `0x${string}` | null,
        createdBlock: toBigIntOrNull(row.marketplace_created_block),
        createdAt: row.marketplace_created_at,
        updatedBlock: BigInt(row.marketplace_updated_block),
        updatedAt: row.marketplace_updated_at,
      },
    };
  });
}

export async function getRnsNameByLabel(input: {
  chainId: number;
  label: string;
  minRegisteredBlock: bigint;
}) {
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
    updated_block: string | null;
    updated_at: string;
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
        registered_block::text,
        updated_block::text,
        updated_at
      from stage0_rns.names
      where chain_id = $1
        and label = lower($2)
        and registered_block >= $3
      limit 1
    `,
    [input.chainId, input.label, input.minRegisteredBlock.toString()],
  );

  return result.rows[0] ? toNameRecord(result.rows[0]) : null;
}

export async function getRnsPrimaryNameForAddress(input: {
  chainId: number;
  address: string;
  nowUnix: bigint;
  minRegisteredBlock: bigint;
}) {
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
    updated_block: string | null;
    updated_at: string;
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
        registered_block::text,
        updated_block::text,
        updated_at
      from stage0_rns.names
      where chain_id = $1
        and owner = lower($2)
        and resolved_address = lower($2)
        and released_at is null
        and expiry > $3
        and registered_block >= $4
      order by length(label) asc nulls last, expiry desc, label asc nulls last, node asc
      limit 1
    `,
    [input.chainId, input.address, input.nowUnix.toString(), input.minRegisteredBlock.toString()],
  );

  return result.rows[0] ? toNameRecord(result.rows[0]) : null;
}

export async function getRnsNamesForReconciliation(chainId: number, minRegisteredBlock: bigint) {
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
        and registered_block >= $2
      order by updated_block asc, node asc
    `,
    [chainId, minRegisteredBlock.toString()],
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

export async function getRnsNameCount(chainId: number, minRegisteredBlock: bigint) {
  const result = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from stage0_rns.names
      where chain_id = $1
        and registered_block >= $2
    `,
    [chainId, minRegisteredBlock.toString()],
  );

  return Number(result.rows[0]?.count ?? "0");
}

export async function recordRnsMarketplaceEvent(
  db: Queryable,
  input: {
    chainId: number;
    source: "primary_auction" | "marketplace";
    entityType: string;
    eventType: string;
    entityId?: bigint | null;
    name?: string | null;
    account?: `0x${string}` | null;
    counterparty?: `0x${string}` | null;
    amount?: bigint | null;
    txHash: `0x${string}`;
    blockNumber: bigint;
    logIndex: number;
    blockTime: Date;
    payload?: unknown;
  },
) {
  await db.query(
    `
      insert into stage0_rns.marketplace_events (
        chain_id,
        source,
        entity_type,
        event_type,
        entity_id,
        name,
        account,
        counterparty,
        amount,
        tx_hash,
        block_number,
        log_index,
        block_time,
        payload
      )
      values ($1, $2, $3, $4, $5, $6, lower($7), lower($8), $9, lower($10), $11, $12, $13, $14::jsonb)
      on conflict (chain_id, source, tx_hash, log_index) do nothing
    `,
    [
      input.chainId,
      input.source,
      input.entityType,
      input.eventType,
      input.entityId?.toString() ?? null,
      input.name ?? null,
      input.account ?? null,
      input.counterparty ?? null,
      input.amount?.toString() ?? null,
      input.txHash,
      input.blockNumber.toString(),
      input.logIndex,
      input.blockTime.toISOString(),
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export async function upsertRnsPrimaryAuction(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    name: string;
    duration: bigint;
    reservePrice: bigint;
    startTime: bigint;
    endTime: bigint;
    txHash: `0x${string}`;
    blockNumber: bigint;
    blockTime: Date;
  },
) {
  await db.query(
    `
      insert into stage0_rns.primary_auctions (
        chain_id,
        auction_id,
        name,
        fqdn,
        duration,
        reserve_price,
        start_time,
        end_time,
        status,
        created_tx_hash,
        created_block,
        created_at,
        updated_block,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', lower($9), $10, $11, $10, now())
      on conflict (chain_id, auction_id)
      do update set
        name = excluded.name,
        fqdn = excluded.fqdn,
        duration = excluded.duration,
        reserve_price = excluded.reserve_price,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        created_tx_hash = excluded.created_tx_hash,
        created_block = excluded.created_block,
        created_at = excluded.created_at,
        updated_block = excluded.updated_block,
        updated_at = now()
      where stage0_rns.primary_auctions.updated_block <= excluded.updated_block
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.name,
      `${input.name}.rise`,
      input.duration.toString(),
      input.reservePrice.toString(),
      input.startTime.toString(),
      input.endTime.toString(),
      input.txHash,
      input.blockNumber.toString(),
      input.blockTime.toISOString(),
    ],
  );
}

export async function upsertRnsPrimaryAuctionSnapshot(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    name: string;
    duration: bigint;
    reservePrice: bigint;
    startTime: bigint;
    endTime: bigint;
    currentExtensionWindow: bigint;
    bidCount: number;
    highestBidder: `0x${string}` | null;
    highestBid: bigint;
    status: string;
    winner: `0x${string}` | null;
    settledAmount: bigint | null;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.primary_auctions (
        chain_id,
        auction_id,
        name,
        fqdn,
        duration,
        reserve_price,
        start_time,
        end_time,
        current_extension_window,
        bid_count,
        highest_bidder,
        highest_bid,
        status,
        winner,
        settled_amount,
        updated_block,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, lower($11), $12, $13, lower($14), $15, $16, now())
      on conflict (chain_id, auction_id)
      do update set
        name = excluded.name,
        fqdn = excluded.fqdn,
        duration = excluded.duration,
        reserve_price = excluded.reserve_price,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        current_extension_window = excluded.current_extension_window,
        bid_count = excluded.bid_count,
        highest_bidder = excluded.highest_bidder,
        highest_bid = excluded.highest_bid,
        status = excluded.status,
        winner = excluded.winner,
        settled_amount = excluded.settled_amount,
        updated_block = excluded.updated_block,
        updated_at = now()
      where stage0_rns.primary_auctions.updated_block <= excluded.updated_block
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.name,
      `${input.name}.rise`,
      input.duration.toString(),
      input.reservePrice.toString(),
      input.startTime.toString(),
      input.endTime.toString(),
      input.currentExtensionWindow.toString(),
      input.bidCount,
      input.highestBidder,
      input.highestBid.toString(),
      input.status,
      input.winner,
      input.settledAmount?.toString() ?? null,
      input.blockNumber.toString(),
    ],
  );
}

export async function applyRnsPrimaryAuctionBid(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    bidder: `0x${string}`;
    amount: bigint;
    endTime: bigint;
    nextExtensionWindow: bigint;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      update stage0_rns.primary_auctions
      set
        highest_bidder = lower($3),
        highest_bid = $4,
        end_time = $5,
        current_extension_window = $6,
        bid_count = bid_count + 1,
        status = 'active',
        updated_block = $7,
        updated_at = now()
      where chain_id = $1 and auction_id = $2
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.bidder,
      input.amount.toString(),
      input.endTime.toString(),
      input.nextExtensionWindow.toString(),
      input.blockNumber.toString(),
    ],
  );
}

export async function applyRnsPrimaryAuctionCancelled(
  db: Queryable,
  input: { chainId: number; auctionId: bigint; blockNumber: bigint },
) {
  await db.query(
    `
      update stage0_rns.primary_auctions
      set status = 'cancelled', updated_block = $3, updated_at = now()
      where chain_id = $1 and auction_id = $2
    `,
    [input.chainId, input.auctionId.toString(), input.blockNumber.toString()],
  );
}

export async function applyRnsPrimaryAuctionSettled(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    winner: `0x${string}`;
    amount: bigint;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      update stage0_rns.primary_auctions
      set
        status = 'settled',
        winner = lower($3),
        settled_amount = $4,
        updated_block = $5,
        updated_at = now()
      where chain_id = $1 and auction_id = $2
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.winner,
      input.amount.toString(),
      input.blockNumber.toString(),
    ],
  );
}

export async function upsertRnsMarketplaceListing(
  db: Queryable,
  input: {
    chainId: number;
    listingId: bigint;
    node: `0x${string}`;
    name: string;
    seller: `0x${string}`;
    price: bigint;
    txHash: `0x${string}`;
    blockNumber: bigint;
    blockTime: Date;
  },
) {
  await db.query(
    `
      insert into stage0_rns.marketplace_listings (
        chain_id,
        listing_id,
        node,
        name,
        fqdn,
        seller,
        price,
        status,
        created_tx_hash,
        created_block,
        created_at,
        updated_block,
        updated_at
      )
      values ($1, $2, lower($3), $4, $5, lower($6), $7, 'active', lower($8), $9, $10, $9, now())
      on conflict (chain_id, listing_id)
      do update set
        node = excluded.node,
        name = excluded.name,
        fqdn = excluded.fqdn,
        seller = excluded.seller,
        price = excluded.price,
        status = 'active',
        buyer = null,
        purchased_price = null,
        created_tx_hash = excluded.created_tx_hash,
        created_block = excluded.created_block,
        created_at = excluded.created_at,
        updated_block = excluded.updated_block,
        updated_at = now()
      where stage0_rns.marketplace_listings.updated_block <= excluded.updated_block
    `,
    [
      input.chainId,
      input.listingId.toString(),
      input.node,
      input.name,
      `${input.name}.rise`,
      input.seller,
      input.price.toString(),
      input.txHash,
      input.blockNumber.toString(),
      input.blockTime.toISOString(),
    ],
  );
}

export async function upsertRnsMarketplaceListingSnapshot(
  db: Queryable,
  input: {
    chainId: number;
    listingId: bigint;
    node: `0x${string}`;
    name: string;
    seller: `0x${string}`;
    price: bigint;
    active: boolean;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.marketplace_listings (
        chain_id,
        listing_id,
        node,
        name,
        fqdn,
        seller,
        price,
        status,
        updated_block,
        updated_at
      )
      values ($1, $2, lower($3), $4, $5, lower($6), $7, $8, $9, now())
      on conflict (chain_id, listing_id)
      do update set
        node = excluded.node,
        name = excluded.name,
        fqdn = excluded.fqdn,
        seller = excluded.seller,
        price = excluded.price,
        status = case
          when excluded.status = 'active' then 'active'
          when stage0_rns.marketplace_listings.status in ('purchased', 'cancelled')
            then stage0_rns.marketplace_listings.status
          else 'inactive'
        end,
        updated_block = excluded.updated_block,
        updated_at = now()
      where stage0_rns.marketplace_listings.updated_block <= excluded.updated_block
    `,
    [
      input.chainId,
      input.listingId.toString(),
      input.node,
      input.name,
      `${input.name}.rise`,
      input.seller,
      input.price.toString(),
      input.active ? "active" : "inactive",
      input.blockNumber.toString(),
    ],
  );
}

export async function applyRnsMarketplaceListingCancelled(
  db: Queryable,
  input: { chainId: number; listingId: bigint; blockNumber: bigint },
) {
  await db.query(
    `
      update stage0_rns.marketplace_listings
      set status = 'cancelled', updated_block = $3, updated_at = now()
      where chain_id = $1 and listing_id = $2
    `,
    [input.chainId, input.listingId.toString(), input.blockNumber.toString()],
  );
}

export async function applyRnsMarketplaceListingPurchased(
  db: Queryable,
  input: {
    chainId: number;
    listingId: bigint;
    buyer: `0x${string}`;
    price: bigint;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      update stage0_rns.marketplace_listings
      set
        status = 'purchased',
        buyer = lower($3),
        purchased_price = $4,
        updated_block = $5,
        updated_at = now()
      where chain_id = $1 and listing_id = $2
    `,
    [
      input.chainId,
      input.listingId.toString(),
      input.buyer,
      input.price.toString(),
      input.blockNumber.toString(),
    ],
  );
}

export async function upsertRnsMarketplaceAuction(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    node: `0x${string}`;
    name: string;
    seller: `0x${string}`;
    reservePrice: bigint;
    startTime: bigint;
    endTime: bigint;
    txHash: `0x${string}`;
    blockNumber: bigint;
    blockTime: Date;
  },
) {
  await db.query(
    `
      insert into stage0_rns.marketplace_auctions (
        chain_id,
        auction_id,
        node,
        name,
        fqdn,
        seller,
        reserve_price,
        start_time,
        end_time,
        status,
        created_tx_hash,
        created_block,
        created_at,
        updated_block,
        updated_at
      )
      values ($1, $2, lower($3), $4, $5, lower($6), $7, $8, $9, 'scheduled', lower($10), $11, $12, $11, now())
      on conflict (chain_id, auction_id)
      do update set
        node = excluded.node,
        name = excluded.name,
        fqdn = excluded.fqdn,
        seller = excluded.seller,
        reserve_price = excluded.reserve_price,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        created_tx_hash = excluded.created_tx_hash,
        created_block = excluded.created_block,
        created_at = excluded.created_at,
        updated_block = excluded.updated_block,
        updated_at = now()
      where stage0_rns.marketplace_auctions.updated_block <= excluded.updated_block
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.node,
      input.name,
      `${input.name}.rise`,
      input.seller,
      input.reservePrice.toString(),
      input.startTime.toString(),
      input.endTime.toString(),
      input.txHash,
      input.blockNumber.toString(),
      input.blockTime.toISOString(),
    ],
  );
}

export async function upsertRnsMarketplaceAuctionSnapshot(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    node: `0x${string}`;
    name: string;
    seller: `0x${string}`;
    reservePrice: bigint;
    startTime: bigint;
    endTime: bigint;
    currentExtensionWindow: bigint;
    bidCount: number;
    highestBidder: `0x${string}` | null;
    highestBid: bigint;
    status: string;
    winner: `0x${string}` | null;
    settledAmount: bigint | null;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      insert into stage0_rns.marketplace_auctions (
        chain_id,
        auction_id,
        node,
        name,
        fqdn,
        seller,
        reserve_price,
        start_time,
        end_time,
        current_extension_window,
        bid_count,
        highest_bidder,
        highest_bid,
        status,
        winner,
        settled_amount,
        updated_block,
        updated_at
      )
      values ($1, $2, lower($3), $4, $5, lower($6), $7, $8, $9, $10, $11, lower($12), $13, $14, lower($15), $16, $17, now())
      on conflict (chain_id, auction_id)
      do update set
        node = excluded.node,
        name = excluded.name,
        fqdn = excluded.fqdn,
        seller = excluded.seller,
        reserve_price = excluded.reserve_price,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        current_extension_window = excluded.current_extension_window,
        bid_count = excluded.bid_count,
        highest_bidder = excluded.highest_bidder,
        highest_bid = excluded.highest_bid,
        status = excluded.status,
        winner = excluded.winner,
        settled_amount = excluded.settled_amount,
        updated_block = excluded.updated_block,
        updated_at = now()
      where stage0_rns.marketplace_auctions.updated_block <= excluded.updated_block
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.node,
      input.name,
      `${input.name}.rise`,
      input.seller,
      input.reservePrice.toString(),
      input.startTime.toString(),
      input.endTime.toString(),
      input.currentExtensionWindow.toString(),
      input.bidCount,
      input.highestBidder,
      input.highestBid.toString(),
      input.status,
      input.winner,
      input.settledAmount?.toString() ?? null,
      input.blockNumber.toString(),
    ],
  );
}

export async function applyRnsMarketplaceAuctionBid(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    bidder: `0x${string}`;
    amount: bigint;
    endTime: bigint;
    nextExtensionWindow: bigint;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      update stage0_rns.marketplace_auctions
      set
        highest_bidder = lower($3),
        highest_bid = $4,
        end_time = $5,
        current_extension_window = $6,
        bid_count = bid_count + 1,
        status = 'active',
        updated_block = $7,
        updated_at = now()
      where chain_id = $1 and auction_id = $2
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.bidder,
      input.amount.toString(),
      input.endTime.toString(),
      input.nextExtensionWindow.toString(),
      input.blockNumber.toString(),
    ],
  );
}

export async function applyRnsMarketplaceAuctionCancelled(
  db: Queryable,
  input: { chainId: number; auctionId: bigint; blockNumber: bigint },
) {
  await db.query(
    `
      update stage0_rns.marketplace_auctions
      set status = 'cancelled', updated_block = $3, updated_at = now()
      where chain_id = $1 and auction_id = $2
    `,
    [input.chainId, input.auctionId.toString(), input.blockNumber.toString()],
  );
}

export async function applyRnsMarketplaceAuctionSettled(
  db: Queryable,
  input: {
    chainId: number;
    auctionId: bigint;
    winner: `0x${string}` | null;
    amount: bigint;
    blockNumber: bigint;
  },
) {
  await db.query(
    `
      update stage0_rns.marketplace_auctions
      set
        status = 'settled',
        winner = lower($3),
        settled_amount = $4,
        updated_block = $5,
        updated_at = now()
      where chain_id = $1 and auction_id = $2
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.winner,
      input.amount.toString(),
      input.blockNumber.toString(),
    ],
  );
}

export async function getRnsPrimaryAuctions(input: { chainId: number; limit: number }) {
  const result = await pool.query(
    `
      select
        chain_id,
        auction_id::text,
        name,
        fqdn,
        duration::text,
        reserve_price::text,
        start_time::text,
        end_time::text,
        current_extension_window::text,
        bid_count,
        highest_bidder,
        highest_bid::text,
        status,
        winner,
        settled_amount::text,
        created_tx_hash,
        created_block::text,
        created_at,
        updated_block::text,
        updated_at
      from stage0_rns.primary_auctions
      where chain_id = $1
      order by updated_block desc, auction_id desc
      limit $2
    `,
    [input.chainId, input.limit],
  );

  return result.rows.map(toPrimaryAuctionRecord);
}

export async function getRnsMarketplaceListings(input: { chainId: number; limit: number }) {
  const result = await pool.query(
    `
      select
        chain_id,
        listing_id::text,
        node,
        name,
        fqdn,
        seller,
        price::text,
        status,
        buyer,
        purchased_price::text,
        created_tx_hash,
        created_block::text,
        created_at,
        updated_block::text,
        updated_at
      from stage0_rns.marketplace_listings
      where chain_id = $1
      order by updated_block desc, listing_id desc
      limit $2
    `,
    [input.chainId, input.limit],
  );

  return result.rows.map(toMarketplaceListingRecord);
}

export async function getRnsMarketplaceAuctions(input: { chainId: number; limit: number }) {
  const result = await pool.query(
    `
      select
        chain_id,
        auction_id::text,
        node,
        name,
        fqdn,
        seller,
        reserve_price::text,
        start_time::text,
        end_time::text,
        current_extension_window::text,
        bid_count,
        highest_bidder,
        highest_bid::text,
        status,
        winner,
        settled_amount::text,
        created_tx_hash,
        created_block::text,
        created_at,
        updated_block::text,
        updated_at
      from stage0_rns.marketplace_auctions
      where chain_id = $1
      order by updated_block desc, auction_id desc
      limit $2
    `,
    [input.chainId, input.limit],
  );

  return result.rows.map(toMarketplaceAuctionRecord);
}

export async function getRnsMarketplaceEvents(input: { chainId: number; limit: number }) {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    source: string;
    entity_type: string;
    event_type: string;
    entity_id: string | null;
    name: string | null;
    account: string | null;
    counterparty: string | null;
    amount: string | null;
    tx_hash: string;
    block_number: string;
    log_index: number;
    block_time: string | null;
    payload: unknown;
  }>(
    `
      select
        id::text,
        chain_id,
        source,
        entity_type,
        event_type,
        entity_id::text,
        name,
        account,
        counterparty,
        amount::text,
        tx_hash,
        block_number::text,
        log_index,
        block_time,
        payload
      from stage0_rns.marketplace_events
      where chain_id = $1
      order by block_number desc, log_index desc
      limit $2
    `,
    [input.chainId, input.limit],
  );

  return result.rows.map((row) => ({
    id: BigInt(row.id),
    chainId: row.chain_id,
    source: row.source,
    entityType: row.entity_type,
    eventType: row.event_type,
    entityId: toBigIntOrNull(row.entity_id),
    name: row.name,
    account: row.account as `0x${string}` | null,
    counterparty: row.counterparty as `0x${string}` | null,
    amount: toBigIntOrNull(row.amount),
    txHash: row.tx_hash as `0x${string}`,
    blockNumber: BigInt(row.block_number),
    logIndex: row.log_index,
    blockTime: row.block_time,
    payload: row.payload,
  })) satisfies RnsMarketplaceEventRecord[];
}

export async function getRnsPrimaryAuctionById(
  db: Queryable,
  input: { chainId: number; auctionId: bigint },
) {
  const result = await db.query<{
    chain_id: number;
    auction_id: string;
    name: string;
    fqdn: string;
    duration: string;
    reserve_price: string;
    start_time: string;
    end_time: string;
    current_extension_window: string | null;
    bid_count: number;
    highest_bidder: string | null;
    highest_bid: string;
    status: string;
    winner: string | null;
    settled_amount: string | null;
    created_tx_hash: string | null;
    created_block: string | null;
    created_at: string | null;
    updated_block: string;
    updated_at: string;
  }>(
    `
      select
        chain_id,
        auction_id::text,
        name,
        fqdn,
        duration::text,
        reserve_price::text,
        start_time::text,
        end_time::text,
        current_extension_window::text,
        bid_count,
        highest_bidder,
        highest_bid::text,
        status,
        winner,
        settled_amount::text,
        created_tx_hash,
        created_block::text,
        created_at,
        updated_block::text,
        updated_at
      from stage0_rns.primary_auctions
      where chain_id = $1 and auction_id = $2
      limit 1
    `,
    [input.chainId, input.auctionId.toString()],
  );

  return result.rows[0] ? toPrimaryAuctionRecord(result.rows[0]) : null;
}

export async function getRnsMarketplaceListingById(
  db: Queryable,
  input: { chainId: number; listingId: bigint },
) {
  const result = await db.query<{
    chain_id: number;
    listing_id: string;
    node: string;
    name: string;
    fqdn: string;
    seller: string;
    price: string;
    status: string;
    buyer: string | null;
    purchased_price: string | null;
    created_tx_hash: string | null;
    created_block: string | null;
    created_at: string | null;
    updated_block: string;
    updated_at: string;
  }>(
    `
      select
        chain_id,
        listing_id::text,
        node,
        name,
        fqdn,
        seller,
        price::text,
        status,
        buyer,
        purchased_price::text,
        created_tx_hash,
        created_block::text,
        created_at,
        updated_block::text,
        updated_at
      from stage0_rns.marketplace_listings
      where chain_id = $1 and listing_id = $2
      limit 1
    `,
    [input.chainId, input.listingId.toString()],
  );

  return result.rows[0] ? toMarketplaceListingRecord(result.rows[0]) : null;
}

export async function getRnsMarketplaceAuctionById(
  db: Queryable,
  input: { chainId: number; auctionId: bigint },
) {
  const result = await db.query<{
    chain_id: number;
    auction_id: string;
    node: string;
    name: string;
    fqdn: string;
    seller: string;
    reserve_price: string;
    start_time: string;
    end_time: string;
    current_extension_window: string | null;
    bid_count: number;
    highest_bidder: string | null;
    highest_bid: string;
    status: string;
    winner: string | null;
    settled_amount: string | null;
    created_tx_hash: string | null;
    created_block: string | null;
    created_at: string | null;
    updated_block: string;
    updated_at: string;
  }>(
    `
      select
        chain_id,
        auction_id::text,
        node,
        name,
        fqdn,
        seller,
        reserve_price::text,
        start_time::text,
        end_time::text,
        current_extension_window::text,
        bid_count,
        highest_bidder,
        highest_bid::text,
        status,
        winner,
        settled_amount::text,
        created_tx_hash,
        created_block::text,
        created_at,
        updated_block::text,
        updated_at
      from stage0_rns.marketplace_auctions
      where chain_id = $1 and auction_id = $2
      limit 1
    `,
    [input.chainId, input.auctionId.toString()],
  );

  return result.rows[0] ? toMarketplaceAuctionRecord(result.rows[0]) : null;
}

export async function upsertRnsNotificationSubscription(input: {
  chainId: number;
  scope: RnsNotificationScope;
  email: string;
  wallet?: `0x${string}` | null;
  node?: `0x${string}` | null;
  name?: string | null;
  auctionId?: bigint | null;
  listingId?: bigint | null;
}) {
  const email = input.email.trim();
  const emailNormalized = email.toLowerCase();
  const walletNormalized = input.wallet?.toLowerCase() ?? "";
  const nodeNormalized = input.node?.toLowerCase() ?? "";

  const result = await pool.query<{
    id: string;
    chain_id: number;
    scope: RnsNotificationScope;
    email: string;
    wallet: string | null;
    node: string | null;
    name: string | null;
    auction_id: string;
    listing_id: string;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      insert into stage0_rns.notification_subscriptions (
        chain_id,
        scope,
        email,
        email_normalized,
        wallet,
        wallet_normalized,
        node,
        node_normalized,
        name,
        auction_id,
        listing_id,
        active
      )
      values ($1, $2, $3, $4, lower($5), $6, lower($7), $8, $9, $10, $11, true)
      on conflict (chain_id, scope, email_normalized, wallet_normalized, node_normalized, auction_id, listing_id)
      do update set
        email = excluded.email,
        wallet = excluded.wallet,
        node = excluded.node,
        name = coalesce(excluded.name, stage0_rns.notification_subscriptions.name),
        active = true,
        updated_at = now()
      returning
        id::text,
        chain_id,
        scope,
        email,
        wallet,
        node,
        name,
        auction_id::text,
        listing_id::text,
        active,
        created_at,
        updated_at
    `,
    [
      input.chainId,
      input.scope,
      email,
      emailNormalized,
      input.wallet ?? null,
      walletNormalized,
      input.node ?? null,
      nodeNormalized,
      input.name?.toLowerCase() ?? null,
      (input.auctionId ?? 0n).toString(),
      (input.listingId ?? 0n).toString(),
    ],
  );

  return toNotificationSubscription(result.rows[0]);
}

export async function getRnsMarketplaceSellerSubscriptions(input: {
  chainId: number;
  node: `0x${string}`;
}) {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    scope: RnsNotificationScope;
    email: string;
    wallet: string | null;
    node: string | null;
    name: string | null;
    auction_id: string;
    listing_id: string;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      select
        id::text,
        chain_id,
        scope,
        email,
        wallet,
        node,
        name,
        auction_id::text,
        listing_id::text,
        active,
        created_at,
        updated_at
      from stage0_rns.notification_subscriptions
      where chain_id = $1
        and scope = 'marketplace_seller'
        and active = true
        and node_normalized = $2
    `,
    [input.chainId, input.node.toLowerCase()],
  );

  return result.rows.map(toNotificationSubscription);
}

export async function getRnsMarketplaceBidderSubscriptions(input: {
  chainId: number;
  auctionId: bigint;
  name?: string | null;
}) {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    scope: RnsNotificationScope;
    email: string;
    wallet: string | null;
    node: string | null;
    name: string | null;
    auction_id: string;
    listing_id: string;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      select
        id::text,
        chain_id,
        scope,
        email,
        wallet,
        node,
        name,
        auction_id::text,
        listing_id::text,
        active,
        created_at,
        updated_at
      from stage0_rns.notification_subscriptions
      where chain_id = $1
        and scope = 'marketplace_bidder'
        and active = true
        and auction_id = $2
        and ($3 = '' or lower(name) = $3)
    `,
    [
      input.chainId,
      input.auctionId.toString(),
      input.name?.trim().toLowerCase().replace(/\.rise$/i, "") ?? "",
    ],
  );

  return result.rows.map(toNotificationSubscription);
}

export async function getRnsMarketplaceWatcherSubscriptions(input: {
  chainId: number;
  node?: `0x${string}` | null;
  auctionId?: bigint | null;
  name?: string | null;
}) {
  const nodeNormalized = input.node?.toLowerCase() ?? "";
  const auctionId = input.auctionId ?? 0n;
  const nameNormalized = input.name?.trim().toLowerCase().replace(/\.rise$/i, "") ?? "";
  const result = await pool.query<{
    id: string;
    chain_id: number;
    scope: RnsNotificationScope;
    email: string;
    wallet: string | null;
    node: string | null;
    name: string | null;
    auction_id: string;
    listing_id: string;
    active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      select
        id::text,
        chain_id,
        scope,
        email,
        wallet,
        node,
        name,
        auction_id::text,
        listing_id::text,
        active,
        created_at,
        updated_at
      from stage0_rns.notification_subscriptions
      where chain_id = $1
        and scope = 'marketplace_watcher'
        and active = true
        and (
          ($2 <> '' and node_normalized = $2)
          or ($3 > 0 and auction_id = $3)
          or ($4 <> '' and lower(name) = $4)
        )
    `,
    [input.chainId, nodeNormalized, auctionId.toString(), nameNormalized],
  );

  return result.rows.map(toNotificationSubscription);
}

export async function listRnsReservedNames(input: {
  chainId: number;
  enabledOnly?: boolean;
}) {
  const enabledOnly = input.enabledOnly ?? false;
  const result = await pool.query<{
    id: string;
    chain_id: number;
    label: string;
    fqdn: string;
    category: string;
    enabled: boolean;
    sale_mode: RnsReservedSaleMode;
    reserve_price_wei: string | null;
    fixed_price_wei: string | null;
    auction_duration_seconds: string;
    notes: string | null;
    display_order: number;
    primary_auction_id: string | null;
    activation_tx_hash: string | null;
    activated_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      select
        id::text,
        chain_id,
        label,
        fqdn,
        category,
        enabled,
        sale_mode,
        reserve_price_wei::text,
        fixed_price_wei::text,
        auction_duration_seconds::text,
        notes,
        display_order,
        primary_auction_id::text,
        activation_tx_hash,
        activated_at,
        created_at,
        updated_at
      from stage0_rns.reserved_names
      where chain_id = $1
        and ($2 = false or enabled = true)
      order by enabled desc, display_order asc, label asc
    `,
    [input.chainId, enabledOnly],
  );

  return result.rows.map(toReservedNameRecord);
}

export async function getRnsReservedNameById(input: { chainId: number; id: number }) {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    label: string;
    fqdn: string;
    category: string;
    enabled: boolean;
    sale_mode: RnsReservedSaleMode;
    reserve_price_wei: string | null;
    fixed_price_wei: string | null;
    auction_duration_seconds: string;
    notes: string | null;
    display_order: number;
    primary_auction_id: string | null;
    activation_tx_hash: string | null;
    activated_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      select
        id::text,
        chain_id,
        label,
        fqdn,
        category,
        enabled,
        sale_mode,
        reserve_price_wei::text,
        fixed_price_wei::text,
        auction_duration_seconds::text,
        notes,
        display_order,
        primary_auction_id::text,
        activation_tx_hash,
        activated_at,
        created_at,
        updated_at
      from stage0_rns.reserved_names
      where chain_id = $1 and id = $2
      limit 1
    `,
    [input.chainId, input.id],
  );

  return result.rows[0] ? toReservedNameRecord(result.rows[0]) : null;
}

export async function getRnsReservedNameByLabel(input: { chainId: number; label: string }) {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    label: string;
    fqdn: string;
    category: string;
    enabled: boolean;
    sale_mode: RnsReservedSaleMode;
    reserve_price_wei: string | null;
    fixed_price_wei: string | null;
    auction_duration_seconds: string;
    notes: string | null;
    display_order: number;
    primary_auction_id: string | null;
    activation_tx_hash: string | null;
    activated_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      select
        id::text,
        chain_id,
        label,
        fqdn,
        category,
        enabled,
        sale_mode,
        reserve_price_wei::text,
        fixed_price_wei::text,
        auction_duration_seconds::text,
        notes,
        display_order,
        primary_auction_id::text,
        activation_tx_hash,
        activated_at,
        created_at,
        updated_at
      from stage0_rns.reserved_names
      where chain_id = $1
        and lower(label) = lower($2)
      limit 1
    `,
    [input.chainId, input.label],
  );

  return result.rows[0] ? toReservedNameRecord(result.rows[0]) : null;
}

export async function markRnsReservedNameActivated(input: {
  chainId: number;
  id: number;
  txHash: `0x${string}`;
  primaryAuctionId?: bigint | null;
}) {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    label: string;
    fqdn: string;
    category: string;
    enabled: boolean;
    sale_mode: RnsReservedSaleMode;
    reserve_price_wei: string | null;
    fixed_price_wei: string | null;
    auction_duration_seconds: string;
    notes: string | null;
    display_order: number;
    primary_auction_id: string | null;
    activation_tx_hash: string | null;
    activated_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      update stage0_rns.reserved_names
      set
        primary_auction_id = coalesce($3, primary_auction_id),
        activation_tx_hash = lower($4),
        activated_at = now(),
        updated_at = now()
      where chain_id = $1 and id = $2
      returning
        id::text,
        chain_id,
        label,
        fqdn,
        category,
        enabled,
        sale_mode,
        reserve_price_wei::text,
        fixed_price_wei::text,
        auction_duration_seconds::text,
        notes,
        display_order,
        primary_auction_id::text,
        activation_tx_hash,
        activated_at,
        created_at,
        updated_at
    `,
    [
      input.chainId,
      input.id,
      input.primaryAuctionId?.toString() ?? null,
      input.txHash,
    ],
  );

  return result.rows[0] ? toReservedNameRecord(result.rows[0]) : null;
}

export async function markRnsReservedNameActivatedByLabel(input: {
  chainId: number;
  label: string;
  primaryAuctionId: bigint;
  txHash?: `0x${string}` | null;
}) {
  await pool.query(
    `
      update stage0_rns.reserved_names
      set
        primary_auction_id = $3,
        activation_tx_hash = coalesce(lower($4), activation_tx_hash),
        activated_at = coalesce(activated_at, now()),
        updated_at = now()
      where chain_id = $1
        and lower(label) = lower($2)
        and sale_mode = 'auction'
    `,
    [
      input.chainId,
      input.label,
      input.primaryAuctionId.toString(),
      input.txHash ?? null,
    ],
  );
}

export async function upsertRnsReservedName(input: {
  chainId: number;
  label: string;
  category?: string | null;
  enabled?: boolean;
  saleMode?: RnsReservedSaleMode;
  reservePrice?: bigint | null;
  fixedPrice?: bigint | null;
  auctionDurationSeconds?: bigint | null;
  notes?: string | null;
  displayOrder?: number | null;
}) {
  const label = input.label.trim().toLowerCase();
  const result = await pool.query<{
    id: string;
    chain_id: number;
    label: string;
    fqdn: string;
    category: string;
    enabled: boolean;
    sale_mode: RnsReservedSaleMode;
    reserve_price_wei: string | null;
    fixed_price_wei: string | null;
    auction_duration_seconds: string;
    notes: string | null;
    display_order: number;
    primary_auction_id: string | null;
    activation_tx_hash: string | null;
    activated_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      insert into stage0_rns.reserved_names (
        chain_id,
        label,
        fqdn,
        category,
        enabled,
        sale_mode,
        reserve_price_wei,
        fixed_price_wei,
        auction_duration_seconds,
        notes,
        display_order
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::bigint, 259200), $10, $11)
      on conflict (chain_id, (lower(label)))
      do update set
        fqdn = excluded.fqdn,
        category = excluded.category,
        enabled = excluded.enabled,
        sale_mode = excluded.sale_mode,
        reserve_price_wei = excluded.reserve_price_wei,
        fixed_price_wei = excluded.fixed_price_wei,
        auction_duration_seconds = coalesce($9::bigint, stage0_rns.reserved_names.auction_duration_seconds),
        notes = excluded.notes,
        display_order = excluded.display_order,
        primary_auction_id = case
          when stage0_rns.reserved_names.sale_mode = excluded.sale_mode
            then stage0_rns.reserved_names.primary_auction_id
          else null
        end,
        activation_tx_hash = case
          when stage0_rns.reserved_names.sale_mode = excluded.sale_mode
            then stage0_rns.reserved_names.activation_tx_hash
          else null
        end,
        activated_at = case
          when stage0_rns.reserved_names.sale_mode = excluded.sale_mode
            then stage0_rns.reserved_names.activated_at
          else null
        end,
        updated_at = now()
      returning
        id::text,
        chain_id,
        label,
        fqdn,
        category,
        enabled,
        sale_mode,
        reserve_price_wei::text,
        fixed_price_wei::text,
        auction_duration_seconds::text,
        notes,
        display_order,
        primary_auction_id::text,
        activation_tx_hash,
        activated_at,
        created_at,
        updated_at
    `,
    [
      input.chainId,
      label,
      `${label}.rise`,
      input.category?.trim() || "general",
      input.enabled ?? false,
      input.saleMode ?? "auction",
      input.reservePrice?.toString() ?? null,
      input.fixedPrice?.toString() ?? null,
      input.auctionDurationSeconds?.toString() ?? null,
      input.notes?.trim() || null,
      input.displayOrder ?? 0,
    ],
  );

  return toReservedNameRecord(result.rows[0]);
}

export async function hasRnsNotificationDispatch(dispatchKey: string) {
  const result = await pool.query<{ exists: boolean }>(
    `
      select exists(
        select 1
        from stage0_rns.notification_dispatches
        where dispatch_key = $1
      ) as exists
    `,
    [dispatchKey],
  );

  return Boolean(result.rows[0]?.exists);
}

export async function claimRnsNotificationDispatch(input: {
  channel: "email" | "admin_slack";
  dispatchKey: string;
  subscriptionId?: number | null;
  eventSource: string;
  eventType: string;
  txHash?: `0x${string}` | null;
  logIndex?: number | null;
  detail?: unknown;
}) {
  const result = await pool.query<{ id: string }>(
    `
      insert into stage0_rns.notification_dispatches (
        channel,
        dispatch_key,
        subscription_id,
        event_source,
        event_type,
        tx_hash,
        log_index,
        detail
      )
      values ($1, $2, $3, $4, $5, lower($6), $7, $8::jsonb)
      on conflict (dispatch_key) do nothing
      returning id::text
    `,
    [
      input.channel,
      input.dispatchKey,
      input.subscriptionId ?? null,
      input.eventSource,
      input.eventType,
      input.txHash ?? null,
      input.logIndex ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );

  return result.rowCount === 1;
}

export async function releaseRnsNotificationDispatch(dispatchKey: string) {
  await pool.query(
    `delete from stage0_rns.notification_dispatches where dispatch_key = $1`,
    [dispatchKey],
  );
}

export async function recordRnsNotificationDispatch(input: {
  channel: "email" | "admin_slack";
  dispatchKey: string;
  subscriptionId?: number | null;
  eventSource: string;
  eventType: string;
  txHash?: `0x${string}` | null;
  logIndex?: number | null;
  detail?: unknown;
}) {
  await pool.query(
    `
      insert into stage0_rns.notification_dispatches (
        channel,
        dispatch_key,
        subscription_id,
        event_source,
        event_type,
        tx_hash,
        log_index,
        detail
      )
      values ($1, $2, $3, $4, $5, lower($6), $7, $8::jsonb)
      on conflict (dispatch_key) do nothing
    `,
    [
      input.channel,
      input.dispatchKey,
      input.subscriptionId ?? null,
      input.eventSource,
      input.eventType,
      input.txHash ?? null,
      input.logIndex ?? null,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}

export { ZERO_ADDRESS, lower, nullableEpoch };
