import { getAddress } from "viem";
import { config } from "../config.js";
import { pool } from "../db.js";
import {
  getRnsMarketplaceAuctions,
  getRnsMarketplaceEvents,
  getRnsMarketplaceListings,
  getRnsMarketplaceNamesBySeller,
  getRnsNameByLabel,
  getRnsNameCount,
  getRnsOwnedNames,
  getRnsPrimaryAuctions,
  getRnsPrimaryNameForAddress,
  getRnsSyncStates,
} from "./store.js";
import {
  normalizeRnsLabel,
  serializeMarketplaceAuctionRecord,
  serializeMarketplaceEventRecord,
  serializeMarketplaceListingRecord,
  serializePrimaryAuctionRecord,
  serializeRnsNameRecord,
} from "./service.js";

const JOB_CONTRACTS = {
  registrar: config.rnsContracts.registrar,
  registry: config.rnsContracts.registry,
  resolver: config.rnsContracts.resolver,
  primary_auction: config.rnsContracts.auctionHouse,
  marketplace: config.rnsContracts.marketplace,
} as const;

export async function readPublicRnsHealth() {
  const [states, namesIndexed, mirrorStatus] = await Promise.all([
    getRnsSyncStates(config.riseChainId),
    getRnsNameCount(config.riseChainId, config.rnsStartBlocks.registrar),
    pool.query<{
      last_synced_at: string;
      source_counts: Record<string, number>;
      sync_duration_ms: number;
    }>(
      `select last_synced_at, source_counts, sync_duration_ms
       from stage0_rns.mirror_status where chain_id = $1`,
      [config.riseChainId],
    ),
  ]);
  const jobs = states
    .filter((state) => {
      const expected = JOB_CONTRACTS[state.jobName];
      return expected && state.contractAddress.toLowerCase() === expected.toLowerCase();
    })
    .map((state) => ({
      jobName: state.jobName,
      contractAddress: state.contractAddress,
      lastProcessedBlock: state.lastProcessedBlock.toString(),
      lastProcessedAt: state.lastProcessedAt,
    }));
  const lastIndexedBlock = jobs.reduce(
    (minimum, job) => minimum === null || BigInt(job.lastProcessedBlock) < minimum
      ? BigInt(job.lastProcessedBlock)
      : minimum,
    null as bigint | null,
  );
  const indexAgeSeconds = jobs.reduce((maximum, job) => {
    if (!job.lastProcessedAt) return Number.POSITIVE_INFINITY;
    const age = Math.max(0, Math.floor((Date.now() - Date.parse(job.lastProcessedAt)) / 1_000));
    return Math.max(maximum, age);
  }, 0);
  const maximumIndexAgeSeconds = Math.max(600, config.rnsSyncIntervalSeconds * 3);

  const mirror = mirrorStatus.rows[0] ?? null;
  const mirrorAgeSeconds = mirror
    ? Math.max(0, Math.floor((Date.now() - Date.parse(mirror.last_synced_at)) / 1_000))
    : null;

  return {
    status:
      jobs.length === Object.keys(JOB_CONTRACTS).length &&
      mirrorAgeSeconds !== null &&
      mirrorAgeSeconds <= 120 &&
      indexAgeSeconds <= maximumIndexAgeSeconds
        ? "ok"
        : "degraded",
    service: "stage0-rns-api",
    version: "v1",
    network: config.riseNetworkName,
    chainId: config.riseChainId,
    namesIndexed,
    lastIndexedBlock: lastIndexedBlock?.toString() ?? null,
    index: {
      ageSeconds: Number.isFinite(indexAgeSeconds) ? indexAgeSeconds : null,
      maximumAgeSeconds: maximumIndexAgeSeconds,
    },
    mirror: {
      lastSyncedAt: mirror?.last_synced_at ?? null,
      ageSeconds: mirrorAgeSeconds,
      syncDurationMs: mirror?.sync_duration_ms ?? null,
      sourceCounts: mirror?.source_counts ?? {},
    },
    jobs,
  };
}

export async function readPublicRnsName(name: string) {
  const label = normalizeRnsLabel(name);
  if (!label) return null;
  const record = await getRnsNameByLabel({
    chainId: config.riseChainId,
    label,
    minRegisteredBlock: config.rnsStartBlocks.registrar,
  });
  return record ? serializeRnsNameRecord(record) : null;
}

export async function readPublicRnsPrimaryName(address: string) {
  const normalizedAddress = getAddress(address).toLowerCase();
  const record = await getRnsPrimaryNameForAddress({
    chainId: config.riseChainId,
    address: normalizedAddress,
    nowUnix: BigInt(Math.floor(Date.now() / 1_000)),
    minRegisteredBlock: config.rnsStartBlocks.registrar,
  });

  return {
    chainId: config.riseChainId,
    address: normalizedAddress,
    primaryName: record?.fqdn ?? null,
    node: record?.node ?? null,
    resolvedAddress: record?.resolvedAddress ?? null,
    expiry: record?.expiry.toString() ?? null,
    isExpired: record ? record.expiry <= BigInt(Math.floor(Date.now() / 1_000)) : null,
    lastIndexedBlock: record?.updatedBlock.toString() ?? null,
    lastIndexedAt: record?.updatedAt ?? null,
  };
}

export async function readPublicRnsNamesForAddress(address: string) {
  const owner = getAddress(address).toLowerCase();
  const nowUnix = BigInt(Math.floor(Date.now() / 1_000));
  const [ownedNames, marketplaceNames] = await Promise.all([
    getRnsOwnedNames({
      chainId: config.riseChainId,
      owner,
      nowUnix,
      minRegisteredBlock: config.rnsStartBlocks.registrar,
    }),
    getRnsMarketplaceNamesBySeller({
      chainId: config.riseChainId,
      seller: owner,
      nowUnix,
      escrowOwner: config.rnsContracts.marketplace,
      minRegisteredBlock: config.rnsStartBlocks.registrar,
    }),
  ]);
  const ownedNodes = new Set(ownedNames.map((name) => name.node.toLowerCase()));
  const names = [
    ...ownedNames,
    ...marketplaceNames.filter((name) => !ownedNodes.has(name.node.toLowerCase())),
  ];

  return {
    chainId: config.riseChainId,
    owner,
    count: names.length,
    names: names.map(serializeRnsNameRecord),
  };
}

export async function readPublicPrimaryAuctions(limit: number) {
  const records = await getRnsPrimaryAuctions({ chainId: config.riseChainId, limit });
  return records.map(serializePrimaryAuctionRecord);
}

export async function readPublicMarketplaceListings(limit: number) {
  const records = await getRnsMarketplaceListings({ chainId: config.riseChainId, limit });
  return records.map(serializeMarketplaceListingRecord);
}

export async function readPublicMarketplaceAuctions(limit: number) {
  const records = await getRnsMarketplaceAuctions({ chainId: config.riseChainId, limit });
  return records.map(serializeMarketplaceAuctionRecord);
}

export async function readPublicMarketplaceActivity(limit: number) {
  const records = await getRnsMarketplaceEvents({ chainId: config.riseChainId, limit });
  return records.map(serializeMarketplaceEventRecord);
}
