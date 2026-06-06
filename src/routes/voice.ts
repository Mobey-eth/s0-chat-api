import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { logChatError, takeRateLimit } from "../db.js";
import { logger } from "../logger.js";

const ASSEMBLY_TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

function buildRequesterKey(input: { ip: string; userAgent: string }) {
  return createHash("sha256").update(`${input.ip}|${input.userAgent}`).digest("hex");
}

export async function registerVoiceRoutes(app: FastifyInstance) {
  app.post("/api/voice/token", async (request, reply) => {
    if (!config.assemblyAiApiKey) {
      await logChatError({
        scope: "voice_token",
        code: "missing_key",
        internalMessage: "ASSEMBLYAI_API_KEY not configured",
      });
      return reply.code(503).send({ error: "voice_unavailable" });
    }

    const subject = buildRequesterKey({
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? "unknown",
    });

    const rateWindow = await takeRateLimit({
      scope: "voice_token",
      subject,
      windowSeconds: 60,
      // tighter cap than chat: minting many tokens is suspect
    });

    if (rateWindow.hits > 6) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const url = `${ASSEMBLY_TOKEN_URL}?expires_in_seconds=60`;

    try {
      const upstream = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: config.assemblyAiApiKey,
        },
      });

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        await logChatError({
          scope: "voice_token",
          code: "upstream_error",
          internalMessage: text.slice(0, 500),
          httpStatus: upstream.status,
        });
        logger.error("AssemblyAI token mint failed", { httpStatus: upstream.status });
        return reply.code(503).send({ error: "voice_unavailable" });
      }

      const json = (await upstream.json()) as { token?: string };
      if (!json.token) {
        await logChatError({
          scope: "voice_token",
          code: "no_token_in_response",
        });
        return reply.code(503).send({ error: "voice_unavailable" });
      }

      return reply.code(200).send({
        token: json.token,
        expiresInSeconds: 60,
      });
    } catch (error) {
      await logChatError({
        scope: "voice_token",
        code: "network_error",
        internalMessage: error instanceof Error ? error.message : String(error),
      });
      logger.error("Voice token network error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.code(503).send({ error: "voice_unavailable" });
    }
  });
}
