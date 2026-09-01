import cors from "@fastify/cors";
import Fastify from "fastify";
import { logger } from "./logger.js";
import {
  registerPublicRnsV1Routes,
  type PublicRnsV1Dependencies,
} from "./routes/public-rns-v1.js";

export async function buildPublicRnsApp(dependencies?: PublicRnsV1Dependencies) {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    exposeHeadRoutes: false,
  });

  await app.register(cors, {
    origin: "*",
    credentials: false,
    methods: ["GET", "OPTIONS"],
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-request-id", request.id);
    return payload;
  });

  await registerPublicRnsV1Routes(app, dependencies);

  app.setNotFoundHandler(async (request, reply) => reply.code(404).send({
    error: "not_found",
    detail: `No RNS API route matches ${request.method} ${request.url}.`,
  }));

  app.setErrorHandler((error, request, reply) => {
    logger.error("Unhandled public RNS API error", {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
      error: error instanceof Error ? error.message : String(error),
    });
    void reply.code(500).send({
      error: "internal_error",
      requestId: request.id,
    });
  });

  return app;
}
