import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { PublicRateLimiter } from "../public-api/rate-limit.js";
import { getRnsPricingSummary } from "../rns/pricing.js";
import { readRnsNameOnchain } from "../rns/onchain-read.js";
import {
  readPublicMarketplaceActivity,
  readPublicMarketplaceAuctions,
  readPublicMarketplaceListings,
  readPublicPrimaryAuctions,
  readPublicRnsHealth,
  readPublicRnsName,
  readPublicRnsNamesForAddress,
  readPublicRnsPrimaryName,
} from "../rns/public-read.js";
import { normalizeRnsLabel } from "../rns/service.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const YEAR_SECONDS = 365n * 24n * 60n * 60n;

const nameParamsSchema = z.object({
  name: z.string().min(1).max(80),
});

const addressParamsSchema = z.object({
  address: z.string().regex(ADDRESS_RE),
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const pricingQuerySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  years: z.coerce.number().int().min(1).max(10).optional(),
});

export interface PublicRnsV1Dependencies {
  health: typeof readPublicRnsHealth;
  onchainName: typeof readRnsNameOnchain;
  indexedName: typeof readPublicRnsName;
  reverse: typeof readPublicRnsPrimaryName;
  namesForAddress: typeof readPublicRnsNamesForAddress;
  pricing: typeof getRnsPricingSummary;
  primaryAuctions: typeof readPublicPrimaryAuctions;
  marketplaceListings: typeof readPublicMarketplaceListings;
  marketplaceAuctions: typeof readPublicMarketplaceAuctions;
  marketplaceActivity: typeof readPublicMarketplaceActivity;
}

const defaultDependencies: PublicRnsV1Dependencies = {
  health: readPublicRnsHealth,
  onchainName: readRnsNameOnchain,
  indexedName: readPublicRnsName,
  reverse: readPublicRnsPrimaryName,
  namesForAddress: readPublicRnsNamesForAddress,
  pricing: getRnsPricingSummary,
  primaryAuctions: readPublicPrimaryAuctions,
  marketplaceListings: readPublicMarketplaceListings,
  marketplaceAuctions: readPublicMarketplaceAuctions,
  marketplaceActivity: readPublicMarketplaceActivity,
};

function setCache(reply: FastifyReply, maxAge = 15, staleWhileRevalidate = 45) {
  reply.header(
    "cache-control",
    `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  );
}

function invalidName(reply: FastifyReply) {
  return reply.code(400).send({
    error: "invalid_name",
    detail: "Use a 1-32 character .rise name containing lowercase letters, numbers, or hyphens.",
  });
}

function parseLimit(request: FastifyRequest, reply: FastifyReply) {
  const parsed = limitQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    void reply.code(400).send({
      error: "invalid_query",
      detail: "limit must be an integer between 1 and 100.",
    });
    return null;
  }
  return parsed.data.limit ?? 50;
}

function listResponse(items: unknown[]) {
  return {
    chainId: config.riseChainId,
    count: items.length,
    items,
  };
}

export async function registerPublicRnsV1Routes(
  app: FastifyInstance,
  dependencies: PublicRnsV1Dependencies = defaultDependencies,
) {
  const limiter = new PublicRateLimiter(
    config.rnsPublicApiRateLimitMaxRequests,
    config.rnsPublicApiRateLimitWindowSeconds,
  );

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;

    if (request.method !== "GET" && request.method !== "OPTIONS") {
      reply.header("allow", "GET, OPTIONS");
      return reply.code(405).send({
        error: "method_not_allowed",
        detail: "The Stage0 RNS v1 API is read-only.",
      });
    }

    if (request.method === "OPTIONS") return;
    const result = limiter.take(request.ip);
    reply.header("x-ratelimit-limit", String(result.limit));
    reply.header("x-ratelimit-remaining", String(result.remaining));
    reply.header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1_000)));

    if (!result.allowed) {
      reply.header("retry-after", String(result.retryAfterSeconds));
      return reply.code(429).send({
        error: "rate_limited",
        detail: "Too many requests. Retry after the current rate-limit window.",
      });
    }
  });

  app.get("/v1/health", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return reply.send(await dependencies.health());
  });

  app.get("/v1/network", async (_request, reply) => {
    setCache(reply, 86_400, 86_400);
    return reply.send({
      version: "v1",
      network: config.riseNetworkName,
      chainId: config.riseChainId,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrl: config.riseRpcUrl,
      explorerUrl: config.riseExplorerUrl,
      contracts: config.rnsContracts,
      deploymentBlocks: Object.fromEntries(
        Object.entries(config.rnsStartBlocks).map(([key, value]) => [key, value.toString()]),
      ),
    });
  });

  app.get("/v1/resolve/:name", async (request, reply) => {
    const parsed = nameParamsSchema.safeParse(request.params);
    if (!parsed.success || !normalizeRnsLabel(parsed.data.name)) return invalidName(reply);

    const record = await dependencies.onchainName(parsed.data.name);
    setCache(reply);
    if (!record?.registered) {
      return reply.code(404).send({
        error: "name_not_found",
        chainId: config.riseChainId,
        name: `${normalizeRnsLabel(parsed.data.name)}.rise`,
      });
    }

    return reply.send({
      chainId: record.chainId,
      name: record.name,
      node: record.node,
      address: record.resolvedAddress,
      owner: record.owner,
      resolver: record.resolver,
      expiry: record.expiry,
      blockNumber: record.blockNumber,
      source: record.source,
    });
  });

  app.get("/v1/reverse/:address", async (request, reply) => {
    const parsed = addressParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_address",
        detail: "Provide a valid EVM address.",
      });
    }
    setCache(reply);
    return reply.send(await dependencies.reverse(parsed.data.address));
  });

  app.get("/v1/names/:name", async (request, reply) => {
    const parsed = nameParamsSchema.safeParse(request.params);
    if (!parsed.success || !normalizeRnsLabel(parsed.data.name)) return invalidName(reply);

    const [onchain, indexed] = await Promise.all([
      dependencies.onchainName(parsed.data.name),
      dependencies.indexedName(parsed.data.name),
    ]);
    setCache(reply);
    if (!onchain?.registered) {
      return reply.code(404).send({
        error: "name_not_found",
        chainId: config.riseChainId,
        name: `${normalizeRnsLabel(parsed.data.name)}.rise`,
      });
    }
    return reply.send({ ...onchain, indexed });
  });

  app.get("/v1/addresses/:address/names", async (request, reply) => {
    const parsed = addressParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_address",
        detail: "Provide a valid EVM address.",
      });
    }
    setCache(reply);
    return reply.send(await dependencies.namesForAddress(parsed.data.address));
  });

  app.get("/v1/availability/:name", async (request, reply) => {
    const parsed = nameParamsSchema.safeParse(request.params);
    if (!parsed.success || !normalizeRnsLabel(parsed.data.name)) return invalidName(reply);
    const record = await dependencies.onchainName(parsed.data.name);
    setCache(reply);
    return reply.send(record);
  });

  app.get("/v1/pricing", async (request, reply) => {
    const parsed = pricingQuerySchema.safeParse(request.query);
    if (!parsed.success || (parsed.data.name && !normalizeRnsLabel(parsed.data.name))) {
      return reply.code(400).send({
        error: "invalid_pricing_request",
        detail: "Provide a valid .rise name and a years value between 1 and 10.",
      });
    }
    const years = BigInt(parsed.data.years ?? 1);
    setCache(reply, 60, 120);
    return reply.send(await dependencies.pricing({
      name: parsed.data.name,
      durationSeconds: years * YEAR_SECONDS,
    }));
  });

  app.get("/v1/auctions", async (request, reply) => {
    const limit = parseLimit(request, reply);
    if (limit === null) return;
    const items = await dependencies.primaryAuctions(limit);
    setCache(reply);
    return reply.send(listResponse(items));
  });

  app.get("/v1/marketplace/listings", async (request, reply) => {
    const limit = parseLimit(request, reply);
    if (limit === null) return;
    const items = await dependencies.marketplaceListings(limit);
    setCache(reply);
    return reply.send(listResponse(items));
  });

  app.get("/v1/marketplace/auctions", async (request, reply) => {
    const limit = parseLimit(request, reply);
    if (limit === null) return;
    const items = await dependencies.marketplaceAuctions(limit);
    setCache(reply);
    return reply.send(listResponse(items));
  });

  app.get("/v1/marketplace/activity", async (request, reply) => {
    const limit = parseLimit(request, reply);
    if (limit === null) return;
    const items = await dependencies.marketplaceActivity(limit);
    setCache(reply);
    return reply.send(listResponse(items));
  });
}
