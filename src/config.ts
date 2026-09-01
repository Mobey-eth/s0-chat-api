import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const RISE_MAINNET_CHAIN_ID = 4_153;
const RISE_MAINNET_NAME = "RISE Mainnet";
const STAGE0_MAINNET_ADMIN = "0x78d2e9D2B81D94ED27310d61e5f9e1C4db35fba5";
const RNS_REGISTRY_START_BLOCK = 20_079_518n;
const RNS_RESOLVER_START_BLOCK = 20_079_521n;
const RNS_REGISTRAR_START_BLOCK = 20_079_523n;
const RNS_AUCTION_HOUSE_START_BLOCK = 20_079_526n;
const RNS_MARKETPLACE_START_BLOCK = 20_079_528n;

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: envBoolean.default(true),
  DATABASE_READ_ONLY: envBoolean.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(5),
  PORT: z.coerce.number().int().positive().optional(),
  CHAT_API_PORT: z.coerce.number().int().positive().default(8788),
  CHAT_CORS_ORIGIN: z.string().min(1).default("*"),
  CHAT_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  CHAT_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(12),
  CHAT_GUEST_PROMPT_LIMIT: z.coerce.number().int().positive().default(5),
  CHAT_INPUT_MAX_CHARS: z.coerce.number().int().positive().default(600),
  CHAT_OUTPUT_MAX_TOKENS_FAST: z.coerce.number().int().positive().default(160),
  CHAT_OUTPUT_MAX_TOKENS_DEEP: z.coerce.number().int().positive().default(320),
  STAGE0_API_PUBLIC_URL: z.string().url().optional(),
  STAGE0_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  STAGE0_DOCS_BASE_URL: z.string().url().default("https://stagezerolabs.gitbook.io/stage0"),
  STAGE0_DOCS_SEED_URLS: z.string().default(""),
  RISE_RPC_URL: z.string().url().default("https://rpc.risechain.com"),
  RISE_CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((value) => value === RISE_MAINNET_CHAIN_ID, {
      message: `RISE_CHAIN_ID must be ${RISE_MAINNET_CHAIN_ID} for the mainnet service`,
    })
    .default(RISE_MAINNET_CHAIN_ID),
  RISE_EXPLORER_URL: z.string().url().default("https://explorer.risechain.com"),
  RNS_REGISTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x6DDca710993C91402d52061868bE76043a4C5888"),
  RNS_RESOLVER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x36D6383774631565AB0D8F3710748610631A675d"),
  RNS_REGISTRAR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0xbCA437a93C2E7396a68Ce49BE224F65eE3CFd6Db"),
  RNS_AUCTION_HOUSE_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x0E37994c19980A792B83A106cE03a9b8a9cD40Fc"),
  RNS_MARKETPLACE_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x323A04F474f80225DE60C1Af13a672796aFA6622"),
  RNS_ADMIN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default(STAGE0_MAINNET_ADMIN),
  RNS_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(180),
  RNS_AUCTION_LIFECYCLE_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(300).default(180),
  RNS_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(12 * 60 * 60),
  RNS_SYNC_CHUNK_SIZE: z.coerce.number().int().positive().default(5_000),
  RNS_REGISTRY_START_BLOCK: z.coerce.bigint().nonnegative().default(RNS_REGISTRY_START_BLOCK),
  RNS_RESOLVER_START_BLOCK: z.coerce.bigint().nonnegative().default(RNS_RESOLVER_START_BLOCK),
  RNS_REGISTRAR_START_BLOCK: z.coerce.bigint().nonnegative().default(RNS_REGISTRAR_START_BLOCK),
  RNS_AUCTION_HOUSE_START_BLOCK: z.coerce.bigint().nonnegative().default(RNS_AUCTION_HOUSE_START_BLOCK),
  RNS_MARKETPLACE_START_BLOCK: z.coerce.bigint().nonnegative().default(RNS_MARKETPLACE_START_BLOCK),
  RNS_PRICE_SIGNER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  RNS_PRICE_QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RNS_PRICE_SOURCE_URL: z.string().url().default("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"),
  RNS_PRICE_SOURCE_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  RNS_PRICE_SETTER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default("hello@stage0.xyz"),
  RNS_ADMIN_ACTIVITY_SLACK_WEBHOOK_URL: z.string().url().optional(),
  RNS_PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RNS_PUBLIC_API_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  STAGE0_CREATOR_ADMIN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  STAGE0_CREATOR_APPLICATION_EMAIL: z.string().email().default("stagezero1@proton.me"),
  STAGE0_APP_URL: z.string().url().default("https://stage0.xyz"),
  STAGE0_X_URL: z.string().url().default("https://x.com/stage0_"),
  STAGE0_DISCORD_URL: z.string().url().default("https://discord.gg/jkPT89fA8d"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL_FAST: z.string().min(1).default("deepseek-v4-flash"),
  DEEPSEEK_MODEL_COMPLEX: z.string().min(1).default("deepseek-v4-pro"),
  ASSEMBLYAI_API_KEY: z.string().optional(),
});

const env = envSchema.parse(process.env);
const MAX_PROJECT_IMAGE_BYTES = 2 * 1024 * 1024;

export const config = {
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  databaseReadOnly: env.DATABASE_READ_ONLY,
  databasePoolMax: env.DATABASE_POOL_MAX,
  port: env.PORT ?? env.CHAT_API_PORT,
  corsOrigin: env.CHAT_CORS_ORIGIN,
  rateLimitWindowSeconds: env.CHAT_RATE_LIMIT_WINDOW_SECONDS,
  rateLimitMaxRequests: env.CHAT_RATE_LIMIT_MAX_REQUESTS,
  guestPromptLimit: env.CHAT_GUEST_PROMPT_LIMIT,
  chatInputMaxChars: env.CHAT_INPUT_MAX_CHARS,
  chatOutputMaxTokensFast: env.CHAT_OUTPUT_MAX_TOKENS_FAST,
  chatOutputMaxTokensDeep: env.CHAT_OUTPUT_MAX_TOKENS_DEEP,
  apiPublicBaseUrl:
    env.STAGE0_API_PUBLIC_URL?.replace(/\/$/, "") ??
    `http://localhost:${env.PORT ?? env.CHAT_API_PORT}`,
  uploadMaxBytes: Math.min(env.STAGE0_UPLOAD_MAX_BYTES, MAX_PROJECT_IMAGE_BYTES),
  docsBaseUrl: env.STAGE0_DOCS_BASE_URL.replace(/\/$/, ""),
  docsSeedUrls: env.STAGE0_DOCS_SEED_URLS
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  riseRpcUrl: env.RISE_RPC_URL,
  riseRpcOrigin: new URL(env.RISE_RPC_URL).origin,
  riseNetworkName: RISE_MAINNET_NAME,
  riseChainId: env.RISE_CHAIN_ID,
  riseExplorerUrl: env.RISE_EXPLORER_URL.replace(/\/$/, ""),
  rnsContracts: {
    registry: env.RNS_REGISTRY_ADDRESS.toLowerCase(),
    resolver: env.RNS_RESOLVER_ADDRESS.toLowerCase(),
    registrar: env.RNS_REGISTRAR_ADDRESS.toLowerCase(),
    auctionHouse: env.RNS_AUCTION_HOUSE_ADDRESS.toLowerCase(),
    marketplace: env.RNS_MARKETPLACE_ADDRESS.toLowerCase(),
  },
  rnsAdminAddress: env.RNS_ADMIN_ADDRESS.toLowerCase(),
  rnsSyncIntervalSeconds: env.RNS_SYNC_INTERVAL_SECONDS,
  rnsAuctionLifecycleIntervalSeconds: env.RNS_AUCTION_LIFECYCLE_INTERVAL_SECONDS,
  rnsReconcileIntervalSeconds: env.RNS_RECONCILE_INTERVAL_SECONDS,
  rnsSyncChunkSize: env.RNS_SYNC_CHUNK_SIZE,
  rnsStartBlocks: {
    registry: env.RNS_REGISTRY_START_BLOCK,
    resolver: env.RNS_RESOLVER_START_BLOCK,
    registrar: env.RNS_REGISTRAR_START_BLOCK,
    primaryAuction: env.RNS_AUCTION_HOUSE_START_BLOCK,
    marketplace: env.RNS_MARKETPLACE_START_BLOCK,
  },
  rnsPriceSignerPrivateKey: env.RNS_PRICE_SIGNER_PRIVATE_KEY,
  rnsPriceQuoteTtlSeconds: env.RNS_PRICE_QUOTE_TTL_SECONDS,
  rnsPriceSourceUrl: env.RNS_PRICE_SOURCE_URL,
  rnsPriceSourceRefreshIntervalMs: env.RNS_PRICE_SOURCE_REFRESH_INTERVAL_MS,
  rnsPriceSetterPrivateKey: env.RNS_PRICE_SETTER_PRIVATE_KEY,
  resendApiKey: env.RESEND_API_KEY,
  resendFromEmail: env.RESEND_FROM_EMAIL,
  rnsAdminActivitySlackWebhookUrl: env.RNS_ADMIN_ACTIVITY_SLACK_WEBHOOK_URL,
  rnsPublicApiRateLimitWindowSeconds: env.RNS_PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS,
  rnsPublicApiRateLimitMaxRequests: env.RNS_PUBLIC_API_RATE_LIMIT_MAX_REQUESTS,
  creatorAdminAddress: (env.STAGE0_CREATOR_ADMIN_ADDRESS ?? env.RNS_ADMIN_ADDRESS).toLowerCase(),
  creatorApplicationEmail: env.STAGE0_CREATOR_APPLICATION_EMAIL,
  stage0AppUrl: env.STAGE0_APP_URL.replace(/\/$/, ""),
  stage0XUrl: env.STAGE0_X_URL.replace(/\/$/, ""),
  stage0DiscordUrl: env.STAGE0_DISCORD_URL.replace(/\/$/, ""),
  deepseekApiKey: env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: env.DEEPSEEK_BASE_URL.replace(/\/$/, ""),
  deepseekModelFast: env.DEEPSEEK_MODEL_FAST,
  deepseekModelComplex: env.DEEPSEEK_MODEL_COMPLEX,
  assemblyAiApiKey: env.ASSEMBLYAI_API_KEY,
} as const;
