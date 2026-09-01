import cors from "@fastify/cors";
import Fastify from "fastify";
import { logger } from "./logger.js";
import {
  registerPublicRnsV1Routes,
  type PublicRnsV1Dependencies,
} from "./routes/public-rns-v1.js";

// Cloudflare publishes these ranges at https://www.cloudflare.com/ips/.
// Keep them explicit so a direct origin request cannot spoof X-Forwarded-For.
const TRUSTED_PROXY_CIDRS = [
  "loopback",
  "linklocal",
  "uniquelocal",
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

export async function buildPublicRnsApp(dependencies?: PublicRnsV1Dependencies) {
  const app = Fastify({
    logger: false,
    trustProxy: TRUSTED_PROXY_CIDRS,
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
