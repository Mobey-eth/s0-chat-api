import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import { logger } from "./logger.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerNftMetadataRoutes } from "./routes/nft-metadata.js";
import { registerPublicRnsRoutes } from "./routes/public-rns.js";
import { registerRnsRoutes } from "./routes/rns.js";
import { registerVoiceRoutes } from "./routes/voice.js";
import { startRnsJobs } from "./rns/service.js";

const app = Fastify({
  logger: false,
  trustProxy: true,
});

await app.register(cors, {
  origin: config.corsOrigin === "*" ? true : config.corsOrigin,
});
await app.register(multipart, {
  limits: {
    fileSize: config.uploadMaxBytes,
    files: 1,
  },
});

await registerHealthRoutes(app);
await registerImageRoutes(app);
await registerNftMetadataRoutes(app);
await registerPublicRnsRoutes(app);
await registerRnsRoutes(app);
await registerChatRoutes(app);
await registerVoiceRoutes(app);
startRnsJobs();

app.setErrorHandler((error, _request, reply) => {
  logger.error("Unhandled chat API error", {
    error: error instanceof Error ? error.message : String(error),
  });
  void reply.code(500).send({
    error: "internal_error",
  });
});

const shutdown = async (signal: string) => {
  logger.info("Shutting down chat API", { signal });
  await app.close().catch(() => undefined);
  await closeDb().catch(() => undefined);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT").then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").then(() => process.exit(0));
});

await app.listen({
  host: "0.0.0.0",
  port: config.port,
});

logger.info("Senna chat API listening", {
  port: config.port,
  corsOrigin: config.corsOrigin,
});
