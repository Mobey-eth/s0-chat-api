import { createPublicClient, decodeFunctionData, getAddress, http, parseAbi, parseAbiItem } from "viem";
import { namehash } from "viem/ens";
import { pool } from "../db.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import {
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
  recordRnsMarketplaceEvent,
  type RnsJobName,
  type RnsMarketplaceAuctionRecord,
  type RnsMarketplaceEventRecord,
  type RnsMarketplaceListingRecord,
  type RnsNameRecord,
  type RnsPrimaryAuctionRecord,
  upsertRnsMarketplaceAuction,
  upsertRnsMarketplaceListing,
  upsertRnsPrimaryAuction,
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
};

const deploymentBlockCache = new Map<string, Promise<bigint>>();
const blockTimeCache = new Map<bigint, Promise<Date>>();
let syncPromise: Promise<void> | null = null;
let reconcilePromise: Promise<void> | null = null;
let jobsStarted = false;

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
  try {
    const tx = await client.getTransaction({ hash: txHash });
    const decoded = decodeFunctionData({
      abi: registrarDecodeAbi,
      data: tx.input,
    });

    if (decoded.functionName === "register" || decoded.functionName === "registerFixedPremium") {
      const label = normalizeLabel(String(decoded.args[0]));
      const resolver = toLowerHex(decoded.args[2] as `0x${string}`);
      return { label, fqdn: toFqdn(label), resolver: isZeroAddress(resolver) ? null : resolver };
    }

    if (decoded.functionName === "controllerRegisterReserved" || decoded.functionName === "adminAssignProtected") {
      const label = normalizeLabel(String(decoded.args[0]));
      const resolver = toLowerHex(decoded.args[3] as `0x${string}`);
      return { label, fqdn: toFqdn(label), resolver: isZeroAddress(resolver) ? null : resolver };
    }

    if (decoded.functionName === "renew" || decoded.functionName === "release") {
      const label = normalizeLabel(String(decoded.args[0]));
      return { label, fqdn: toFqdn(label), resolver: null };
    }
  } catch {
    // Ignore decode failures; reconciliation can still fill label via resolver.text later.
  }

  return { label: null, fqdn: null, resolver: null };
}

async function syncRegistrarRange(fromBlock: bigint, toBlock: bigint) {
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
        pendingAdminNotifications.push({
          chainId: config.riseTestnetChainId,
          name: decoded.label,
          fqdn: decoded.fqdn,
          registrant: registrant as `0x${string}`,
          expiry: ((log as (typeof registered)[number]).args.expires as bigint | undefined) ?? 0n,
          txHash: log.transactionHash,
          logIndex: log.logIndex ?? 0,
        });
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

  for (const notification of pendingAdminNotifications) {
    await safelyNotify("admin-rns-registration", () => notifyAdminRnsRegistration(notification));
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

async function syncPrimaryAuctionRange(fromBlock: bigint, toBlock: bigint) {
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
        continue;
      }

      if (entry.kind === "bid") {
        const args = (log as (typeof bids)[number]).args;
        const auctionId = args.auctionId as bigint;
        const bidder = toLowerHex(args.bidder as `0x${string}`) as `0x${string}`;
        const amount = (args.amount as bigint | undefined) ?? 0n;
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
        continue;
      }

      if (entry.kind === "settled") {
        const args = (log as (typeof settled)[number]).args;
        const auctionId = args.auctionId as bigint;
        const winner = toLowerHex(args.winner as `0x${string}`) as `0x${string}`;
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

  for (const notification of pendingAdminNotifications) {
    await safelyNotify("admin-primary-auction", () =>
      notifyAdminRnsMarketplaceActivity(notification),
    );
  }
}

async function syncMarketplaceRange(fromBlock: bigint, toBlock: bigint) {
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
        const winner = toLowerHex(args.winner as `0x${string}`) as `0x${string}`;
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

async function syncJob(jobName: JobName) {
  const states = await getRnsSyncStates(config.riseTestnetChainId);
  const currentState = states.find((state) => state.jobName === jobName);
  const head = await client.getBlockNumber();
  const initialBlock = await getInitialJobBlock(jobName);
  const startBlock = currentState
    ? (currentState.lastProcessedBlock < initialBlock ? initialBlock : currentState.lastProcessedBlock + 1n)
    : initialBlock;

  if (startBlock > head) return;

  let cursor = startBlock;
  while (cursor <= head) {
    const toBlock = cursor + BigInt(config.rnsSyncChunkSize) - 1n > head
      ? head
      : cursor + BigInt(config.rnsSyncChunkSize) - 1n;

    if (jobName === "registrar") await syncRegistrarRange(cursor, toBlock);
    if (jobName === "registry") await syncRegistryRange(cursor, toBlock);
    if (jobName === "resolver") await syncResolverRange(cursor, toBlock);
    if (jobName === "primary_auction") await syncPrimaryAuctionRange(cursor, toBlock);
    if (jobName === "marketplace") await syncMarketplaceRange(cursor, toBlock);

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
    for (const jobName of jobNames) {
      await syncJob(jobName);
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

async function runReconciliation(reason: string) {
  try {
    const names = await getRnsNamesForReconciliation(
      config.riseTestnetChainId,
      ACTIVE_RNS_REGISTRAR_START_BLOCK,
    );
    if (names.length === 0) return;

    const head = await client.getBlockNumber();
    const db = await pool.connect();

    try {
      await db.query("begin");

      for (const name of names) {
        let owner = name.owner;
        let resolver = name.resolver;
        let resolvedAddress = name.resolvedAddress;
        let label = name.label;
        let fqdn = name.fqdn;
        let expiry: bigint | null = name.expiry;

        try {
          const ownerRaw = await client.readContract({
            address: config.rnsContracts.registry as `0x${string}`,
            abi: registryReadAbi,
            functionName: "owner",
            args: [name.node],
          });
          owner = (toLowerHex(ownerRaw as `0x${string}`) ?? ZERO_ADDRESS) as `0x${string}`;
        } catch {
          owner = ZERO_ADDRESS as `0x${string}`;
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
        } catch {
          resolver = null;
        }

        if (resolver) {
          try {
            const addrRaw = await client.readContract({
              address: resolver,
              abi: resolverReadAbi,
              functionName: "addr",
              args: [name.node],
            });
            const nextAddress = toLowerHex(addrRaw as `0x${string}`);
            resolvedAddress = isZeroAddress(nextAddress) ? null : (nextAddress as `0x${string}`);
          } catch {
            resolvedAddress = null;
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
        } else {
          resolvedAddress = null;
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
            expiry = name.expiry;
          }
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
    return runSync(reason, jobNames);
  }

  if (!syncPromise) {
    syncPromise = runSync(reason)
      .catch((error) => {
        logger.error("RNS sync failed", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
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
  const targetStates = states.filter((state) => jobNames.includes(state.jobName as JobName));
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

export function startRnsJobs() {
  if (jobsStarted) return;
  jobsStarted = true;

  void ensureRnsSync("startup");

  const syncTimer = setInterval(() => {
    void ensureRnsSync("interval");
  }, config.rnsSyncIntervalSeconds * 1000);
  syncTimer.unref?.();

  const reconcileTimer = setInterval(() => {
    void ensureRnsReconciliation("interval");
  }, config.rnsReconcileIntervalSeconds * 1000);
  reconcileTimer.unref?.();
}

export async function listOwnedRnsNames(owner: string, chainId: number) {
  if (chainId !== config.riseTestnetChainId) {
    return [];
  }

  await ensureRnsIndexFresh("names-read", WALLET_NAME_JOB_ORDER);
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

export async function resolveRnsName(input: { name: string; chainId: number }) {
  if (input.chainId !== config.riseTestnetChainId) return null;

  const label = normalizeRnsLabel(input.name);
  if (!label) return null;

  await ensureRnsIndexFresh("public-name-read", NAME_JOB_ORDER);
  return getRnsNameByLabel({
    chainId: input.chainId,
    label,
    minRegisteredBlock: ACTIVE_RNS_REGISTRAR_START_BLOCK,
  });
}

export async function resolveRnsPrimaryName(input: { address: string; chainId: number }) {
  if (input.chainId !== config.riseTestnetChainId) return null;

  await ensureRnsIndexFresh("public-address-read", NAME_JOB_ORDER);
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
    jobs: states.map((state) => ({
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
  await ensureRnsIndexFresh("primary-auctions-read");
  const auctions = await getRnsPrimaryAuctions({ chainId, limit });
  return auctions.map(serializePrimaryAuctionRecord);
}

export async function listRnsMarketplaceListings(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  await ensureRnsIndexFresh("marketplace-listings-read");
  const listings = await getRnsMarketplaceListings({ chainId, limit });
  return listings.map(serializeMarketplaceListingRecord);
}

export async function listRnsMarketplaceAuctions(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  await ensureRnsIndexFresh("marketplace-auctions-read");
  const auctions = await getRnsMarketplaceAuctions({ chainId, limit });
  return auctions.map(serializeMarketplaceAuctionRecord);
}

export async function listRnsMarketplaceActivity(chainId: number, limit = 50) {
  if (chainId !== config.riseTestnetChainId) return [];
  await ensureRnsIndexFresh("marketplace-activity-read");
  const events = await getRnsMarketplaceEvents({ chainId, limit });
  return events.map(serializeMarketplaceEventRecord);
}

export function computeRnsNode(label: string) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  return namehash(`${normalized}.rise`);
}
