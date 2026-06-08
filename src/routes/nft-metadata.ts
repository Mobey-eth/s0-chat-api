import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateNFTMetadataUris } from "../utils/nft-metadata-validation.js";

const bodySchema = z.object({
  baseURI: z.string().min(1),
  contractURI: z.string().min(1),
});

export async function registerNftMetadataRoutes(app: FastifyInstance) {
  app.post("/api/nft/validate-metadata", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_metadata_validation_request",
        detail: "Provide non-empty baseURI and contractURI values.",
      });
    }

    const result = await validateNFTMetadataUris(parsed.data);
    if (!result.ok) {
      return reply.code(422).send({
        error: "invalid_nft_metadata",
        detail: result.message,
        normalizedBaseURI: result.normalizedBaseURI,
        normalizedContractURI: result.normalizedContractURI,
      });
    }

    return reply.send(result);
  });
}

