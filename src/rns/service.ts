import { createPublicClient, decodeFunctionData, getAddress, http, parseAbi, parseAbiItem } from "viem";
import { namehash } from "viem/ens";
import { pool } from "../db.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import {
  notifyAuctionEndedLifecycle,
  notifyAdminRnsMarketplaceActivity,
  notifyAdminRnsRegistration,
  notifyMarketplaceSubscribers,
  safelyNotify,
} from "./notifications.js";
import {
  ZERO_ADDRESS,
  applyRnsMarketplaceAuctionBid,
  applyRnsMarketplaceAuctionCancelled,
  applyRnsMarketplaceAuctionSettled,
  applyRnsMarketplaceListingCancelled,
  applyRnsMarketplaceListingPurchased,
  applyRnsOwnerTransfer,
  applyRnsPrimaryAuctionBid,
  applyRnsPrimaryAuctionCancelled,
  applyRnsPrimaryAuctionSettled,
  applyRnsReconciliation,
  applyRnsRelease,
  applyRnsRenewal,
  applyRnsResolvedAddressUpdate,
  applyRnsResolverUpdate,
  getRnsMarketplaceAuctionById,
  getRnsMarketplaceAuctions,
  getRnsEndedAuctionsForLifecycle,
  getRnsMarketplaceEvents,
  getRnsMarketplaceListingById,
  getRnsMarketplaceListings,
  getRnsMarketplaceNamesBySeller,
  getRnsNameCount,
  getRnsNameByLabel,
  getRnsNamesForReconciliation,
  getRnsOwnedNames,
  getRnsPrimaryAuctionById,
  getRnsPrimaryNameForAddress,
  getRnsPrimaryAuctions,
  getRnsSyncStates,
  markRnsReservedNameActivatedByLabel,
  recordRnsMarketplaceEvent,
  type RnsJobName,
  type RnsMarketplaceAuctionRecord,
  type RnsMarketplaceEventRecord,
  type RnsMarketplaceListingRecord,
  type RnsNameRecord,
  type RnsPrimaryAuctionRecord,
  upsertRnsMarketplaceAuction,
  upsertRnsMarketplaceAuctionSnapshot,
  upsertRnsMarketplaceListing,
  upsertRnsMarketplaceListingSnapshot,
  upsertRnsKnownLabelSnapshot,
  upsertRnsPrimaryAuction,
  upsertRnsPrimaryAuctionSnapshot,
  upsertRnsRegistration,
  upsertRnsSyncState,
} from "./store.js";

const client = createPublicClient({
  transport: http(config.riseTestnetRpcUrl),
});

const registrarDecodeAbi = parseAbi([
  "function register(string name, uint256 duration, address resolver_, (uint8 action, bytes32 labelHash, address beneficiary, uint256 duration, uint256 priceWei, uint256 deadline, bytes32 nonce) quote, bytes sig)",
  "function registerFixedPremium(string name, uint256 duration, address resolver_, (uint8 action, bytes32 labelHash, address beneficiary, uint256 duration, uint256 priceWei, uint256 deadline, bytes32 nonce) quote, bytes sig)",
  "function controllerRegisterReserved(string name, uint256 duration, address beneficiary, address resolver_)",
  "function adminAssignProtected(string name, uint256 duration, address beneficiary, address resolver_)",
  "function renew(string name, uint256 duration, (uint8 action, bytes32 labelHash, address beneficiary, uint256 duration, uint256 priceWei, uint256 deadline, bytes32 nonce) quote, bytes sig)",
  "function release(string name)",
]);

const registrarEvents = {
  nameRegistered: parseAbiItem(
    "event NameRegistered(string indexed name, bytes32 indexed node, address indexed registrant, uint256 expires)",
  ),
  nameRenewed: parseAbiItem(
    "event NameRenewed(string indexed name, bytes32 indexed node, uint256 expires)",
  ),
  nameReleased: parseAbiItem("event NameReleased(string indexed name, bytes32 indexed node)"),
} as const;

const registryEvents = {
  transfer: parseAbiItem("event Transfer(bytes32 indexed node, address owner)"),
  newResolver: parseAbiItem("event NewResolver(bytes32 indexed node, address resolver)"),
} as const;

const resolverEvents = {
  addrChanged: parseAbiItem("event AddrChanged(bytes32 indexed node, address addr)"),
} as const;

const primaryAuctionEvents = {
  auctionCreated: parseAbiItem(
    "event AuctionCreated(uint256 indexed auctionId,string name,uint256 reservePrice,uint64 startTime,uint64 endTime,uint256 duration)",
  ),
  bidPlaced: parseAbiItem(
    "event BidPlaced(uint256 indexed auctionId,address indexed bidder,uint256 amount,uint64 endTime,uint64 nextExtensionWindow)",
  ),
  refundAvailable: parseAbiItem(
    "event BidRefundAvailable(uint256 indexed auctionId,address indexed bidder,uint256 amount)",
  ),
  auctionCancelled: parseAbiItem("event AuctionCancelled(uint256 indexed auctionId)"),
  auctionSettled: parseAbiItem(
    "event AuctionSettled(uint256 indexed auctionId,address indexed winner,uint256 amount)",
  ),
  withdrawal: parseAbiItem("event Withdrawal(address indexed bidder,uint256 amount)"),
} as const;

const marketplaceEvents = {
  listed: parseAbiItem(
    "event Listed(uint256 indexed listingId,bytes32 indexed node,string name,address indexed seller,uint256 price)",
  ),
  listingCancelled: parseAbiItem("event ListingCancelled(uint256 indexed listingId)"),
  listingPurchased: parseAbiItem(
    "event ListingPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)",
  ),
  secondaryAuctionCreated: parseAbiItem(
    "event SecondaryAuctionCreated(uint256 indexed auctionId,bytes32 indexed node,string name,address indexed seller,uint256 reservePrice,uint64 startTime,uint64 endTime)",
  ),
  bidPlaced: parseAbiItem(
    "event BidPlaced(uint256 indexed auctionId,address indexed bidder,uint256 amount,uint64 endTime,uint64 nextExtensionWindow)",
  ),
  refundAvailable: parseAbiItem(
    "event BidRefundAvailable(uint256 indexed auctionId,address indexed bidder,uint256 amount)",
  ),
  secondaryAuctionCancelled: parseAbiItem("event SecondaryAuctionCancelled(uint256 indexed auctionId)"),
  secondaryAuctionSettled: parseAbiItem(
    "event SecondaryAuctionSettled(uint256 indexed auctionId,address indexed winner,uint256 amount)",
  ),
  withdrawal: parseAbiItem("event Withdrawal(address indexed account,uint256 amount)"),
  proceedsAvailable: parseAbiItem(
    "event ProceedsAvailable(uint256 indexed entityId,bool indexed isAuction,address indexed account,uint256 amount)",
  ),
  proceedsWithdrawal: parseAbiItem("event ProceedsWithdrawal(address indexed account,uint256 amount)"),
} as const;

const registryReadAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
]);

const resolverReadAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);

const registrarReadAbi = parseAbi(["function expiryOf(string name) view returns (uint256)"]);

const primaryAuctionReadAbi = parseAbi([
  "function registrar() view returns (address)",
  "function auctionCount() view returns (uint256)",
  "function auction(uint256 auctionId) view returns ((string name,uint256 duration,uint256 reservePrice,uint96 minIncrementBps,uint64 startTime,uint64 endTime,uint64 currentExtensionWindow,uint32 bidCount,address highestBidder,uint256 highestBid,bool settled,bool cancelled))",
]);

const marketplaceReadAbi = parseAbi([
  "function registry() view returns (address)",
  "function registrar() view returns (address)",
  "function listingCount() view returns (uint256)",
  "function auctionCount() view returns (uint256)",
  "function listing(uint256 listingId) view returns ((bytes32 node,bytes32 labelHash,string name,address seller,uint256 price,bool active))",
  "function auction(uint256 auctionId) view returns ((bytes32 node,bytes32 labelHash,string name,address seller,uint256 reservePrice,uint96 minIncrementBps,uint64 startTime,uint64 endTime,uint64 currentExtensionWindow,uint32 bidCount,address highestBidder,uint256 highestBid,bool settled,bool cancelled))",
]);

const DEFAULT_JOB_ORDER = [
  "registrar",
  "registry",
  "resolver",
  "primary_auction",
  "marketplace",
] as const satisfies readonly RnsJobName[];
type JobName = (typeof DEFAULT_JOB_ORDER)[number];
const NAME_JOB_ORDER = ["registrar", "registry", "resolver"] as const satisfies readonly JobName[];
const WALLET_NAME_JOB_ORDER = [
  "registrar",
  "registry",
  "resolver",
  "marketplace",
] as const satisfies readonly JobName[];
const ACTIVE_RNS_REGISTRAR_START_BLOCK = config.rnsStartBlocks.registrar;

type RegistrarDecodedCall = {
  label: string | null;
  fqdn: string | null;
  resolver: `0x${string}` | null;
  txTo: `0x${string}` | null;
};

const deploymentBlockCache = new Map<string, Promise<bigint>>();
const blockTimeCache = new Map<bigint, Promise<Date>>();
let syncPromise: Promise<void> | null = null;
let reconcilePromise: Promise<void> | null = null;
let marketplaceSnapshotPromise: Promise<void> | null = null;
let auctionLifecyclePromise: Promise<void> | null = null;
let contractConfigurationPromise: Promise<void> | null = null;
let marketplaceSnapshotAt = 0;
let jobsStarted = false;

const MARKETPLACE_SNAPSHOT_TTL_MS = 10_000;
const MARKETPLACE_SNAPSHOT_MAX_ITEMS = 10_000;
const MARKETPLACE_MAX_BACKFILL_BLOCKS = 100_000n;
const MARKETPLACE_RECENT_EVENT_BLOCKS = 5_000n;
const RNS_RPC_MAX_LOG_RANGE = 5_000n;

type PrimaryAuctionChainRecord = {
  name: string;
  duration: bigint;
  reservePrice: bigint;
  startTime: bigint;
  endTime: bigint;
  currentExtensionWindow: bigint;
  bidCount: number;
  highestBidder: `0x${string}`;
  highestBid: bigint;
  settled: boolean;
  cancelled: boolean;
};

type MarketplaceListingChainRecord = {
  node: `0x${string}`;
  name: string;
  seller: `0x${string}`;
  price: bigint;
  active: boolean;
};

type MarketplaceAuctionChainRecord = {
  node: `0x${string}`;
  name: string;
  seller: `0x${string}`;
  reservePrice: bigint;
  startTime: bigint;
  endTime: bigint;
  currentExtensionWindow: bigint;
  bidCount: number;
  highestBidder: `0x${string}`;
  highestBid: bigint;
  settled: boolean;
  cancelled: boolean;
};

async function assertRnsContractConfiguration() {
  if (!contractConfigurationPromise) {
    contractConfigurationPromise = (async () => {
      const [auctionRegistrar, marketplaceRegistry, marketplaceRegistrar] = await Promise.all([
        client.readContract({
          address: config.rnsContracts.auctionHouse as `0x${string}`,
          abi: primaryAuctionReadAbi,
          functionName: "registrar",
        }),
        client.readContract({
          address: config.rnsContracts.marketplace as `0x${string}`,
          abi: marketplaceReadAbi,
          functionName: "registry",
        }),
        client.readContract({
          address: config.rnsContracts.marketplace as `0x${string}`,
          abi: marketplaceReadAbi,
          functionName: "registrar",
        }),
      ]);

      const mismatches = [
        ["auction registrar", auctionRegistrar, config.rnsContracts.registrar],
        ["marketplace registry", marketplaceRegistry, config.rnsContracts.registry],
        ["marketplace registrar", marketplaceRegistrar, config.rnsContracts.registrar],
      ].filter(([, actual, expected]) => String(actual).toLowerCase() !== String(expected).toLowerCase());

      if (mismatches.length > 0) {
        throw new Error(
          `RNS contract configuration mismatch: ${mismatches
            .map(([name, actual, expected]) => `${name} is ${actual}, configured as ${expected}`)
            .join("; ")}`,
        );
      }
    })().catch((error) => {
      contractConfigurationPromise = null;
      throw error;
    });
  }

  return contractConfigurationPromise;
}

function normalizeLabel(input: string | null | undefined) {
  const value = input?.trim().toLowerCase().replace(/\.rise$/i, "");
  return value ? value : null;
}

function toFqdn(label: string | null) {
  return label ? `${label}.rise` : null;
}

function toLowerHex<T extends string>(value: T | null | undefined) {
  return value ? (value.toLowerCase() as T) : null;
}

function isZeroAddress(value: string | null | undefined) {
  return !value || value.toLowerCase() === ZERO_ADDRESS;
}

function compareLogs(
  a: { blockNumber: bigint | null; logIndex: number | null },
  b: { blockNumber: bigint | null; logIndex: number | null },
) {
  const blockA = a.blockNumber ?? 0n;
  const blockB = b.blockNumber ?? 0n;
  if (blockA < blockB) return -1;
  if (blockA > blockB) return 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

async function getBlockTime(blockNumber: bigint) {
  const cached = blockTimeCache.get(blockNumber);
  if (cached) return cached;

  const promise = client
    .getBlock({ blockNumber })
    .then((block) => new Date(Number(block.timestamp) * 1000));
  blockTimeCache.set(blockNumber, promise);
  return promise;
}

async function getBlockHash(blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber });
  return block.hash;
}

function snapshotAuctionStatus(input: {
  startTime: bigint;
  endTime: bigint;
  settled: boolean;
  cancelled: boolean;
}) {
  if (input.cancelled) return "cancelled";
  if (input.settled) return "settled";
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < input.startTime) return "scheduled";
  if (now >= input.endTime) return "ended";
  return "active";
}

function checkedSnapshotCount(value: bigint, label: string) {
  if (value > BigInt(MARKETPLACE_SNAPSHOT_MAX_ITEMS)) {
    throw new Error(`${label} count ${value} exceeds snapshot safety limit`);
  }
  return Number(value);
}

async function readIndexedRecords<T>(count: number, reader: (index: bigint) => Promise<T>) {
  if (count === 0) return [];
  const records = new Array<T>(count);
  let nextIndex = 0;
  const workerCount = Math.min(8, count);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= count) return;
        records[index] = await reader(BigInt(index));
      }
    }),
  );

  return records;
}

async function runRnsMarketplaceSnapshot(reason: string) {
  await assertRnsContractConfiguration();
  const head = await client.getBlockNumber();
  const [primaryCountRaw, listingCountRaw, auctionCountRaw] = await Promise.all([
    client.readContract({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      abi: primaryAuctionReadAbi,
      functionName: "auctionCount",
    }),
    client.readContract({
      address: config.rnsContracts.marketplace as `0x${string}`,
      abi: marketplaceReadAbi,
      functionName: "listingCount",
    }),
    client.readContract({
      address: config.rnsContracts.marketplace as `0x${string}`,
      abi: marketplaceReadAbi,
      functionName: "auctionCount",
    }),
  ]);

  const primaryCount = checkedSnapshotCount(primaryCountRaw, "primary auction");
  const listingCount = checkedSnapshotCount(listingCountRaw, "marketplace listing");
  const auctionCount = checkedSnapshotCount(auctionCountRaw, "marketplace auction");

  const [primaryAuctions, listings, marketplaceAuctions] = await Promise.all([
    readIndexedRecords(primaryCount, async (auctionId) =>
      client.readContract({
        address: config.rnsContracts.auctionHouse as `0x${string}`,
        abi: primaryAuctionReadAbi,
        functionName: "auction",
        args: [auctionId],
      }) as Promise<PrimaryAuctionChainRecord>,
    ),
    readIndexedRecords(listingCount, async (listingId) =>
      client.readContract({
        address: config.rnsContracts.marketplace as `0x${string}`,
        abi: marketplaceReadAbi,
        functionName: "listing",
        args: [listingId],
      }) as Promise<MarketplaceListingChainRecord>,
    ),
    readIndexedRecords(auctionCount, async (auctionId) =>
      client.readContract({
        address: config.rnsContracts.marketplace as `0x${string}`,
        abi: marketplaceReadAbi,
        functionName: "auction",
        args: [auctionId],
      }) as Promise<MarketplaceAuctionChainRecord>,
    ),
  ]);

  const db = await pool.connect();
  const reservedLinks: Array<{ label: string; auctionId: bigint }> = [];
  try {
    await db.query("begin");

    for (let index = 0; index < primaryAuctions.length; index += 1) {
      const auction = primaryAuctions[index];
      const name = normalizeLabel(auction.name);
      if (!name) continue;
      const highestBidder = isZeroAddress(auction.highestBidder)
        ? null
        : (toLowerHex(auction.highestBidder) as `0x${string}`);
      const status = snapshotAuctionStatus(auction);

      await upsertRnsPrimaryAuctionSnapshot(db, {
        chainId: config.riseTestnetChainId,
        auctionId: BigInt(index),
        name,
        duration: auction.duration,
        reservePrice: auction.reservePrice,
        startTime: auction.startTime,
        endTime: auction.endTime,
        currentExtensionWindow: auction.currentExtensionWindow,
        bidCount: Number(auction.bidCount),
        highestBidder,
        highestBid: auction.highestBid,
        status,
        winner: auction.settled ? highestBidder : null,
        settledAmount: auction.settled ? auction.highestBid : null,
        blockNumber: head,
      });
      reservedLinks.push({ label: name, auctionId: BigInt(index) });
    }

    for (let index = 0; index < listings.length; index += 1) {
      const listing = listings[index];
      const name = normalizeLabel(listing.name);
      if (!name) continue;
      await upsertRnsMarketplaceListingSnapshot(db, {
        chainId: config.riseTestnetChainId,
        listingId: BigInt(index),
        node: toLowerHex(listing.node) as `0x${string}`,
        name,
        seller: toLowerHex(listing.seller) as `0x${string}`,
        price: listing.price,
        active: listing.active,
        blockNumber: head,
      });
    }

    for (let index = 0; index < marketplaceAuctions.length; index += 1) {
      const auction = marketplaceAuctions[index];
      const name = normalizeLabel(auction.name);
      if (!name) continue;
      const highestBidder = isZeroAddress(auction.highestBidder)
        ? null
        : (toLowerHex(auction.highestBidder) as `0x${string}`);
      const status = snapshotAuctionStatus(auction);
      await upsertRnsMarketplaceAuctionSnapshot(db, {
        chainId: config.riseTestnetChainId,
        auctionId: BigInt(index),
        node: toLowerHex(auction.node) as `0x${string}`,
        name,
        seller: toLowerHex(auction.seller) as `0x${string}`,
        reservePrice: auction.reservePrice,
        startTime: auction.startTime,
        endTime: auction.endTime,
        currentExtensionWindow: auction.currentExtensionWindow,
        bidCount: Number(auction.bidCount),
        highestBidder,
        highestBid: auction.highestBid,
        status,
        winner: auction.settled ? highestBidder : null,
        settledAmount: auction.settled ? auction.highestBid : null,
        blockNumber: head,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }

  await Promise.all(
    reservedLinks.map((link) =>
      markRnsReservedNameActivatedByLabel({
        chainId: config.riseTestnetChainId,
        label: link.label,
        primaryAuctionId: link.auctionId,
      }),
    ),
  );

  marketplaceSnapshotAt = Date.now();
  logger.info("RNS marketplace snapshot refreshed", {
    reason,
    chainId: config.riseTestnetChainId,
    blockNumber: head.toString(),
    primaryAuctions: primaryCount,
    listings: listingCount,
    marketplaceAuctions: auctionCount,
  });
}

export async function ensureRnsMarketplaceSnapshot(reason = "manual", force = false) {
  if (!force && Date.now() - marketplaceSnapshotAt < MARKETPLACE_SNAPSHOT_TTL_MS) return;
  if (!marketplaceSnapshotPromise) {
    marketplaceSnapshotPromise = runRnsMarketplaceSnapshot(reason).finally(() => {
      marketplaceSnapshotPromise = null;
    });
  }
  return marketplaceSnapshotPromise;
}

async function findDeploymentBlock(address: string) {
  const key = address.toLowerCase();
  const cached = deploymentBlockCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    let low = 0n;
    let high = await client.getBlockNumber();
    let result = high;

    while (low <= high) {
      const mid = (low + high) / 2n;
      const bytecode = await client.getBytecode({ address: key as `0x${string}`, blockNumber: mid });
      if (bytecode && bytecode !== "0x") {
        result = mid;
        if (mid === 0n) break;
        high = mid - 1n;
      } else {
        low = mid + 1n;
      }
    }

    return result;
  })();

  deploymentBlockCache.set(key, promise);
  return promise;
}

async function getInitialJobBlock(jobName: JobName) {
  const override =
    jobName === "primary_auction"
      ? config.rnsStartBlocks.primaryAuction
      : config.rnsStartBlocks[jobName];
  if (typeof override === "bigint") {
    return override;
  }

  const address =
    jobName === "registrar"
      ? config.rnsContracts.registrar
      : jobName === "registry"
        ? config.rnsContracts.registry
        : jobName === "resolver"
          ? config.rnsContracts.resolver
          : jobName === "primary_auction"
            ? config.rnsContracts.auctionHouse
            : config.rnsContracts.marketplace;

  return findDeploymentBlock(address);
}

function getJobContractAddress(jobName: JobName) {
  if (jobName === "registrar") return config.rnsContracts.registrar;
  if (jobName === "registry") return config.rnsContracts.registry;
  if (jobName === "resolver") return config.rnsContracts.resolver;
  if (jobName === "primary_auction") return config.rnsContracts.auctionHouse;
  return config.rnsContracts.marketplace;
}

function clampRnsSyncRange(fromBlock: bigint, toBlock: bigint): [bigint, bigint] | null {
  return [fromBlock, toBlock];
}

async function decodeRegistrarCall(txHash: `0x${string}`): Promise<RegistrarDecodedCall> {
  let txTo: `0x${string}` | null = null;
  try {
    const tx = await client.getTransaction({ hash: txHash });
    txTo = toLowerHex(tx.to);
    const decoded = decodeFunctionData({
      abi: registrarDecodeAbi,
      data: tx.input,
    });

    if (decoded.functionName === "register" || decoded.functionName === "registerFixedPremium") {
      const label = normalizeLabel(String(decoded.args[0]));
      const resolver = toLowerHex(decoded.args[2] as `0x${string}`);
      return { label, fqdn: toFqdn(label), resolver: isZeroAddress(resolver) ? null : resolver, txTo };
    }

    if (decoded.functionName === "controllerRegisterReserved" || decoded.functionName === "adminAssignProtected") {
      const label = normalizeLabel(String(decoded.args[0]));
      const resolver = toLowerHex(decoded.args[3] as `0x${string}`);
      return { label, fqdn: toFqdn(label), resolver: isZeroAddress(resolver) ? null : resolver, txTo };
    }

    if (decoded.functionName === "renew" || decoded.functionName === "release") {
      const label = normalizeLabel(String(decoded.args[0]));
      return { label, fqdn: toFqdn(label), resolver: null, txTo };
    }
  } catch {
    // Ignore decode failures; reconciliation can still fill label via resolver.text later.
  }

  return { label: null, fqdn: null, resolver: null, txTo };
}

async function syncRegistrarRange(fromBlock: bigint, toBlock: bigint, emitNotifications = true) {
  const range = clampRnsSyncRange(fromBlock, toBlock);
  if (!range) return;
  [fromBlock, toBlock] = range;

  const [registered, renewed, released] = await Promise.all([
    client.getLogs({
      address: config.rnsContracts.registrar as `0x${string}`,
      event: registrarEvents.nameRegistered,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.registrar as `0x${string}`,
      event: registrarEvents.nameRenewed,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.registrar as `0x${string}`,
      event: registrarEvents.nameReleased,
      fromBlock,
      toBlock,
    }),
  ]);

  const logs = [
    ...registered.map((log) => ({ kind: "register" as const, log })),
    ...renewed.map((log) => ({ kind: "renew" as const, log })),
    ...released.map((log) => ({ kind: "release" as const, log })),
  ].sort((a, b) => compareLogs(a.log, b.log));

  if (logs.length === 0) return;

  const db = await pool.connect();
  const pendingAdminNotifications: Array<{
    chainId: number;
    name: string | null;
    fqdn: string | null;
    registrant: `0x${string}`;
    expiry: bigint;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  try {
    await db.query("begin");

    for (const entry of logs) {
      const { log } = entry;
      if (!log.transactionHash || log.blockNumber == null) continue;
      const decoded = await decodeRegistrarCall(log.transactionHash);
      const blockTime = await getBlockTime(log.blockNumber);
      const node = toLowerHex(log.args.node as `0x${string}`);
      if (!node) continue;

      if (entry.kind === "register") {
        const registrant = toLowerHex(
          (log as (typeof registered)[number]).args.registrant as `0x${string}`,
        ) ?? (ZERO_ADDRESS as `0x${string}`);
        await upsertRnsRegistration(db, {
          chainId: config.riseTestnetChainId,
          node: node as `0x${string}`,
          label: decoded.label,
          fqdn: decoded.fqdn,
          registrant: registrant as `0x${string}`,
          owner: registrant as `0x${string}`,
          resolver: decoded.resolver,
          expiry: ((log as (typeof registered)[number]).args.expires as bigint | undefined) ?? 0n,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTime,
        });
        if (decoded.txTo !== config.rnsContracts.auctionHouse.toLowerCase()) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            name: decoded.label,
            fqdn: decoded.fqdn,
            registrant: registrant as `0x${string}`,
            expiry: ((log as (typeof registered)[number]).args.expires as bigint | undefined) ?? 0n,
            txHash: log.transactionHash,
            logIndex: log.logIndex ?? 0,
          });
        }
        continue;
      }

      if (entry.kind === "renew") {
        await applyRnsRenewal(db, {
          chainId: config.riseTestnetChainId,
          node: node as `0x${string}`,
          label: decoded.label,
          fqdn: decoded.fqdn,
          expiry: ((log as (typeof renewed)[number]).args.expires as bigint | undefined) ?? 0n,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTime,
        });
        continue;
      }

      await applyRnsRelease(db, {
        chainId: config.riseTestnetChainId,
        node: node as `0x${string}`,
        label: decoded.label,
        fqdn: decoded.fqdn,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockTime,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }

  if (emitNotifications) {
    for (const notification of pendingAdminNotifications) {
      await safelyNotify("admin-rns-registration", () => notifyAdminRnsRegistration(notification));
    }
  }
}

async function syncRegistryRange(fromBlock: bigint, toBlock: bigint) {
  const range = clampRnsSyncRange(fromBlock, toBlock);
  if (!range) return;
  [fromBlock, toBlock] = range;

  const [transfers, resolvers] = await Promise.all([
    client.getLogs({
      address: config.rnsContracts.registry as `0x${string}`,
      event: registryEvents.transfer,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.registry as `0x${string}`,
      event: registryEvents.newResolver,
      fromBlock,
      toBlock,
    }),
  ]);

  const logs = [
    ...transfers.map((log) => ({ kind: "transfer" as const, log })),
    ...resolvers.map((log) => ({ kind: "resolver" as const, log })),
  ].sort((a, b) => compareLogs(a.log, b.log));

  if (logs.length === 0) return;

  const db = await pool.connect();
  const pendingAdminNotifications: Array<{
    chainId: number;
    source: "primary_auction" | "marketplace";
    eventType: string;
    entityType: string;
    entityId?: bigint | null;
    name?: string | null;
    amount?: bigint | null;
    status?: string | null;
    winner?: `0x${string}` | null;
    actor?: `0x${string}` | null;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  try {
    await db.query("begin");

    for (const entry of logs) {
      const { log } = entry;
      if (log.blockNumber == null) continue;
      const node = toLowerHex(log.args.node as `0x${string}`);
      if (!node) continue;

      if (entry.kind === "transfer") {
        const owner = toLowerHex(
          (log as (typeof transfers)[number]).args.owner as `0x${string}`,
        ) ?? (ZERO_ADDRESS as `0x${string}`);
        await applyRnsOwnerTransfer(db, {
          chainId: config.riseTestnetChainId,
          node: node as `0x${string}`,
          owner: owner as `0x${string}`,
          blockNumber: log.blockNumber,
        });
        continue;
      }

      const resolver = toLowerHex((log as (typeof resolvers)[number]).args.resolver as `0x${string}`);
      await applyRnsResolverUpdate(db, {
        chainId: config.riseTestnetChainId,
        node: node as `0x${string}`,
        resolver: isZeroAddress(resolver) ? null : (resolver as `0x${string}`),
        blockNumber: log.blockNumber,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

async function syncResolverRange(fromBlock: bigint, toBlock: bigint) {
  const range = clampRnsSyncRange(fromBlock, toBlock);
  if (!range) return;
  [fromBlock, toBlock] = range;

  const logs = await client.getLogs({
    address: config.rnsContracts.resolver as `0x${string}`,
    event: resolverEvents.addrChanged,
    fromBlock,
    toBlock,
  });

  if (logs.length === 0) return;

  const db = await pool.connect();
  const pendingAdminNotifications: Array<{
    chainId: number;
    source: "primary_auction" | "marketplace";
    eventType: string;
    entityType: string;
    entityId: bigint;
    name?: string | null;
    node?: `0x${string}` | null;
    seller?: `0x${string}` | null;
    actor?: `0x${string}` | null;
    amount?: bigint | null;
    status?: string | null;
    winner?: `0x${string}` | null;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  const pendingSubscriberNotifications: Array<{
    chainId: number;
    eventType: string;
    entityType: "listing" | "auction";
    entityId: bigint;
    name: string;
    fqdn: string;
    node: `0x${string}`;
    seller: `0x${string}`;
    actor?: `0x${string}` | null;
    previousHighestBidder?: `0x${string}` | null;
    amount?: bigint | null;
    status?: string | null;
    winner?: `0x${string}` | null;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  try {
    await db.query("begin");

    for (const log of logs) {
      if (log.blockNumber == null) continue;
      const node = toLowerHex(log.args.node as `0x${string}`);
      if (!node) continue;
      const addr = toLowerHex(log.args.addr as `0x${string}`);
      await applyRnsResolvedAddressUpdate(db, {
        chainId: config.riseTestnetChainId,
        node: node as `0x${string}`,
        resolvedAddress: isZeroAddress(addr) ? null : (addr as `0x${string}`),
        blockNumber: log.blockNumber,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

async function syncPrimaryAuctionRange(fromBlock: bigint, toBlock: bigint, emitNotifications = true) {
  const range = clampRnsSyncRange(fromBlock, toBlock);
  if (!range) return;
  [fromBlock, toBlock] = range;

  const [created, bids, refunds, cancelled, settled, withdrawals] = await Promise.all([
    client.getLogs({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      event: primaryAuctionEvents.auctionCreated,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      event: primaryAuctionEvents.bidPlaced,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      event: primaryAuctionEvents.refundAvailable,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      event: primaryAuctionEvents.auctionCancelled,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      event: primaryAuctionEvents.auctionSettled,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.auctionHouse as `0x${string}`,
      event: primaryAuctionEvents.withdrawal,
      fromBlock,
      toBlock,
    }),
  ]);

  const logs = [
    ...created.map((log) => ({ kind: "created" as const, log })),
    ...bids.map((log) => ({ kind: "bid" as const, log })),
    ...refunds.map((log) => ({ kind: "refund" as const, log })),
    ...cancelled.map((log) => ({ kind: "cancelled" as const, log })),
    ...settled.map((log) => ({ kind: "settled" as const, log })),
    ...withdrawals.map((log) => ({ kind: "withdrawal" as const, log })),
  ].sort((a, b) => compareLogs(a.log, b.log));

  if (logs.length === 0) return;

  const db = await pool.connect();
  const pendingAdminNotifications: Array<{
    chainId: number;
    source: "primary_auction" | "marketplace";
    eventType: string;
    entityType: string;
    entityId?: bigint | null;
    name?: string | null;
    actor?: `0x${string}` | null;
    amount?: bigint | null;
    status?: string | null;
    winner?: `0x${string}` | null;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  const pendingSubscriberNotifications: Array<
    Parameters<typeof notifyMarketplaceSubscribers>[0]
  > = [];
  try {
    await db.query("begin");

    for (const entry of logs) {
      const { log } = entry;
      if (!log.transactionHash || log.blockNumber == null || log.logIndex == null) continue;
      const blockTime = await getBlockTime(log.blockNumber);

      if (entry.kind === "created") {
        const args = (log as (typeof created)[number]).args;
        const name = normalizeLabel(args.name as string);
        if (!name) continue;
        const auctionId = args.auctionId as bigint;
        await upsertRnsPrimaryAuction(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          name,
          duration: (args.duration as bigint | undefined) ?? 0n,
          reservePrice: (args.reservePrice as bigint | undefined) ?? 0n,
          startTime: (args.startTime as bigint | undefined) ?? 0n,
          endTime: (args.endTime as bigint | undefined) ?? 0n,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTime,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          entityType: "auction",
          eventType: "primary_auction.created",
          entityId: auctionId,
          name,
          amount: (args.reservePrice as bigint | undefined) ?? null,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
          payload: {
            duration: ((args.duration as bigint | undefined) ?? 0n).toString(),
            startTime: ((args.startTime as bigint | undefined) ?? 0n).toString(),
            endTime: ((args.endTime as bigint | undefined) ?? 0n).toString(),
          },
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          eventType: "primary_auction.created",
          entityType: "auction",
          entityId: auctionId,
          name,
          amount: (args.reservePrice as bigint | undefined) ?? 0n,
          status: "scheduled",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        pendingSubscriberNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          eventType: "primary_auction.created",
          entityType: "auction",
          entityId: auctionId,
          name,
          fqdn: `${name}.rise`,
          node: namehash(`${name}.rise`) as `0x${string}`,
          amount: (args.reservePrice as bigint | undefined) ?? 0n,
          status: "scheduled",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        continue;
      }

      if (entry.kind === "bid") {
        const args = (log as (typeof bids)[number]).args;
        const auctionId = args.auctionId as bigint;
        const bidder = toLowerHex(args.bidder as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        const previousRecord = await getRnsPrimaryAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        await applyRnsPrimaryAuctionBid(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          bidder,
          amount,
          endTime: (args.endTime as bigint | undefined) ?? 0n,
          nextExtensionWindow: (args.nextExtensionWindow as bigint | undefined) ?? 0n,
          blockNumber: log.blockNumber,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          entityType: "auction",
          eventType: "primary_auction.bid",
          entityId: auctionId,
          account: bidder,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
          payload: {
            endTime: ((args.endTime as bigint | undefined) ?? 0n).toString(),
            nextExtensionWindow: ((args.nextExtensionWindow as bigint | undefined) ?? 0n).toString(),
          },
        });
        const record = await getRnsPrimaryAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          eventType: "primary_auction.bid",
          entityType: "auction",
          entityId: auctionId,
          name: record?.name ?? null,
          amount,
          status: record?.status ?? "active",
          actor: bidder,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        if (record) {
          pendingSubscriberNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "primary_auction",
            eventType: "primary_auction.bid",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            fqdn: record.fqdn,
            node: namehash(record.fqdn) as `0x${string}`,
            actor: bidder,
            previousHighestBidder: previousRecord?.highestBidder ?? null,
            amount,
            status: record.status,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "refund") {
        const args = (log as (typeof refunds)[number]).args;
        const auctionId = args.auctionId as bigint;
        const bidder = toLowerHex(args.bidder as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          entityType: "refund",
          eventType: "primary_auction.refund_available",
          entityId: auctionId,
          account: bidder,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsPrimaryAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          eventType: "primary_auction.refund_available",
          entityType: "refund",
          entityId: auctionId,
          name: record?.name ?? null,
          actor: bidder,
          amount,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        continue;
      }

      if (entry.kind === "cancelled") {
        const auctionId = (log as (typeof cancelled)[number]).args.auctionId as bigint;
        await applyRnsPrimaryAuctionCancelled(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          blockNumber: log.blockNumber,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          entityType: "auction",
          eventType: "primary_auction.cancelled",
          entityId: auctionId,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsPrimaryAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          eventType: "primary_auction.cancelled",
          entityType: "auction",
          entityId: auctionId,
          name: record?.name ?? null,
          status: "cancelled",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        if (record) {
          pendingSubscriberNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "primary_auction",
            eventType: "primary_auction.cancelled",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            fqdn: record.fqdn,
            node: namehash(record.fqdn) as `0x${string}`,
            status: "cancelled",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "settled") {
        const args = (log as (typeof settled)[number]).args;
        const auctionId = args.auctionId as bigint;
        const winnerAddress = toLowerHex(args.winner as `0x${string}`) as `0x${string}`;
        const winner = winnerAddress === ZERO_ADDRESS ? null : winnerAddress;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        await applyRnsPrimaryAuctionSettled(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          winner,
          amount,
          blockNumber: log.blockNumber,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          entityType: "auction",
          eventType: "primary_auction.settled",
          entityId: auctionId,
          account: winner,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsPrimaryAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "primary_auction",
          eventType: "primary_auction.settled",
          entityType: "auction",
          entityId: auctionId,
          name: record?.name ?? null,
          actor: winner,
          amount,
          status: "settled",
          winner,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        if (record) {
          pendingSubscriberNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "primary_auction",
            eventType: "primary_auction.settled",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            fqdn: record.fqdn,
            node: namehash(record.fqdn) as `0x${string}`,
            actor: winner,
            amount,
            status: "settled",
            winner,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      const args = (log as (typeof withdrawals)[number]).args;
      const bidder = toLowerHex(args.bidder as `0x${string}`) as `0x${string}`;
      const amount = (args.amount as bigint | undefined) ?? 0n;
      await recordRnsMarketplaceEvent(db, {
        chainId: config.riseTestnetChainId,
        source: "primary_auction",
        entityType: "withdrawal",
        eventType: "primary_auction.withdrawal",
        account: bidder,
        amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        blockTime,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }

  if (emitNotifications) {
    for (const notification of pendingAdminNotifications) {
      await safelyNotify("admin-primary-auction", () =>
        notifyAdminRnsMarketplaceActivity(notification),
      );
    }

    for (const notification of pendingSubscriberNotifications) {
      await safelyNotify("primary-auction-subscribers", () =>
        notifyMarketplaceSubscribers(notification),
      );
    }
  }
}

async function syncMarketplaceRange(fromBlock: bigint, toBlock: bigint, emitNotifications = true) {
  const range = clampRnsSyncRange(fromBlock, toBlock);
  if (!range) return;
  [fromBlock, toBlock] = range;

  const [
    listed,
    listingCancelled,
    listingPurchased,
    secondaryAuctionCreated,
    bids,
    refunds,
    secondaryAuctionCancelled,
    secondaryAuctionSettled,
    withdrawals,
    proceedsAvailable,
    proceedsWithdrawals,
  ] = await Promise.all([
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.listed,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.listingCancelled,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.listingPurchased,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.secondaryAuctionCreated,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.bidPlaced,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.refundAvailable,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.secondaryAuctionCancelled,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.secondaryAuctionSettled,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.withdrawal,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.proceedsAvailable,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: config.rnsContracts.marketplace as `0x${string}`,
      event: marketplaceEvents.proceedsWithdrawal,
      fromBlock,
      toBlock,
    }),
  ]);

  const logs = [
    ...listed.map((log) => ({ kind: "listed" as const, log })),
    ...listingCancelled.map((log) => ({ kind: "listing_cancelled" as const, log })),
    ...listingPurchased.map((log) => ({ kind: "listing_purchased" as const, log })),
    ...secondaryAuctionCreated.map((log) => ({ kind: "auction_created" as const, log })),
    ...bids.map((log) => ({ kind: "bid" as const, log })),
    ...refunds.map((log) => ({ kind: "refund" as const, log })),
    ...secondaryAuctionCancelled.map((log) => ({ kind: "auction_cancelled" as const, log })),
    ...secondaryAuctionSettled.map((log) => ({ kind: "auction_settled" as const, log })),
    ...withdrawals.map((log) => ({ kind: "withdrawal" as const, log })),
    ...proceedsAvailable.map((log) => ({ kind: "proceeds_available" as const, log })),
    ...proceedsWithdrawals.map((log) => ({ kind: "proceeds_withdrawal" as const, log })),
  ].sort((a, b) => compareLogs(a.log, b.log));

  if (logs.length === 0) return;

  const db = await pool.connect();
  const pendingAdminNotifications: Array<{
    chainId: number;
    source: "primary_auction" | "marketplace";
    eventType: string;
    entityType: string;
    entityId: bigint;
    name?: string | null;
    node?: `0x${string}` | null;
    seller?: `0x${string}` | null;
    actor?: `0x${string}` | null;
    amount?: bigint | null;
    status?: string | null;
    winner?: `0x${string}` | null;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  const pendingSubscriberNotifications: Array<{
    chainId: number;
    eventType: string;
    entityType: "listing" | "auction";
    entityId: bigint;
    name: string;
    fqdn: string;
    node: `0x${string}`;
    seller: `0x${string}`;
    actor?: `0x${string}` | null;
    previousHighestBidder?: `0x${string}` | null;
    amount?: bigint | null;
    status?: string | null;
    winner?: `0x${string}` | null;
    txHash: `0x${string}`;
    logIndex: number;
  }> = [];
  try {
    await db.query("begin");

    for (const entry of logs) {
      const { log } = entry;
      if (!log.transactionHash || log.blockNumber == null || log.logIndex == null) continue;
      const blockTime = await getBlockTime(log.blockNumber);

      if (entry.kind === "listed") {
        const args = (log as (typeof listed)[number]).args;
        const listingId = args.listingId as bigint;
        const name = normalizeLabel(args.name as string);
        if (!name) continue;
        const seller = toLowerHex(args.seller as `0x${string}`) as `0x${string}`;
        const price = (args.price as bigint | undefined) ?? 0n;
        await upsertRnsMarketplaceListing(db, {
          chainId: config.riseTestnetChainId,
          listingId,
          node: args.node as `0x${string}`,
          name,
          seller,
          price,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTime,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "listing",
          eventType: "marketplace.listed",
          entityId: listingId,
          name,
          account: seller,
          amount: price,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
          payload: { node: String(args.node).toLowerCase() },
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          eventType: "marketplace.listed",
          entityType: "listing",
          entityId: listingId,
          name,
          node: args.node as `0x${string}`,
          seller,
          actor: seller,
          amount: price,
          status: "active",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        pendingSubscriberNotifications.push({
          chainId: config.riseTestnetChainId,
          eventType: "marketplace.listed",
          entityType: "listing",
          entityId: listingId,
          name,
          fqdn: `${name}.rise`,
          node: args.node as `0x${string}`,
          seller,
          actor: seller,
          amount: price,
          status: "active",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        continue;
      }

      if (entry.kind === "listing_cancelled") {
        const listingId = (log as (typeof listingCancelled)[number]).args.listingId as bigint;
        await applyRnsMarketplaceListingCancelled(db, {
          chainId: config.riseTestnetChainId,
          listingId,
          blockNumber: log.blockNumber,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "listing",
          eventType: "marketplace.listing_cancelled",
          entityId: listingId,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsMarketplaceListingById(db, {
          chainId: config.riseTestnetChainId,
          listingId,
        });
        if (record) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "marketplace",
            eventType: "marketplace.listing_cancelled",
            entityType: "listing",
            entityId: listingId,
            name: record.name,
            node: record.node,
            seller: record.seller,
            status: "cancelled",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "listing_purchased") {
        const args = (log as (typeof listingPurchased)[number]).args;
        const listingId = args.listingId as bigint;
        const buyer = toLowerHex(args.buyer as `0x${string}`) as `0x${string}`;
        const price = (args.price as bigint | undefined) ?? 0n;
        await applyRnsMarketplaceListingPurchased(db, {
          chainId: config.riseTestnetChainId,
          listingId,
          buyer,
          price,
          blockNumber: log.blockNumber,
        });
        const record = await getRnsMarketplaceListingById(db, {
          chainId: config.riseTestnetChainId,
          listingId,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "listing",
          eventType: "marketplace.listing_purchased",
          entityId: listingId,
          name: record?.name ?? null,
          account: buyer,
          amount: price,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        if (record) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "marketplace",
            eventType: "marketplace.listing_purchased",
            entityType: "listing",
            entityId: listingId,
            name: record.name,
            node: record.node,
            seller: record.seller,
            actor: buyer,
            amount: price,
            status: "purchased",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
          pendingSubscriberNotifications.push({
            chainId: config.riseTestnetChainId,
            eventType: "marketplace.listing_purchased",
            entityType: "listing",
            entityId: listingId,
            name: record.name,
            fqdn: record.fqdn,
            node: record.node,
            seller: record.seller,
            actor: buyer,
            amount: price,
            status: "purchased",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "auction_created") {
        const args = (log as (typeof secondaryAuctionCreated)[number]).args;
        const auctionId = args.auctionId as bigint;
        const name = normalizeLabel(args.name as string);
        if (!name) continue;
        const seller = toLowerHex(args.seller as `0x${string}`) as `0x${string}`;
        const reservePrice = (args.reservePrice as bigint | undefined) ?? 0n;
        await upsertRnsMarketplaceAuction(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          node: args.node as `0x${string}`,
          name,
          seller,
          reservePrice,
          startTime: (args.startTime as bigint | undefined) ?? 0n,
          endTime: (args.endTime as bigint | undefined) ?? 0n,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTime,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "auction",
          eventType: "marketplace.auction_created",
          entityId: auctionId,
          name,
          account: seller,
          amount: reservePrice,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
          payload: {
            node: String(args.node).toLowerCase(),
            startTime: ((args.startTime as bigint | undefined) ?? 0n).toString(),
            endTime: ((args.endTime as bigint | undefined) ?? 0n).toString(),
          },
        });
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          eventType: "marketplace.auction_created",
          entityType: "auction",
          entityId: auctionId,
          name,
          node: args.node as `0x${string}`,
          seller,
          actor: seller,
          amount: reservePrice,
          status: "scheduled",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        pendingSubscriberNotifications.push({
          chainId: config.riseTestnetChainId,
          eventType: "marketplace.auction_created",
          entityType: "auction",
          entityId: auctionId,
          name,
          fqdn: `${name}.rise`,
          node: args.node as `0x${string}`,
          seller,
          actor: seller,
          amount: reservePrice,
          status: "scheduled",
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
        continue;
      }

      if (entry.kind === "bid") {
        const args = (log as (typeof bids)[number]).args;
        const auctionId = args.auctionId as bigint;
        const bidder = toLowerHex(args.bidder as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        const previousRecord = await getRnsMarketplaceAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        await applyRnsMarketplaceAuctionBid(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          bidder,
          amount,
          endTime: (args.endTime as bigint | undefined) ?? 0n,
          nextExtensionWindow: (args.nextExtensionWindow as bigint | undefined) ?? 0n,
          blockNumber: log.blockNumber,
        });
        const record = await getRnsMarketplaceAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "auction",
          eventType: "marketplace.bid",
          entityId: auctionId,
          name: record?.name ?? null,
          account: bidder,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
          payload: {
            endTime: ((args.endTime as bigint | undefined) ?? 0n).toString(),
            nextExtensionWindow: ((args.nextExtensionWindow as bigint | undefined) ?? 0n).toString(),
          },
        });
        if (record) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "marketplace",
            eventType: "marketplace.bid",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            node: record.node,
            seller: record.seller,
            actor: bidder,
            amount,
            status: record.status,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
          pendingSubscriberNotifications.push({
            chainId: config.riseTestnetChainId,
            eventType: "marketplace.bid",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            fqdn: record.fqdn,
            node: record.node,
            seller: record.seller,
            actor: bidder,
            previousHighestBidder: previousRecord?.highestBidder ?? null,
            amount,
            status: record.status,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "refund") {
        const args = (log as (typeof refunds)[number]).args;
        const auctionId = args.auctionId as bigint;
        const bidder = toLowerHex(args.bidder as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "refund",
          eventType: "marketplace.refund_available",
          entityId: auctionId,
          account: bidder,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsMarketplaceAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        if (record) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "marketplace",
            eventType: "marketplace.refund_available",
            entityType: "refund",
            entityId: auctionId,
            name: record.name,
            node: record.node,
            seller: record.seller,
            actor: bidder,
            amount,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "auction_cancelled") {
        const auctionId = (log as (typeof secondaryAuctionCancelled)[number]).args.auctionId as bigint;
        await applyRnsMarketplaceAuctionCancelled(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          blockNumber: log.blockNumber,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "auction",
          eventType: "marketplace.auction_cancelled",
          entityId: auctionId,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsMarketplaceAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        if (record) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "marketplace",
            eventType: "marketplace.auction_cancelled",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            node: record.node,
            seller: record.seller,
            status: "cancelled",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "auction_settled") {
        const args = (log as (typeof secondaryAuctionSettled)[number]).args;
        const auctionId = args.auctionId as bigint;
        const winnerAddress = toLowerHex(args.winner as `0x${string}`) as `0x${string}`;
        const winner = winnerAddress === ZERO_ADDRESS ? null : winnerAddress;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        await applyRnsMarketplaceAuctionSettled(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
          winner,
          amount,
          blockNumber: log.blockNumber,
        });
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "auction",
          eventType: "marketplace.auction_settled",
          entityId: auctionId,
          account: winner,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        const record = await getRnsMarketplaceAuctionById(db, {
          chainId: config.riseTestnetChainId,
          auctionId,
        });
        if (record) {
          pendingAdminNotifications.push({
            chainId: config.riseTestnetChainId,
            source: "marketplace",
            eventType: "marketplace.auction_settled",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            node: record.node,
            seller: record.seller,
            actor: winner,
            amount,
            status: "settled",
            winner,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
          pendingSubscriberNotifications.push({
            chainId: config.riseTestnetChainId,
            eventType: "marketplace.auction_settled",
            entityType: "auction",
            entityId: auctionId,
            name: record.name,
            fqdn: record.fqdn,
            node: record.node,
            seller: record.seller,
            actor: winner,
            amount,
            status: "settled",
            winner,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
          });
        }
        continue;
      }

      if (entry.kind === "proceeds_available") {
        const args = (log as (typeof proceedsAvailable)[number]).args;
        const entityId = args.entityId as bigint;
        const account = toLowerHex(args.account as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        const isAuction = Boolean(args.isAuction);
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: isAuction ? "auction_proceeds" : "listing_proceeds",
          eventType: "marketplace.proceeds_available",
          entityId,
          account,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
          payload: { isAuction },
        });
        continue;
      }

      if (entry.kind === "proceeds_withdrawal") {
        const args = (log as (typeof proceedsWithdrawals)[number]).args;
        const account = toLowerHex(args.account as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
        await recordRnsMarketplaceEvent(db, {
          chainId: config.riseTestnetChainId,
          source: "marketplace",
          entityType: "proceeds_withdrawal",
          eventType: "marketplace.proceeds_withdrawal",
          account,
          amount,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          blockTime,
        });
        continue;
      }

      const args = (log as (typeof withdrawals)[number]).args;
      const account = toLowerHex(args.account as `0x${string}`) as `0x${string}`;
      const amount = (args.amount as bigint | undefined) ?? 0n;
      await recordRnsMarketplaceEvent(db, {
        chainId: config.riseTestnetChainId,
        source: "marketplace",
        entityType: "withdrawal",
        eventType: "marketplace.withdrawal",
        account,
        amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        blockTime,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }

  if (emitNotifications) {
    for (const notification of pendingAdminNotifications) {
      await safelyNotify("admin-marketplace", () =>
        notifyAdminRnsMarketplaceActivity(notification),
      );
    }

    for (const notification of pendingSubscriberNotifications) {
      await safelyNotify("marketplace-subscribers", () =>
        notifyMarketplaceSubscribers(notification),
      );
    }
  }
}

async function syncJob(jobName: JobName) {
  const states = await getRnsSyncStates(config.riseTestnetChainId);
  const expectedContractAddress = getJobContractAddress(jobName);
  const currentState = states.find(
    (state) =>
      state.jobName === jobName &&
      state.contractAddress.toLowerCase() === expectedContractAddress.toLowerCase(),
  );
  const previousDeploymentState = states.find(
    (state) =>
      state.jobName === jobName &&
      state.contractAddress.toLowerCase() !== expectedContractAddress.toLowerCase(),
  );
  const head = await client.getBlockNumber();
  const emitNotifications = Boolean(
    currentState && head - currentState.lastProcessedBlock <= MARKETPLACE_MAX_BACKFILL_BLOCKS,
  );
  const initialBlock = await getInitialJobBlock(jobName);
  let startBlock = currentState
    ? (currentState.lastProcessedBlock < initialBlock ? initialBlock : currentState.lastProcessedBlock + 1n)
    : initialBlock;

  if (!currentState && (jobName === "registry" || jobName === "resolver")) {
    // Registrar events discover labels; direct reconciliation supplies current
    // ownership and resolver state without replaying every historical update.
    startBlock = head;
  }

  if (!currentState && previousDeploymentState) {
    logger.warn("RNS index contract changed; initializing the active deployment", {
      jobName,
      chainId: config.riseTestnetChainId,
      previousContractAddress: previousDeploymentState.contractAddress,
      contractAddress: expectedContractAddress,
      startBlock: startBlock.toString(),
    });
  }

  if (
    (jobName === "primary_auction" || jobName === "marketplace") &&
    head - startBlock > MARKETPLACE_MAX_BACKFILL_BLOCKS
  ) {
    const recentStart = head > MARKETPLACE_RECENT_EVENT_BLOCKS
      ? head - MARKETPLACE_RECENT_EVENT_BLOCKS
      : initialBlock;
    startBlock = recentStart > initialBlock ? recentStart : initialBlock;
    logger.warn("RNS marketplace event index was stale; resuming from recent chain tail", {
      jobName,
      chainId: config.riseTestnetChainId,
      previousBlock: currentState?.lastProcessedBlock.toString() ?? null,
      resumeBlock: startBlock.toString(),
      headBlock: head.toString(),
    });
  }

  if (startBlock > head) return;

  let cursor = startBlock;
  while (cursor <= head) {
    const chunkSize = BigInt(config.rnsSyncChunkSize) > RNS_RPC_MAX_LOG_RANGE
      ? RNS_RPC_MAX_LOG_RANGE
      : BigInt(config.rnsSyncChunkSize);
    const toBlock = cursor + chunkSize - 1n > head
      ? head
      : cursor + chunkSize - 1n;

    if (jobName === "registrar") await syncRegistrarRange(cursor, toBlock, emitNotifications);
    if (jobName === "registry") await syncRegistryRange(cursor, toBlock);
    if (jobName === "resolver") await syncResolverRange(cursor, toBlock);
    if (jobName === "primary_auction") await syncPrimaryAuctionRange(cursor, toBlock, emitNotifications);
    if (jobName === "marketplace") await syncMarketplaceRange(cursor, toBlock, emitNotifications);

    await upsertRnsSyncState({
      jobName,
      chainId: config.riseTestnetChainId,
      contractAddress: getJobContractAddress(jobName),
      lastProcessedBlock: toBlock,
      lastProcessedBlockHash: await getBlockHash(toBlock),
    });

    cursor = toBlock + 1n;
  }
}

async function runSync(reason: string, jobNames: readonly JobName[] = DEFAULT_JOB_ORDER) {
  const startedAt = Date.now();
  try {
    await assertRnsContractConfiguration();
    for (const jobName of jobNames) {
      await syncJob(jobName);
    }
    if (
      reason === "startup" &&
      jobNames.some((jobName) =>
        jobName === "registrar" || jobName === "registry" || jobName === "resolver",
      )
    ) {
      await ensureRnsReconciliation("startup-post-sync");
    }
  } finally {
    blockTimeCache.clear();
  }
  logger.info("RNS sync complete", {
    reason,
    chainId: config.riseTestnetChainId,
    jobs: jobNames,
    durationMs: Date.now() - startedAt,
  });
}

async function reconcileAfterSyncFailure(reason: string, error: unknown) {
  logger.warn("RNS sync failed; falling back to direct name reconciliation", {
    reason,
    error: error instanceof Error ? error.message : String(error),
  });

  try {
    await ensureRnsReconciliation(`${reason}-sync-fallback`);
  } catch (fallbackError) {
    logger.warn("RNS direct reconciliation fallback failed", {
      reason,
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    });
  }
}

async function runReconciliation(reason: string) {
  try {
    await assertRnsContractConfiguration();
    const names = await getRnsNamesForReconciliation(
      config.riseTestnetChainId,
      ACTIVE_RNS_REGISTRAR_START_BLOCK,
    );
    if (names.length === 0) return;

    let head: bigint;
    try {
      head = await client.getBlockNumber();
    } catch (error) {
      const states = await getRnsSyncStates(config.riseTestnetChainId);
      head = states.reduce(
        (max, state) => (state.lastProcessedBlock > max ? state.lastProcessedBlock : max),
        0n,
      );
      logger.warn("RNS reconciliation could not read latest block; using last indexed block", {
        reason,
        fallbackBlock: head.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const db = await pool.connect();

    try {
      await db.query("begin");

      for (const name of names) {
        let owner: `0x${string}` | null = name.owner;
        let resolver = name.resolver;
        let resolvedAddress = name.resolvedAddress;
        let label = name.label;
        let fqdn = name.fqdn;
        let expiry: bigint | null = null;
        let ownerKnown = false;
        let resolverKnown = false;
        let resolvedAddressKnown = false;

        try {
          const ownerRaw = await client.readContract({
            address: config.rnsContracts.registry as `0x${string}`,
            abi: registryReadAbi,
            functionName: "owner",
            args: [name.node],
          });
          owner = (toLowerHex(ownerRaw as `0x${string}`) ?? ZERO_ADDRESS) as `0x${string}`;
          ownerKnown = true;
        } catch {
          owner = null;
        }

        try {
          const resolverRaw = await client.readContract({
            address: config.rnsContracts.registry as `0x${string}`,
            abi: registryReadAbi,
            functionName: "resolver",
            args: [name.node],
          });
          const nextResolver = toLowerHex(resolverRaw as `0x${string}`);
          resolver = isZeroAddress(nextResolver) ? null : (nextResolver as `0x${string}`);
          resolverKnown = true;
        } catch {
          resolver = name.resolver;
        }

        if (resolverKnown && resolver) {
          try {
            const addrRaw = await client.readContract({
              address: resolver,
              abi: resolverReadAbi,
              functionName: "addr",
              args: [name.node],
            });
            const nextAddress = toLowerHex(addrRaw as `0x${string}`);
            resolvedAddress = isZeroAddress(nextAddress) ? null : (nextAddress as `0x${string}`);
            resolvedAddressKnown = true;
          } catch {
            resolvedAddress = name.resolvedAddress;
          }

          if (!label) {
            try {
              const onChainLabel = await client.readContract({
                address: resolver,
                abi: resolverReadAbi,
                functionName: "text",
                args: [name.node, "label"],
              });
              label = normalizeLabel(onChainLabel as string);
              fqdn = toFqdn(label);
            } catch {
              label = name.label;
              fqdn = name.fqdn;
            }
          }
        } else if (resolverKnown) {
          resolvedAddress = null;
          resolvedAddressKnown = true;
        }

        if (label) {
          try {
            expiry = await client.readContract({
              address: config.rnsContracts.registrar as `0x${string}`,
              abi: registrarReadAbi,
              functionName: "expiryOf",
              args: [label],
            });
          } catch {
            expiry = null;
          }
        }

        const wouldEraseActiveName =
          ownerKnown &&
          isZeroAddress(owner) &&
          (expiry === null || expiry === 0n) &&
          !isZeroAddress(name.owner) &&
          name.expiry > 0n;

        if (wouldEraseActiveName) {
          logger.warn("RNS reconciliation ignored zero owner/expiry read for active name", {
            reason,
            chainId: config.riseTestnetChainId,
            node: name.node,
            label: name.label,
            previousOwner: name.owner,
            previousExpiry: name.expiry.toString(),
          });
          owner = name.owner;
          ownerKnown = false;
          expiry = null;
        }

        await applyRnsReconciliation(db, {
          chainId: config.riseTestnetChainId,
          node: name.node,
          label,
          fqdn,
          owner,
          resolver,
          resolvedAddress,
          expiry,
          updatedBlock: head,
          ownerKnown,
          resolverKnown,
          resolvedAddressKnown,
        });
      }

      await db.query("commit");
      logger.info("RNS reconciliation complete", {
        reason,
        chainId: config.riseTestnetChainId,
        names: names.length,
      });
    } catch (error) {
      await db.query("rollback");
      throw error;
    } finally {
      db.release();
    }
  } finally {
    blockTimeCache.clear();
  }
}

export async function ensureRnsSync(
  reason = "manual",
  jobNames: readonly JobName[] = DEFAULT_JOB_ORDER,
) {
  const isDefaultJobSet =
    jobNames.length === DEFAULT_JOB_ORDER.length &&
    jobNames.every((jobName, index) => jobName === DEFAULT_JOB_ORDER[index]);

  if (!isDefaultJobSet) {
    return runSync(reason, jobNames).catch(async (error) => {
      logger.error("RNS sync failed", {
        reason,
        jobs: jobNames,
        error: error instanceof Error ? error.message : String(error),
      });
      await reconcileAfterSyncFailure(reason, error);
      throw error;
    });
  }

  if (!syncPromise) {
    syncPromise = runSync(reason)
      .catch(async (error) => {
        logger.error("RNS sync failed", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        await reconcileAfterSyncFailure(reason, error);
        throw error;
      })
      .finally(() => {
        syncPromise = null;
      });
  }

  return syncPromise;
}

export async function ensureRnsReconciliation(reason = "manual") {
  if (!reconcilePromise) {
    reconcilePromise = runReconciliation(reason)
      .catch((error) => {
        logger.error("RNS reconciliation failed", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        reconcilePromise = null;
      });
  }

  return reconcilePromise;
}

export async function ensureRnsIndexFresh(
  reason = "request",
  jobNames: readonly JobName[] = DEFAULT_JOB_ORDER,
) {
  const states = await getRnsSyncStates(config.riseTestnetChainId);
  const head = await client.getBlockNumber();
  const staleCutoff = Date.now() - config.rnsSyncIntervalSeconds * 2 * 1000;
  const targetStates = states.filter(
    (state) =>
      jobNames.includes(state.jobName as JobName) &&
      state.contractAddress.toLowerCase() === getJobContractAddress(state.jobName as JobName).toLowerCase(),
  );
  const hasAllJobs = jobNames.every((jobName) => targetStates.some((state) => state.jobName === jobName));
  const staleState = targetStates.some((state) => {
    if (!state.lastProcessedAt) return true;
    return Date.parse(state.lastProcessedAt) < staleCutoff;
  });
  const behindHead = targetStates.some((state) => state.lastProcessedBlock < head);

  if (!hasAllJobs || staleState || behindHead) {
    await ensureRnsSync(reason, jobNames);
  }
}

async function runRnsAuctionLifecycleNotifications(reason: string) {
  await ensureRnsMarketplaceSnapshot(`auction-lifecycle-${reason}`);
  const endedAuctions = await getRnsEndedAuctionsForLifecycle({
    chainId: config.riseTestnetChainId,
    nowUnix: BigInt(Math.floor(Date.now() / 1000)),
  });

  for (const auction of endedAuctions) {
    const node = auction.node ?? computeRnsNode(auction.name);
    if (!node) continue;
    await safelyNotify(`${auction.source}-ended-${auction.auctionId}`, () =>
      notifyAuctionEndedLifecycle({
        chainId: auction.chainId,
        source: auction.source,
        auctionId: auction.auctionId,
        name: auction.name,
        fqdn: auction.fqdn,
        node,
        seller: auction.seller,
        highestBidder: auction.highestBidder,
        highestBid: auction.highestBid,
        bidCount: auction.bidCount,
        endTime: auction.endTime,
      }),
    );
  }

  if (endedAuctions.length > 0) {
    logger.info("RNS auction lifecycle check complete", {
      reason,
      endedAuctions: endedAuctions.length,
    });
  }
}

export function ensureRnsAuctionLifecycleNotifications(reason = "manual") {
  if (!auctionLifecyclePromise) {
    auctionLifecyclePromise = runRnsAuctionLifecycleNotifications(reason).finally(() => {
      auctionLifecyclePromise = null;
    });
  }
  return auctionLifecyclePromise;
}

function refreshRnsIndexInBackground(
  reason = "request",
  jobNames: readonly JobName[] = DEFAULT_JOB_ORDER,
) {
  void ensureRnsIndexFresh(reason, jobNames).catch((error) => {
    logger.warn("RNS background refresh failed", {
      reason,
      jobs: jobNames,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export function startRnsJobs() {
  if (jobsStarted) return;
  jobsStarted = true;

  void ensureRnsSync("startup").catch((error) => {
    logger.warn("RNS startup sync did not complete", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  void ensureRnsReconciliation("startup").catch((error) => {
    logger.warn("RNS startup reconciliation did not complete", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  void ensureRnsMarketplaceSnapshot("startup", true).catch((error) => {
    logger.warn("RNS startup marketplace snapshot did not complete", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  void ensureRnsAuctionLifecycleNotifications("startup").catch((error) => {
    logger.warn("RNS startup auction lifecycle check did not complete", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const syncTimer = setInterval(() => {
    void ensureRnsSync("interval").catch((error) => {
      logger.warn("RNS interval sync did not complete", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, config.rnsSyncIntervalSeconds * 1000);
  syncTimer.unref?.();

  const marketplaceSnapshotTimer = setInterval(() => {
    void ensureRnsMarketplaceSnapshot("interval").catch((error) => {
      logger.warn("RNS marketplace snapshot did not complete", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000);
  marketplaceSnapshotTimer.unref?.();

  const auctionLifecycleTimer = setInterval(() => {
    void ensureRnsAuctionLifecycleNotifications("interval").catch((error) => {
      logger.warn("RNS auction lifecycle check did not complete", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, config.rnsAuctionLifecycleIntervalSeconds * 1000);
  auctionLifecycleTimer.unref?.();

  const reconcileTimer = setInterval(() => {
    void ensureRnsReconciliation("interval");
  }, config.rnsReconcileIntervalSeconds * 1000);
  reconcileTimer.unref?.();
}

export async function listOwnedRnsNames(owner: string, chainId: number) {
  if (chainId !== config.riseTestnetChainId) {
    return [];
  }

  await ensureRnsMarketplaceSnapshot("names-read").catch((error) => {
    logger.warn("RNS names read is using the last marketplace snapshot", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  refreshRnsIndexInBackground("names-read", WALLET_NAME_JOB_ORDER);
  const normalizedOwner = getAddress(owner).toLowerCase();
  const nowUnix = BigInt(Math.floor(Date.now() / 1000));
  const names = await getRnsOwnedNames({
    chainId,
    owner: normalizedOwner,
    nowUnix,
    minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
  });

  const marketplaceNames = await getRnsMarketplaceNamesBySeller({
    chainId,
    seller: normalizedOwner,
    nowUnix,
    escrowOwner: config.rnsContracts.marketplace,
    minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
  });
  const ownedNodes = new Set(names.map((name) => name.node.toLowerCase()));

  return [
    ...names,
    ...marketplaceNames.filter((name) => !ownedNodes.has(name.node.toLowerCase())),
  ];
}

function isRnsExpired(name: RnsNameRecord, nowUnix = BigInt(Math.floor(Date.now() / 1000))) {
  return name.expiry <= nowUnix || name.releasedAt !== null;
}

export function serializeRnsNameRecord(name: RnsNameRecord) {
  return {
    chainId: name.chainId,
    node: name.node,
    label: name.label,
    name: name.fqdn,
    fqdn: name.fqdn,
    owner: name.owner,
    registrant: name.registrant,
    resolver: name.resolver,
    resolvedAddress: name.resolvedAddress,
    expiry: name.expiry.toString(),
    isExpired: isRnsExpired(name),
    registeredTxHash: name.registeredTxHash,
    registeredAt: name.registeredAt.toString(),
    renewedAt: name.renewedAt?.toString() ?? null,
    releasedAt: name.releasedAt?.toString() ?? null,
    createdAtBlock: name.createdAtBlock.toString(),
    lastIndexedBlock: name.updatedBlock.toString(),
    lastIndexedAt: name.updatedAt,
    custody: name.custody,
    seller: name.seller,
    marketplace: serializeRnsNameMarketplace(name.marketplace),
  };
}

function serializeRnsNameMarketplace(marketplace: RnsNameRecord["marketplace"]) {
  if (!marketplace) return null;

  if (marketplace.kind === "listing") {
    return {
      kind: "listing",
      listingId: marketplace.listingId.toString(),
      status: marketplace.status,
      seller: marketplace.seller,
      price: marketplace.price.toString(),
      buyer: marketplace.buyer,
      purchasedPrice: marketplace.purchasedPrice?.toString() ?? null,
      createdTxHash: marketplace.createdTxHash,
      createdBlock: marketplace.createdBlock?.toString() ?? null,
      createdAt: marketplace.createdAt,
      lastIndexedBlock: marketplace.updatedBlock.toString(),
      lastIndexedAt: marketplace.updatedAt,
    };
  }

  return {
    kind: "auction",
    auctionId: marketplace.auctionId.toString(),
    status: timedAuctionStatus(marketplace.status, marketplace.startTime, marketplace.endTime),
    rawStatus: marketplace.status,
    seller: marketplace.seller,
    reservePrice: marketplace.reservePrice.toString(),
    startTime: marketplace.startTime.toString(),
    endTime: marketplace.endTime.toString(),
    currentExtensionWindow: marketplace.currentExtensionWindow?.toString() ?? null,
    bidCount: marketplace.bidCount,
    highestBidder: marketplace.highestBidder,
    highestBid: marketplace.highestBid.toString(),
    winner: marketplace.winner,
    settledAmount: marketplace.settledAmount?.toString() ?? null,
    createdTxHash: marketplace.createdTxHash,
    createdBlock: marketplace.createdBlock?.toString() ?? null,
    createdAt: marketplace.createdAt,
    lastIndexedBlock: marketplace.updatedBlock.toString(),
    lastIndexedAt: marketplace.updatedAt,
  };
}

export function normalizeRnsLabel(input: string) {
  const label = normalizeLabel(input);
  if (!label) return null;
  if (!/^[a-z0-9-]{1,32}$/.test(label)) return null;
  if (label.startsWith("-") || label.endsWith("-")) return null;
  return label;
}

async function getRnsReadHead(reason: string) {
  try {
    return await client.getBlockNumber();
  } catch (error) {
    const states = await getRnsSyncStates(config.riseTestnetChainId);
    const fallbackBlock = states.reduce(
      (max, state) => (state.lastProcessedBlock > max ? state.lastProcessedBlock : max),
      ACTIVE_RNS_REGISTRAR_START_BLOCK,
    );
    logger.warn("RNS direct label reconciliation could not read latest block; using indexed head", {
      reason,
      fallbackBlock: fallbackBlock.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackBlock;
  }
}

export async function reconcileRnsKnownLabel(input: {
  label: string;
  chainId: number;
  reason?: string;
}) {
  await assertRnsContractConfiguration();
  if (input.chainId !== config.riseTestnetChainId) return null;

  const label = normalizeRnsLabel(input.label);
  if (!label) return null;

  const reason = input.reason ?? "known-label";
  const node = namehash(`${label}.rise`) as `0x${string}`;
  const fqdn = `${label}.rise`;
  const head = await getRnsReadHead(reason);

  let owner: `0x${string}` | null = null;
  let ownerKnown = false;
  let resolver: `0x${string}` | null = null;
  let resolverKnown = false;
  let resolvedAddress: `0x${string}` | null = null;
  let resolvedAddressKnown = false;
  let expiry: bigint | null = null;

  try {
    const ownerRaw = await client.readContract({
      address: config.rnsContracts.registry as `0x${string}`,
      abi: registryReadAbi,
      functionName: "owner",
      args: [node],
    });
    owner = (toLowerHex(ownerRaw as `0x${string}`) ?? ZERO_ADDRESS) as `0x${string}`;
    ownerKnown = true;
  } catch (error) {
    logger.warn("RNS known-label owner read failed", {
      reason,
      label,
      node,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const expiryRaw = await client.readContract({
      address: config.rnsContracts.registrar as `0x${string}`,
      abi: registrarReadAbi,
      functionName: "expiryOf",
      args: [label],
    });
    expiry = expiryRaw as bigint;
  } catch (error) {
    logger.warn("RNS known-label expiry read failed", {
      reason,
      label,
      node,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const resolverRaw = await client.readContract({
      address: config.rnsContracts.registry as `0x${string}`,
      abi: registryReadAbi,
      functionName: "resolver",
      args: [node],
    });
    const nextResolver = toLowerHex(resolverRaw as `0x${string}`);
    resolver = isZeroAddress(nextResolver) ? null : (nextResolver as `0x${string}`);
    resolverKnown = true;
  } catch {
    resolver = null;
  }

  if (resolverKnown && resolver) {
    try {
      const addrRaw = await client.readContract({
        address: resolver,
        abi: resolverReadAbi,
        functionName: "addr",
        args: [node],
      });
      const nextAddress = toLowerHex(addrRaw as `0x${string}`);
      resolvedAddress = isZeroAddress(nextAddress) ? null : (nextAddress as `0x${string}`);
      resolvedAddressKnown = true;
    } catch {
      resolvedAddress = null;
    }
  } else if (resolverKnown) {
    resolvedAddress = null;
    resolvedAddressKnown = true;
  }

  if (!ownerKnown && expiry === null) return null;

  const db = await pool.connect();
  try {
    await db.query("begin");

    const verifiedOwner = owner ?? (ZERO_ADDRESS as `0x${string}`);
    const verifiedExpiry = expiry ?? 0n;
    const active = !isZeroAddress(verifiedOwner) || verifiedExpiry > 0n;

    if (active && ownerKnown) {
      await upsertRnsKnownLabelSnapshot(db, {
        chainId: input.chainId,
        node,
        label,
        fqdn,
        owner: verifiedOwner,
        resolver,
        resolvedAddress,
        expiry: verifiedExpiry,
        blockNumber: head,
        minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
        resolverKnown,
        resolvedAddressKnown,
      });
    } else {
      await applyRnsReconciliation(db, {
        chainId: input.chainId,
        node,
        label,
        fqdn,
        owner: ownerKnown ? verifiedOwner : null,
        resolver,
        resolvedAddress,
        expiry,
        updatedBlock: head,
        ownerKnown,
        resolverKnown,
        resolvedAddressKnown,
      });
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }

  return getRnsNameByLabel({
    chainId: input.chainId,
    label,
    minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
  });
}

export async function resolveRnsName(input: { name: string; chainId: number }) {
  if (input.chainId !== config.riseTestnetChainId) return null;

  const label = normalizeRnsLabel(input.name);
  if (!label) return null;

  refreshRnsIndexInBackground("public-name-read", NAME_JOB_ORDER);

  const repaired = await reconcileRnsKnownLabel({
    label,
    chainId: input.chainId,
    reason: "public-name-read",
  }).catch((error) => {
    logger.warn("RNS public name direct reconciliation failed", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (repaired) return repaired;

  return getRnsNameByLabel({
    chainId: input.chainId,
    label,
    minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
  });
}

export async function resolveRnsPrimaryName(input: { address: string; chainId: number }) {
  if (input.chainId !== config.riseTestnetChainId) return null;

  refreshRnsIndexInBackground("public-address-read", NAME_JOB_ORDER);
  return getRnsPrimaryNameForAddress({
    chainId: input.chainId,
    address: getAddress(input.address).toLowerCase(),
    nowUnix: BigInt(Math.floor(Date.now() / 1000)),
    minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
  });
}

export async function getRnsIndexHealth() {
  const [states, nameCount] = await Promise.all([
    getRnsSyncStates(config.riseTestnetChainId),
    getRnsNameCount(config.riseTestnetChainId, ACTIVE_RNS_REGISTRAR_START_BLOCK),
  ]);

  return {
    chainId: config.riseTestnetChainId,
    namesIndexed: nameCount,
    jobs: states
      .filter(
        (state) =>
          state.contractAddress.toLowerCase() === getJobContractAddress(state.jobName as JobName).toLowerCase(),
      )
      .map((state) => ({
      jobName: state.jobName,
      chainId: state.chainId,
      contractAddress: state.contractAddress,
      lastProcessedBlock: state.lastProcessedBlock.toString(),
      lastProcessedBlockHash: state.lastProcessedBlockHash,
      lastProcessedAt: state.lastProcessedAt,
      updatedAt: state.updatedAt,
      })),
  };
}

function timedAuctionStatus(status: string, startTime: bigint, endTime: bigint) {
  if (status === "cancelled" || status === "settled") return status;
  const nowUnix = BigInt(Math.floor(Date.now() / 1000));
  if (nowUnix < startTime) return "scheduled";
  if (nowUnix > endTime) return "ended";
  return "active";
}

function serializePrimaryAuctionRecord(auction: RnsPrimaryAuctionRecord) {
  return {
    chainId: auction.chainId,
    auctionId: auction.auctionId.toString(),
    name: auction.name,
    fqdn: auction.fqdn,
    duration: auction.duration.toString(),
    reservePrice: auction.reservePrice.toString(),
    startTime: auction.startTime.toString(),
    endTime: auction.endTime.toString(),
    currentExtensionWindow: auction.currentExtensionWindow?.toString() ?? null,
    bidCount: auction.bidCount,
    highestBidder: auction.highestBidder,
    highestBid: auction.highestBid.toString(),
    status: timedAuctionStatus(auction.status, auction.startTime, auction.endTime),
    rawStatus: auction.status,
    winner: auction.winner,
    settledAmount: auction.settledAmount?.toString() ?? null,
    createdTxHash: auction.createdTxHash,
    createdBlock: auction.createdBlock?.toString() ?? null,
    createdAt: auction.createdAt,
    lastIndexedBlock: auction.updatedBlock.toString(),
    lastIndexedAt: auction.updatedAt,
  };
}

function serializeMarketplaceListingRecord(listing: RnsMarketplaceListingRecord) {
  return {
    chainId: listing.chainId,
    listingId: listing.listingId.toString(),
    node: listing.node,
    name: listing.name,
    fqdn: listing.fqdn,
    seller: listing.seller,
    price: listing.price.toString(),
    status: listing.status,
    buyer: listing.buyer,
    purchasedPrice: listing.purchasedPrice?.toString() ?? null,
    createdTxHash: listing.createdTxHash,
    createdBlock: listing.createdBlock?.toString() ?? null,
    createdAt: listing.createdAt,
    lastIndexedBlock: listing.updatedBlock.toString(),
    lastIndexedAt: listing.updatedAt,
  };
}

function serializeMarketplaceAuctionRecord(auction: RnsMarketplaceAuctionRecord) {
  return {
    chainId: auction.chainId,
    auctionId: auction.auctionId.toString(),
    node: auction.node,
    name: auction.name,
    fqdn: auction.fqdn,
    seller: auction.seller,
    reservePrice: auction.reservePrice.toString(),
    startTime: auction.startTime.toString(),
    endTime: auction.endTime.toString(),
    currentExtensionWindow: auction.currentExtensionWindow?.toString() ?? null,
    bidCount: auction.bidCount,
    highestBidder: auction.highestBidder,
    highestBid: auction.highestBid.toString(),
    status: timedAuctionStatus(auction.status, auction.startTime, auction.endTime),
    rawStatus: auction.status,
    winner: auction.winner,
    settledAmount: auction.settledAmount?.toString() ?? null,
    createdTxHash: auction.createdTxHash,
    createdBlock: auction.createdBlock?.toString() ?? null,
    createdAt: auction.createdAt,
    lastIndexedBlock: auction.updatedBlock.toString(),
    lastIndexedAt: auction.updatedAt,
  };
}

function serializeMarketplaceEventRecord(event: RnsMarketplaceEventRecord) {
  return {
    id: event.id.toString(),
    chainId: event.chainId,
    source: event.source,
    entityType: event.entityType,
    eventType: event.eventType,
    entityId: event.entityId?.toString() ?? null,
    name: event.name,
    account: event.account,
    counterparty: event.counterparty,
    amount: event.amount?.toString() ?? null,
    txHash: event.txHash,
    blockNumber: event.blockNumber.toString(),
    logIndex: event.logIndex,
    blockTime: event.blockTime,
    payload: event.payload,
  };
}

export async function listRnsPrimaryAuctions(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  await ensureRnsMarketplaceSnapshot("primary-auctions-read").catch((error) => {
    logger.warn("RNS primary auctions read is using the last snapshot", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  refreshRnsIndexInBackground("primary-auctions-read", ["primary_auction"]);
  const auctions = await getRnsPrimaryAuctions({ chainId, limit });
  return auctions.map(serializePrimaryAuctionRecord);
}

export async function listRnsMarketplaceListings(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  await ensureRnsMarketplaceSnapshot("marketplace-listings-read").catch((error) => {
    logger.warn("RNS marketplace listings read is using the last snapshot", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  refreshRnsIndexInBackground("marketplace-listings-read", ["marketplace"]);
  const listings = await getRnsMarketplaceListings({ chainId, limit });
  return listings.map(serializeMarketplaceListingRecord);
}

export async function listRnsMarketplaceAuctions(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  await ensureRnsMarketplaceSnapshot("marketplace-auctions-read").catch((error) => {
    logger.warn("RNS marketplace auctions read is using the last snapshot", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  refreshRnsIndexInBackground("marketplace-auctions-read", ["marketplace"]);
  const auctions = await getRnsMarketplaceAuctions({ chainId, limit });
  return auctions.map(serializeMarketplaceAuctionRecord);
}

export async function listRnsMarketplaceActivity(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  refreshRnsIndexInBackground("marketplace-activity-read", ["primary_auction", "marketplace"]);
  const events = await getRnsMarketplaceEvents({ chainId, limit });
  return events.map(serializeMarketplaceEventRecord);
}

export function computeRnsNode(label: string) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  return namehash(`${normalized}.rise`);
}
