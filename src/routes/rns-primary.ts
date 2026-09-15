import type { FastifyInstance } from "fastify";
import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { z } from "zod";
import { config } from "../config.js";
import { takeRateLimit } from "../db.js";
import { PrimaryNameError, primaryAuthorizationMessage, verifyPrimaryAuthorization, getPrimaryVersion, checkPrimaryEligibility, savePrimaryPreference } from "../rns/primary-name.js";

const choiceSchema = z.object({
  chainId: z.coerce.number().int().refine((value) => value === config.riseChainId),
  address: z.string().refine((value) => isAddress(value, { strict: true }) && value.toLowerCase() !== zeroAddress),
  name: z.string().trim().toLowerCase().transform((value) => value.replace(/\.rise$/, "")).pipe(z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/)),
});
const updateSchema = choiceSchema.extend({
  version: z.string().regex(/^(0|[1-9][0-9]{0,17})$/),
  timestamp: z.number().int().positive(),
  signature: z.string().regex(/^0x(?:[a-fA-F0-9]{2})+$/).max(16_386),
});

export const primaryDependencies = {
  version: getPrimaryVersion, eligible: checkPrimaryEligibility,
  verify: verifyPrimaryAuthorization, save: savePrimaryPreference,
  limit: async (subject: string) => (await takeRateLimit({ scope: "rns-primary", subject, windowSeconds: 60 })).hits <= 10,
};

export async function registerRnsPrimaryRoutes(app: FastifyInstance, deps = primaryDependencies) {
  // This mutation group is registered only in Senna, never in the GET-only v1 service.
  app.get("/api/rns/primary/authorization", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const parsed = choiceSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_primary_choice", detail: "Provide a valid wallet, .rise name and mainnet chain ID." });
    const allowed = await deps.limit(`rns-primary:${request.ip}`);
    if (!allowed) return reply.code(429).send({ error: "rate_limited", detail: "Please wait a minute before trying again." });
    try {
      await deps.eligible(parsed.data.address, parsed.data.name);
    } catch (error) {
      return reply.code(error instanceof PrimaryNameError ? 409 : 503).send({ error: "primary_unavailable", detail: error instanceof PrimaryNameError ? error.message : "Unable to verify this name. Please try again shortly." });
    }
    const input = { ...parsed.data, address: getAddress(parsed.data.address), version: await deps.version(parsed.data.chainId, parsed.data.address), timestamp: Date.now() };
    return reply.send({ ...input, message: primaryAuthorizationMessage(input) });
  });

  app.post("/api/rns/primary", { bodyLimit: 20_000 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_primary_choice", detail: "Invalid primary name authorization." });
    const input = { ...parsed.data, signature: parsed.data.signature as Hex };
    const allowed = await deps.limit(`rns-primary:${request.ip}`);
    if (!allowed) return reply.code(429).send({ error: "rate_limited", detail: "Please wait a minute before trying again." });
    let authorized = false;
    try { authorized = await deps.verify(input); } catch { /* fail closed */ }
    if (!authorized) return reply.code(401).send({ error: "invalid_signature", detail: "Sign a fresh primary-name authorization with the owning wallet." });
    try {
      const record = await deps.eligible(input.address, input.name);
      const version = await deps.save({ ...input, ...record });
      if (!version) return reply.code(409).send({ error: "primary_changed", detail: "The name or your primary choice changed, or this signature was already used. Please try again." });
      return reply.send({ chainId: input.chainId, address: getAddress(input.address), primaryName: `${input.name}.rise`, node: record.node, version });
    } catch (error) {
      return reply.code(error instanceof PrimaryNameError ? 409 : 503).send({ error: "primary_unavailable", detail: error instanceof PrimaryNameError ? error.message : "Unable to update your primary name. Please try again shortly." });
    }
  });
}
