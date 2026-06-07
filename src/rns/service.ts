import { createPublicClient, decodeFunctionData, getAddress, http, parseAbi, parseAbiItem } from "viem";
import { namehash } from "viem/ens";
import { pool } from "../db.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import {
  ZERO_ADDRESS,
  applyRnsOwnerTransfer,
  applyRnsReconciliation,
  applyRnsRelease,
  applyRnsRenewal,
  applyRnsResolvedAddressUpdate,
  applyRnsResolverUpdate,
  getRnsNameCount,
  getRnsNamesForReconciliation,
  getRnsOwnedNames,
  getRnsSyncStates,
  upsertRnsRegistration,
  upsertRnsSyncState,
} from "./store.js";

const client = createPublicClient({
  transport: http(config.riseTestnetRpcUrl),
});

const registrarDecodeAbi = parseAbi([
  "function register(string name, uint256 duration, address resolver_)",
  "function renew(string name, uint256 duration)",
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

const registryReadAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
]);

const resolverReadAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);

const registrarReadAbi = parseAbi(["function expiryOf(string name) view returns (uint256)"]);

const DEFAULT_JOB_ORDER = ["registrar", "registry", "resolver"] as const;
type JobName = (typeof DEFAULT_JOB_ORDER)[number];

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
  const override = config.rnsStartBlocks[jobName];
  if (typeof override === "bigint") return override;

  const address =
    jobName === "registrar"
      ? config.rnsContracts.registrar
      : jobName === "registry"
        ? config.rnsContracts.registry
        : config.rnsContracts.resolver;

  return findDeploymentBlock(address);
}

async function decodeRegistrarCall(txHash: `0x${string}`): Promise<RegistrarDecodedCall> {
  try {
    const tx = await client.getTransaction({ hash: txHash });
    const decoded = decodeFunctionData({
      abi: registrarDecodeAbi,
      data: tx.input,
    });

    if (decoded.functionName === "register") {
      const label = normalizeLabel(String(decoded.args[0]));
      const resolver = toLowerHex(decoded.args[2] as `0x${string}`);
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
}

async function syncRegistryRange(fromBlock: bigint, toBlock: bigint) {
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
  const logs = await client.getLogs({
    address: config.rnsContracts.resolver as `0x${string}`,
    event: resolverEvents.addrChanged,
    fromBlock,
    toBlock,
  });

  if (logs.length === 0) return;

  const db = await pool.connect();
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

async function syncJob(jobName: JobName) {
  const states = await getRnsSyncStates(config.riseTestnetChainId);
  const currentState = states.find((state) => state.jobName === jobName);
  const head = await client.getBlockNumber();
  const startBlock = currentState
    ? currentState.lastProcessedBlock + 1n
    : await getInitialJobBlock(jobName);

  if (startBlock > head) return;

  let cursor = startBlock;
  while (cursor <= head) {
    const toBlock = cursor + BigInt(config.rnsSyncChunkSize) - 1n > head
      ? head
      : cursor + BigInt(config.rnsSyncChunkSize) - 1n;

    if (jobName === "registrar") await syncRegistrarRange(cursor, toBlock);
    if (jobName === "registry") await syncRegistryRange(cursor, toBlock);
    if (jobName === "resolver") await syncResolverRange(cursor, toBlock);

    await upsertRnsSyncState({
      jobName,
      chainId: config.riseTestnetChainId,
      contractAddress:
        jobName === "registrar"
          ? config.rnsContracts.registrar
          : jobName === "registry"
            ? config.rnsContracts.registry
            : config.rnsContracts.resolver,
      lastProcessedBlock: toBlock,
      lastProcessedBlockHash: await getBlockHash(toBlock),
    });

    cursor = toBlock + 1n;
  }
}

async function runSync(reason: string) {
  const startedAt = Date.now();
  try {
    for (const jobName of DEFAULT_JOB_ORDER) {
      await syncJob(jobName);
    }
  } finally {
    blockTimeCache.clear();
  }
  logger.info("RNS sync complete", {
    reason,
    chainId: config.riseTestnetChainId,
    durationMs: Date.now() - startedAt,
  });
}

async function runReconciliation(reason: string) {
  try {
    const names = await getRnsNamesForReconciliation(config.riseTestnetChainId);
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

export async function ensureRnsSync(reason = "manual") {
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

export async function ensureRnsIndexFresh(reason = "request") {
  const states = await getRnsSyncStates(config.riseTestnetChainId);
  const staleCutoff = Date.now() - config.rnsSyncIntervalSeconds * 2 * 1000;
  const hasAllJobs = DEFAULT_JOB_ORDER.every((jobName) => states.some((state) => state.jobName === jobName));
  const staleState = states.some((state) => {
    if (!state.lastProcessedAt) return true;
    return Date.parse(state.lastProcessedAt) < staleCutoff;
  });

  if (!hasAllJobs || staleState) {
    await ensureRnsSync(reason);
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

  await ensureRnsIndexFresh("names-read");
  const names = await getRnsOwnedNames({
    chainId,
    owner: getAddress(owner).toLowerCase(),
    nowUnix: BigInt(Math.floor(Date.now() / 1000)),
  });

  return names;
}

export async function getRnsIndexHealth() {
  const [states, nameCount] = await Promise.all([
    getRnsSyncStates(config.riseTestnetChainId),
    getRnsNameCount(config.riseTestnetChainId),
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

export function computeRnsNode(label: string) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  return namehash(`${normalized}.rise`);
}
