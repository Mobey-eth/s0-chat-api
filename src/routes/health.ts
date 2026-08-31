import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getHealthCounts } from "../db.js";
import { getRnsIndexHealth } from "../rns/service.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/api/chat/health", async () => {
    const counts = await getHealthCounts();
    const rns = await getRnsIndexHealth().catch(() => null);
    return {
      ok: true,
      service: "senna-chat-api",
      network: {
        name: config.riseNetworkName,
        chainId: config.riseChainId,
        rpcOrigin: config.riseRpcOrigin,
        explorerUrl: config.riseExplorerUrl,
      },
      rnsContracts: config.rnsContracts,
      rnsStartBlocks: Object.fromEntries(
        Object.entries(config.rnsStartBlocks).map(([name, block]) => [name, block.toString()]),
      ),
      integrations: {
        quoteSignerConfigured: Boolean(config.rnsPriceSignerPrivateKey),
        emailConfigured: Boolean(config.resendApiKey),
        slackConfigured: Boolean(config.rnsAdminActivitySlackWebhookUrl),
      },
      docsBaseUrl: config.docsBaseUrl,
      hasDeepSeekKey: Boolean(config.deepseekApiKey),
      modelFast: config.deepseekModelFast,
      modelComplex: config.deepseekModelComplex,
      rns,
      ...counts,
    };
  });
}
