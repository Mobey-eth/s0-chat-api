import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAddress } from "viem";
import { z } from "zod";
import { config } from "../config.js";
import { takeRateLimit } from "../db.js";
import { listRnsReservedNames } from "../rns/store.js";
import {
  getRnsIndexHealth,
  listRnsMarketplaceActivity,
  listRnsMarketplaceAuctions,
  listRnsMarketplaceListings,
  listRnsPrimaryAuctions,
  listOwnedRnsNames,
  normalizeRnsLabel,
  resolveRnsName,
  resolveRnsPrimaryName,
  serializeRnsNameRecord,
} from "../rns/service.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const chainQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

const listQuerySchema = chainQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const reservedListQuerySchema = chainQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const nameParamsSchema = z.object({
  fqdn: z.string().min(1).max(80),
});

const addressParamsSchema = z.object({
  address: z.string().regex(ADDRESS_RE),
});

async function publicRnsRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const rateWindow = await takeRateLimit({
    scope: "public-rns",
    subject: request.ip,
    windowSeconds: config.rnsPublicApiRateLimitWindowSeconds,
  });

  if (rateWindow.hits > config.rnsPublicApiRateLimitMaxRequests) {
    return reply.code(429).send({ error: "rate_limited" });
  }
}

function parseChainId(query: unknown) {
  const parsed = chainQuerySchema.safeParse(query);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        error: "invalid_query",
        detail: "Provide a valid chainId value.",
      },
    };
  }

  const chainId = parsed.data.chainId ?? config.riseChainId;
  if (chainId !== config.riseChainId) {
    return {
      ok: false as const,
      error: {
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseChainId} is indexed right now.`,
      },
    };
  }

  return { ok: true as const, chainId };
}

function parseListQuery(query: unknown) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        error: "invalid_query",
        detail: "Provide a valid chainId and limit value.",
      },
    };
  }

  const chain = parseChainId(query);
  if (!chain.ok) return chain;

  return {
    ok: true as const,
    chainId: chain.chainId,
    limit: parsed.data.limit ?? 50,
  };
}

function parseReservedListQuery(query: unknown) {
  const parsed = reservedListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        error: "invalid_query",
        detail: "Provide a valid chainId and limit value.",
      },
    };
  }

  const chain = parseChainId(query);
  if (!chain.ok) return chain;

  return {
    ok: true as const,
    chainId: chain.chainId,
    limit: parsed.data.limit ?? 200,
  };
}

function setPublicRnsCache(reply: FastifyReply) {
  reply.header("cache-control", "public, max-age=15, stale-while-revalidate=45");
}

export async function registerPublicRnsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/public/rns/")) return;
    await publicRnsRateLimit(request, reply);
  });

  app.get("/api/public/rns/status", async (_request, reply) => {
    setPublicRnsCache(reply);
    const status = await getRnsIndexHealth();
    return reply.send(status);
  });

  app.get("/api/public/rns/resolve/name/:fqdn", async (request, reply) => {
    const parsedParams = nameParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({
        error: "invalid_name",
        detail: "Provide a valid .rise name.",
      });
    }

    const label = normalizeRnsLabel(parsedParams.data.fqdn);
    if (!label) {
      return reply.code(400).send({
        error: "invalid_name",
        detail: "Names must use 1-32 lowercase letters, numbers, or hyphens.",
      });
    }

    const chain = parseChainId(request.query);
    if (!chain.ok) return reply.code(400).send(chain.error);

    const record = await resolveRnsName({ name: label, chainId: chain.chainId });
    setPublicRnsCache(reply);

    if (!record) {
      return reply.code(404).send({
        error: "name_not_found",
        chainId: chain.chainId,
        name: `${label}.rise`,
      });
    }

    return reply.send(serializeRnsNameRecord(record));
  });

  app.get("/api/public/rns/name/:fqdn", async (request, reply) => {
    const parsedParams = nameParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({
        error: "invalid_name",
        detail: "Provide a valid .rise name.",
      });
    }

    const label = normalizeRnsLabel(parsedParams.data.fqdn);
    if (!label) {
      return reply.code(400).send({
        error: "invalid_name",
        detail: "Names must use 1-32 lowercase letters, numbers, or hyphens.",
      });
    }

    const chain = parseChainId(request.query);
    if (!chain.ok) return reply.code(400).send(chain.error);

    const record = await resolveRnsName({ name: label, chainId: chain.chainId });
    setPublicRnsCache(reply);

    if (!record) {
      return reply.code(404).send({
        error: "name_not_found",
        chainId: chain.chainId,
        name: `${label}.rise`,
      });
    }

    return reply.send({
      ...serializeRnsNameRecord(record),
      records: {},
    });
  });

  app.get("/api/public/rns/resolve/address/:address", async (request, reply) => {
    const parsedParams = addressParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({
        error: "invalid_address",
        detail: "Provide a valid EVM address.",
      });
    }

    const chain = parseChainId(request.query);
    if (!chain.ok) return reply.code(400).send(chain.error);

    const address = getAddress(parsedParams.data.address).toLowerCase();
    const record = await resolveRnsPrimaryName({ address, chainId: chain.chainId });
    setPublicRnsCache(reply);

    return reply.send({
      chainId: chain.chainId,
      address,
      primaryName: record?.fqdn ?? null,
      node: record?.node ?? null,
      expiry: record?.expiry.toString() ?? null,
      isExpired: record ? serializeRnsNameRecord(record).isExpired : null,
      resolutionSource: record ? "owned-resolved-address" : null,
      lastIndexedBlock: record?.updatedBlock.toString() ?? null,
      lastIndexedAt: record?.updatedAt ?? null,
    });
  });

  app.get("/api/public/rns/names/:address", async (request, reply) => {
    const parsedParams = addressParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({
        error: "invalid_address",
        detail: "Provide a valid EVM address.",
      });
    }

    const chain = parseChainId(request.query);
    if (!chain.ok) return reply.code(400).send(chain.error);

    const owner = getAddress(parsedParams.data.address).toLowerCase();
    const names = await listOwnedRnsNames(owner, chain.chainId);
    setPublicRnsCache(reply);

    return reply.send({
      chainId: chain.chainId,
      owner,
      names: names.map(serializeRnsNameRecord),
    });
  });

  app.get("/api/public/rns/auctions", async (request, reply) => {
    const parsed = parseListQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(parsed.error);

    const auctions = await listRnsPrimaryAuctions(parsed.chainId, parsed.limit);
    setPublicRnsCache(reply);

    return reply.send({
      chainId: parsed.chainId,
      auctions,
    });
  });

  app.get("/api/public/rns/marketplace/listings", async (request, reply) => {
    const parsed = parseListQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(parsed.error);

    const listings = await listRnsMarketplaceListings(parsed.chainId, parsed.limit);
    setPublicRnsCache(reply);

    return reply.send({
      chainId: parsed.chainId,
      listings,
    });
  });

  app.get("/api/public/rns/marketplace/auctions", async (request, reply) => {
    const parsed = parseListQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(parsed.error);

    const auctions = await listRnsMarketplaceAuctions(parsed.chainId, parsed.limit);
    setPublicRnsCache(reply);

    return reply.send({
      chainId: parsed.chainId,
      auctions,
    });
  });

  app.get("/api/public/rns/marketplace/activity", async (request, reply) => {
    const parsed = parseListQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(parsed.error);

    const activity = await listRnsMarketplaceActivity(parsed.chainId, parsed.limit);
    setPublicRnsCache(reply);

    return reply.send({
      chainId: parsed.chainId,
      activity,
    });
  });

  app.get("/api/public/rns/marketplace/reserved", async (request, reply) => {
    const parsed = parseReservedListQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(parsed.error);

    const names = (await listRnsReservedNames({
      chainId: parsed.chainId,
      enabledOnly: true,
    })).filter((name) => name.activatedAt !== null);
    setPublicRnsCache(reply);

    return reply.send({
      chainId: parsed.chainId,
      names: names.map((name) => ({
        id: name.id,
        chainId: name.chainId,
        label: name.label,
        fqdn: name.fqdn,
        category: name.category,
        enabled: name.enabled,
        saleMode: name.saleMode,
        reservePriceWei: name.reservePrice?.toString() ?? null,
        fixedPriceWei: name.fixedPrice?.toString() ?? null,
        auctionDurationSeconds: name.auctionDurationSeconds.toString(),
        notes: name.notes,
        displayOrder: name.displayOrder,
        primaryAuctionId: name.primaryAuctionId?.toString() ?? null,
        activationTxHash: name.activationTxHash,
        activatedAt: name.activatedAt,
        createdAt: name.createdAt,
        updatedAt: name.updatedAt,
      })),
    });
  });
}
