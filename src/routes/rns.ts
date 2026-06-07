import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { listOwnedRnsNames } from "../rns/service.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const paramsSchema = z.object({
  wallet: z.string().regex(ADDRESS_RE),
});

const querySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

export async function registerRnsRoutes(app: FastifyInstance) {
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
      names: names.map((name) => ({
        chainId: name.chainId,
        node: name.node,
        label: name.label,
        fqdn: name.fqdn,
        registrant: name.registrant,
        owner: name.owner,
        expiry: name.expiry.toString(),
        resolver: name.resolver,
        resolvedAddress: name.resolvedAddress,
        registeredTxHash: name.registeredTxHash,
        registeredAt: name.registeredAt.toString(),
        renewedAt: name.renewedAt?.toString() ?? null,
        releasedAt: name.releasedAt?.toString() ?? null,
        createdAtBlock: name.createdAtBlock.toString(),
      })),
    });
  });
}
