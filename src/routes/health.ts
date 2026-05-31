import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getHealthCounts } from "../db.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/api/chat/health", async () => {
    const counts = await getHealthCounts();
    return {
      ok: true,
      service: "senna-chat-api",
      docsBaseUrl: config.docsBaseUrl,
      hasDeepSeekKey: Boolean(config.deepseekApiKey),
      modelFast: config.deepseekModelFast,
      modelComplex: config.deepseekModelComplex,
      ...counts,
    };
  });
}
