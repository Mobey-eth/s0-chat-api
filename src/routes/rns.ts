import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { buildRnsPriceQuote, getRnsPricingSummary } from "../rns/pricing.js";
import {
  listRnsReservedNames,
  type RnsReservedSaleMode,
  upsertRnsNotificationSubscription,
  upsertRnsReservedName,
} from "../rns/store.js";
import {
  computeRnsNode,
  listOwnedRnsNames,
  normalizeRnsLabel,
  serializeRnsNameRecord,
} from "../rns/service.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const NODE_RE = /^0x[a-fA-F0-9]{64}$/;

const paramsSchema = z.object({
  wallet: z.string().regex(ADDRESS_RE),
});

const querySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

const pricingQuerySchema = querySchema.extend({
  name: z.string().min(1).max(80).optional(),
  durationYears: z.coerce.number().int().positive().max(10).optional(),
  durationSeconds: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
});

const quoteBodySchema = z.object({
  action: z.enum(["register", "renew"]),
  name: z.string().min(1).max(80),
  beneficiary: z.string().regex(ADDRESS_RE),
  chainId: z.coerce.number().int().positive().optional(),
  durationYears: z.coerce.number().int().positive().max(10).optional(),
  durationSeconds: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
});

const notificationBodySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  scope: z.enum(["marketplace_seller", "marketplace_bidder", "marketplace_watcher"]),
  email: z.string().email(),
  wallet: z.string().regex(ADDRESS_RE).optional(),
  name: z.string().min(1).max(80).optional(),
  node: z.string().regex(NODE_RE).optional(),
  auctionId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
  listingId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
});

const reservedQuerySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

const reservedBodySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  label: z.string().min(1).max(80),
  category: z.string().min(1).max(120).optional(),
  enabled: z.coerce.boolean().optional(),
  saleMode: z.enum(["auction", "buy_now"]).optional(),
  reservePriceWei: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative(), z.null()])
    .optional(),
  fixedPriceWei: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative(), z.null()])
    .optional(),
  notes: z.string().max(500).nullable().optional(),
  displayOrder: z.coerce.number().int().min(0).max(100_000).optional(),
});

function serializeReservedNameRecord(record: {
  id: number;
  chainId: number;
  label: string;
  fqdn: string;
  category: string;
  enabled: boolean;
  saleMode: RnsReservedSaleMode;
  reservePrice: bigint | null;
  fixedPrice: bigint | null;
  notes: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: record.id,
    chainId: record.chainId,
    label: record.label,
    fqdn: record.fqdn,
    category: record.category,
    enabled: record.enabled,
    saleMode: record.saleMode,
    reservePriceWei: record.reservePrice?.toString() ?? null,
    fixedPriceWei: record.fixedPrice?.toString() ?? null,
    notes: record.notes,
    displayOrder: record.displayOrder,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const YEAR_SECONDS = 365n * 24n * 60n * 60n;

function parseQuoteDuration(input: z.infer<typeof quoteBodySchema>) {
  if (input.durationSeconds !== undefined) {
    return BigInt(input.durationSeconds);
  }

  return BigInt(input.durationYears ?? 1) * YEAR_SECONDS;
}

export async function registerRnsRoutes(app: FastifyInstance) {
  app.get("/api/rns/pricing", async (request, reply) => {
    const parsedQuery = pricingQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "invalid_pricing_request",
        detail: "Provide a valid chainId, name, and duration.",
      });
    }

    const chainId = parsedQuery.data.chainId ?? config.riseTestnetChainId;
    if (chainId !== config.riseTestnetChainId) {
      return reply.code(400).send({
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseTestnetChainId} is supported right now.`,
      });
    }

    const durationSeconds =
      parsedQuery.data.durationSeconds !== undefined
        ? BigInt(parsedQuery.data.durationSeconds)
        : BigInt(parsedQuery.data.durationYears ?? 1) * YEAR_SECONDS;

    try {
      return reply.send(await getRnsPricingSummary({
        name: parsedQuery.data.name,
        durationSeconds,
      }));
    } catch (error) {
      return reply.code(400).send({
        error: "pricing_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/rns/quote", async (request, reply) => {
    const parsedBody = quoteBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_quote_request",
        detail: "Provide action, name, beneficiary, and duration.",
      });
    }

    const chainId = parsedBody.data.chainId ?? config.riseTestnetChainId;
    if (chainId !== config.riseTestnetChainId) {
      return reply.code(400).send({
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseTestnetChainId} is supported right now.`,
      });
    }

    try {
      const quote = await buildRnsPriceQuote({
        action: parsedBody.data.action,
        name: parsedBody.data.name,
        beneficiary: parsedBody.data.beneficiary,
        durationSeconds: parseQuoteDuration(parsedBody.data),
      });
      return reply.send(quote);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("RNS_PRICE_SIGNER_PRIVATE_KEY")) {
        return reply.code(503).send({
          error: "quote_signer_unavailable",
          detail: "RNS quote signing is not configured on this server.",
        });
      }

      return reply.code(400).send({
        error: "quote_failed",
        detail: message,
      });
    }
  });

  app.get("/api/rns/names/:wallet", async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({
        error: "invalid_wallet",
        detail: "Provide a valid wallet address.",
      });
    }

    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "invalid_query",
        detail: "Provide a valid chainId value.",
      });
    }

    const chainId = parsedQuery.data.chainId ?? config.riseTestnetChainId;
    if (chainId !== config.riseTestnetChainId) {
      return reply.code(400).send({
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseTestnetChainId} is indexed right now.`,
      });
    }

    const names = await listOwnedRnsNames(parsedParams.data.wallet, chainId);
    return reply.send({
      chainId,
      owner: parsedParams.data.wallet.toLowerCase(),
      names: names.map(serializeRnsNameRecord),
    });
  });

  app.post("/api/rns/notifications/subscribe", async (request, reply) => {
    const parsedBody = notificationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_subscription_request",
        detail: "Provide a valid email, scope, and marketplace target.",
      });
    }

    const chainId = parsedBody.data.chainId ?? config.riseTestnetChainId;
    if (chainId !== config.riseTestnetChainId) {
      return reply.code(400).send({
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseTestnetChainId} is supported right now.`,
      });
    }

    const normalizedName = parsedBody.data.name ? normalizeRnsLabel(parsedBody.data.name) : null;
    const node = (parsedBody.data.node ?? (normalizedName ? computeRnsNode(normalizedName) : null)) as
      | `0x${string}`
      | null;
    const auctionId = parsedBody.data.auctionId !== undefined ? BigInt(parsedBody.data.auctionId) : 0n;
    const listingId = parsedBody.data.listingId !== undefined ? BigInt(parsedBody.data.listingId) : 0n;

    if (parsedBody.data.scope === "marketplace_seller" && !node) {
      return reply.code(400).send({
        error: "invalid_subscription_request",
        detail: "Seller subscriptions need a valid .rise name or node.",
      });
    }

    if (parsedBody.data.scope === "marketplace_bidder" && auctionId <= 0n) {
      return reply.code(400).send({
        error: "invalid_subscription_request",
        detail: "Bidder subscriptions need a valid auctionId.",
      });
    }

    if (
      parsedBody.data.scope === "marketplace_watcher" &&
      !node &&
      auctionId <= 0n &&
      listingId <= 0n
    ) {
      return reply.code(400).send({
        error: "invalid_subscription_request",
        detail: "Watcher subscriptions need a valid .rise name, node, or auctionId.",
      });
    }

    const subscription = await upsertRnsNotificationSubscription({
      chainId,
      scope: parsedBody.data.scope,
      email: parsedBody.data.email,
      wallet: parsedBody.data.wallet?.toLowerCase() as `0x${string}` | undefined,
      name: normalizedName,
      node,
      auctionId,
      listingId,
    });

    return reply.send({
      ok: true,
      subscription: {
        id: subscription.id,
        chainId: subscription.chainId,
        scope: subscription.scope,
        email: subscription.email,
        wallet: subscription.wallet,
        name: subscription.name,
        node: subscription.node,
        auctionId: subscription.auctionId > 0n ? subscription.auctionId.toString() : null,
        listingId: subscription.listingId > 0n ? subscription.listingId.toString() : null,
      },
    });
  });

  app.get("/api/rns/admin/reserved", async (request, reply) => {
    const parsedQuery = reservedQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "invalid_reserved_request",
        detail: "Provide a valid chainId value.",
      });
    }

    const chainId = parsedQuery.data.chainId ?? config.riseTestnetChainId;
    if (chainId !== config.riseTestnetChainId) {
      return reply.code(400).send({
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseTestnetChainId} is supported right now.`,
      });
    }

    const names = await listRnsReservedNames({ chainId, enabledOnly: false });
    return reply.send({
      chainId,
      names: names.map(serializeReservedNameRecord),
    });
  });

  app.post("/api/rns/admin/reserved", async (request, reply) => {
    const parsedBody = reservedBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_reserved_request",
        detail: "Provide a valid label, mode, and price payload.",
      });
    }

    const chainId = parsedBody.data.chainId ?? config.riseTestnetChainId;
    if (chainId !== config.riseTestnetChainId) {
      return reply.code(400).send({
        error: "unsupported_chain",
        detail: `Only chainId ${config.riseTestnetChainId} is supported right now.`,
      });
    }

    const label = normalizeRnsLabel(parsedBody.data.label);
    if (!label) {
      return reply.code(400).send({
        error: "invalid_reserved_request",
        detail: "Labels must use 1-32 lowercase letters, numbers, or hyphens.",
      });
    }

    const saleMode = parsedBody.data.saleMode ?? "auction";
    const reservePrice =
      parsedBody.data.reservePriceWei === null || parsedBody.data.reservePriceWei === undefined
        ? null
        : BigInt(parsedBody.data.reservePriceWei);
    const fixedPrice =
      parsedBody.data.fixedPriceWei === null || parsedBody.data.fixedPriceWei === undefined
        ? null
        : BigInt(parsedBody.data.fixedPriceWei);

    const record = await upsertRnsReservedName({
      chainId,
      label,
      category: parsedBody.data.category,
      enabled: parsedBody.data.enabled,
      saleMode,
      reservePrice,
      fixedPrice,
      notes: parsedBody.data.notes,
      displayOrder: parsedBody.data.displayOrder,
    });

    return reply.send({
      ok: true,
      name: serializeReservedNameRecord(record),
    });
  });
}
