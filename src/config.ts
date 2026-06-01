import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.coerce.boolean().default(true),
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
  RISE_TESTNET_RPC_URL: z.string().url().default("https://testnet.riselabs.xyz"),
  RISE_TESTNET_CHAIN_ID: z.coerce.number().int().positive().default(11155931),
  RISE_TESTNET_EXPLORER_URL: z.string().url().default("https://explorer.testnet.riselabs.xyz"),
  STAGE0_APP_URL: z.string().url().default("https://stage0.xyz"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL_FAST: z.string().min(1).default("deepseek-v4-flash"),
  DEEPSEEK_MODEL_COMPLEX: z.string().min(1).default("deepseek-v4-pro"),
});

const env = envSchema.parse(process.env);
const MAX_PROJECT_IMAGE_BYTES = 2 * 1024 * 1024;

export const config = {
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
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
  riseTestnetRpcUrl: env.RISE_TESTNET_RPC_URL,
  riseTestnetChainId: env.RISE_TESTNET_CHAIN_ID,
  riseTestnetExplorerUrl: env.RISE_TESTNET_EXPLORER_URL.replace(/\/$/, ""),
  stage0AppUrl: env.STAGE0_APP_URL.replace(/\/$/, ""),
  deepseekApiKey: env.DEEPSEEK_API_KEY,
  deepseekBaseUrl: env.DEEPSEEK_BASE_URL.replace(/\/$/, ""),
  deepseekModelFast: env.DEEPSEEK_MODEL_FAST,
  deepseekModelComplex: env.DEEPSEEK_MODEL_COMPLEX,
} as const;
