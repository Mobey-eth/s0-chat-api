import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

function toJson(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function isUndefinedColumnError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42703");
}

export interface RetrievedDocChunk {
  id: string;
  source_url: string;
  title: string | null;
  heading_path: string | null;
  chunk_text: string;
  rank: number;
}

export async function closeDb() {
  await pool.end();
}

export async function runMigrations() {
  const sqlDir = resolve(process.cwd(), "sql");
  const files = (await readdir(sqlDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await readFile(resolve(sqlDir, file), "utf8");
    await pool.query(sql);
  }
}

export async function upsertDocSource(input: {
  sourceUrl: string;
  title: string;
  contentHash: string;
}) {
  const result = await pool.query<{ id: string }>(
    `
      insert into senna.doc_sources (source_url, title, content_hash)
      values ($1, $2, $3)
      on conflict (source_url)
      do update set
        title = excluded.title,
        content_hash = excluded.content_hash,
        last_synced_at = now(),
        updated_at = now()
      returning id
    `,
    [input.sourceUrl, input.title, input.contentHash],
  );

  return result.rows[0].id;
}

export async function replaceDocChunks(input: {
  sourceId: string;
  chunks: Array<{ chunkIndex: number; title: string; headingPath: string; chunkText: string }>;
}) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(`delete from senna.doc_chunks where source_id = $1`, [input.sourceId]);

    for (const chunk of input.chunks) {
      await client.query(
        `
          insert into senna.doc_chunks (
            source_id,
            chunk_index,
            title,
            heading_path,
            chunk_text
          )
          values ($1, $2, $3, $4, $5)
        `,
        [input.sourceId, chunk.chunkIndex, chunk.title, chunk.headingPath, chunk.chunkText],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function searchDocChunks(query: string, limit = 6) {
  const result = await pool.query<RetrievedDocChunk>(
    `
      with ranked as (
        select
          c.id,
          s.source_url,
          c.title,
          c.heading_path,
          c.chunk_text,
          ts_rank_cd(
            c.tsv,
            websearch_to_tsquery('english', $1)
          ) as rank
        from senna.doc_chunks c
        join senna.doc_sources s on s.id = c.source_id
        where c.tsv @@ websearch_to_tsquery('english', $1)
      )
      select *
      from ranked
      order by rank desc, source_url asc
      limit $2
    `,
    [query, limit],
  );

  return result.rows;
}

export async function createChatSession(input?: {
  walletAddress?: string;
  evmAddress?: string;
  title?: string;
}) {
  const result = await pool.query<{ id: string }>(
    `
      insert into senna.chat_sessions (wallet_address, evm_address, title)
      values ($1, $2, $3)
      returning id
    `,
    [input?.walletAddress ?? null, input?.evmAddress ?? null, input?.title ?? null],
  );

  return result.rows[0].id;
}

export async function appendChatMessage(input: {
  sessionId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  citationsJson?: unknown;
  metaJson?: unknown;
}) {
  await pool.query(
    `
      insert into senna.chat_messages (session_id, role, content, citations_json, meta_json)
      values ($1, $2, $3, $4, $5)
    `,
    [input.sessionId, input.role, input.content, toJson(input.citationsJson), toJson(input.metaJson)],
  );
}

export async function saveActionDraft(input: {
  sessionId?: string;
  actionType: string;
  route: string;
  requiredWallet?: string;
  requiredChain?: string;
  prefillJson: unknown;
  summary: string;
  warningsJson?: unknown;
  missingFieldsJson?: unknown;
  nextStepsJson?: unknown;
}) {
  const result = await pool.query<{ id: string }>(
    `
      insert into senna.action_drafts (
        session_id,
        action_type,
        route,
        required_wallet,
        required_chain,
        prefill_json,
        summary,
        warnings_json,
        missing_fields_json,
        next_steps_json
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id
    `,
    [
      input.sessionId ?? null,
      input.actionType,
      input.route,
      input.requiredWallet ?? null,
      input.requiredChain ?? null,
      toJson(input.prefillJson),
      input.summary,
      toJson(input.warningsJson),
      toJson(input.missingFieldsJson),
      toJson(input.nextStepsJson),
    ],
  );

  return result.rows[0].id;
}

export interface StoredActionDraft {
  actionType: string;
  route: string;
  requiredWallet: string | null;
  requiredChain: string | null;
  prefill: Record<string, string>;
  summary: string;
  warnings: string[];
  missingFields: string[];
  nextSteps: string[];
}

export async function getLatestActionDraft(sessionId: string): Promise<StoredActionDraft | null> {
  const result = await pool.query<{
    action_type: string;
    route: string;
    required_wallet: string | null;
    required_chain: string | null;
    prefill_json: Record<string, string> | null;
    summary: string;
    warnings_json: string[] | null;
    missing_fields_json: string[] | null;
    next_steps_json: string[] | null;
  }>(
    `
      select
        action_type,
        route,
        required_wallet,
        required_chain,
        prefill_json,
        summary,
        warnings_json,
        missing_fields_json,
        next_steps_json
      from senna.action_drafts
      where session_id = $1
      order by created_at desc, id desc
      limit 1
    `,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    actionType: row.action_type,
    route: row.route,
    requiredWallet: row.required_wallet,
    requiredChain: row.required_chain,
    prefill: row.prefill_json ?? {},
    summary: row.summary,
    warnings: row.warnings_json ?? [],
    missingFields: row.missing_fields_json ?? [],
    nextSteps: row.next_steps_json ?? [],
  };
}

export async function insertToolRun(input: {
  sessionId?: string;
  toolName: string;
  inputJson: unknown;
  outputJson?: unknown;
  status: string;
}) {
  await pool.query(
    `
      insert into senna.tool_runs (session_id, tool_name, input_json, output_json, status)
      values ($1, $2, $3, $4, $5)
    `,
    [input.sessionId ?? null, input.toolName, toJson(input.inputJson), toJson(input.outputJson), input.status],
  );
}

export async function getSessionMessages(sessionId: string, limit = 50) {
  const result = await pool.query<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    citations_json: unknown;
    meta_json: unknown;
  }>(
    `
      select role, content, citations_json, meta_json
      from senna.chat_messages
      where session_id = $1
      order by created_at asc
      limit $2
    `,
    [sessionId, limit],
  );

  return result.rows;
}

export async function countSessionUserMessages(sessionId: string) {
  const result = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from senna.chat_messages
      where session_id = $1
        and role = 'user'
    `,
    [sessionId],
  );

  return Number(result.rows[0]?.count ?? "0");
}

export async function getOffTopicStrikes(sessionId: string): Promise<number> {
  try {
    const result = await pool.query<{ off_topic_strikes: number }>(
      `select off_topic_strikes from senna.chat_sessions where id = $1`,
      [sessionId],
    );
    return Number(result.rows[0]?.off_topic_strikes ?? 0);
  } catch (error) {
    if (isUndefinedColumnError(error)) return 0;
    throw error;
  }
}

export async function incrementOffTopicStrikes(sessionId: string): Promise<number> {
  try {
    const result = await pool.query<{ off_topic_strikes: number }>(
      `
        update senna.chat_sessions
          set off_topic_strikes = off_topic_strikes + 1,
              updated_at = now()
          where id = $1
          returning off_topic_strikes
      `,
      [sessionId],
    );
    return Number(result.rows[0]?.off_topic_strikes ?? 1);
  } catch (error) {
    if (isUndefinedColumnError(error)) return 1;
    throw error;
  }
}

export async function resetOffTopicStrikes(sessionId: string) {
  try {
    await pool.query(
      `
        update senna.chat_sessions
          set off_topic_strikes = 0,
              updated_at = now()
          where id = $1
            and off_topic_strikes > 0
      `,
      [sessionId],
    );
  } catch (error) {
    if (isUndefinedColumnError(error)) return;
    throw error;
  }
}

export async function logChatError(input: {
  sessionId?: string | null;
  scope: string;
  code: string;
  internalMessage?: string;
  httpStatus?: number;
}) {
  await pool.query(
    `
      insert into senna.error_log (session_id, scope, code, internal_message, http_status)
      values ($1, $2, $3, $4, $5)
    `,
    [
      input.sessionId ?? null,
      input.scope,
      input.code,
      input.internalMessage ?? null,
      input.httpStatus ?? null,
    ],
  );
}

export async function takeRateLimit(input: {
  scope: string;
  subject: string;
  windowSeconds: number;
}) {
  const bucketStartMs =
    Math.floor(Date.now() / (input.windowSeconds * 1000)) * input.windowSeconds * 1000;
  const bucketStart = new Date(bucketStartMs).toISOString();

  const result = await pool.query<{ hits: number }>(
    `
      insert into senna.rate_limit_windows (
        scope,
        subject,
        bucket_start,
        window_seconds,
        hits
      )
      values ($1, $2, $3::timestamptz, $4, 1)
      on conflict (scope, subject, bucket_start, window_seconds)
      do update set
        hits = senna.rate_limit_windows.hits + 1,
        updated_at = now()
      returning hits
    `,
    [input.scope, input.subject, bucketStart, input.windowSeconds],
  );

  return {
    hits: result.rows[0]?.hits ?? 1,
    bucketStart,
  };
}

export interface ProjectImageMapping {
  imageUrl?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  uploadedAt: string;
  description?: string;
  websiteUrl?: string;
  xUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
}

export interface StoredImageAsset {
  imageData: Buffer;
  imageMimeType: string;
  imageSizeBytes: number;
}

export async function upsertCollectionImage(input: {
  id: string;
  chainId: number;
  collectionAddress: string;
  imageUrl?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  imageData?: Buffer;
  description?: string | null;
  websiteUrl?: string | null;
  xUrl?: string | null;
  telegramUrl?: string | null;
  discordUrl?: string | null;
}): Promise<ProjectImageMapping> {
  const result = await pool.query<{
    image_url: string | null;
    image_mime_type: string | null;
    image_size_bytes: number | null;
    uploaded_at: string;
    description: string | null;
    website_url: string | null;
    x_url: string | null;
    telegram_url: string | null;
    discord_url: string | null;
  }>(
    `
      insert into senna.collection_images (
        id,
        chain_id,
        collection_address,
        image_url,
        image_mime_type,
        image_size_bytes,
        image_data,
        description,
        website_url,
        x_url,
        telegram_url,
        discord_url
      )
      values ($1, $2, lower($3), $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (chain_id, collection_address)
      do update set
        id = case when excluded.image_data is not null then excluded.id else senna.collection_images.id end,
        image_url = coalesce(excluded.image_url, senna.collection_images.image_url),
        image_mime_type = coalesce(excluded.image_mime_type, senna.collection_images.image_mime_type),
        image_size_bytes = coalesce(excluded.image_size_bytes, senna.collection_images.image_size_bytes),
        image_data = coalesce(excluded.image_data, senna.collection_images.image_data),
        description = excluded.description,
        website_url = excluded.website_url,
        x_url = excluded.x_url,
        telegram_url = excluded.telegram_url,
        discord_url = excluded.discord_url,
        uploaded_at = case when excluded.image_data is not null then now() else senna.collection_images.uploaded_at end,
        updated_at = now()
      returning image_url, image_mime_type, image_size_bytes, uploaded_at, description, website_url, x_url, telegram_url, discord_url
    `,
    [
      input.id,
      input.chainId,
      input.collectionAddress,
      input.imageUrl ?? null,
      input.imageMimeType ?? null,
      input.imageSizeBytes ?? null,
      input.imageData ?? null,
      input.description ?? null,
      input.websiteUrl ?? null,
      input.xUrl ?? null,
      input.telegramUrl ?? null,
      input.discordUrl ?? null,
    ],
  );

  const row = result.rows[0];
  return {
    imageUrl: row.image_url ?? undefined,
    imageMimeType: row.image_mime_type ?? undefined,
    imageSizeBytes: row.image_size_bytes ?? undefined,
    uploadedAt: row.uploaded_at,
    description: row.description ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    xUrl: row.x_url ?? undefined,
    telegramUrl: row.telegram_url ?? undefined,
    discordUrl: row.discord_url ?? undefined,
  };
}

export async function upsertTokenImage(input: {
  id: string;
  chainId: number;
  tokenAddress: string;
  imageUrl?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  imageData?: Buffer;
  description?: string | null;
  websiteUrl?: string | null;
  xUrl?: string | null;
  telegramUrl?: string | null;
  discordUrl?: string | null;
}): Promise<ProjectImageMapping> {
  const result = await pool.query<{
    image_url: string | null;
    image_mime_type: string | null;
    image_size_bytes: number | null;
    uploaded_at: string;
    description: string | null;
    website_url: string | null;
    x_url: string | null;
    telegram_url: string | null;
    discord_url: string | null;
  }>(
    `
      insert into senna.token_images (
        id,
        chain_id,
        token_address,
        image_url,
        image_mime_type,
        image_size_bytes,
        image_data,
        description,
        website_url,
        x_url,
        telegram_url,
        discord_url
      )
      values ($1, $2, lower($3), $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (chain_id, token_address)
      do update set
        id = case when excluded.image_data is not null then excluded.id else senna.token_images.id end,
        image_url = coalesce(excluded.image_url, senna.token_images.image_url),
        image_mime_type = coalesce(excluded.image_mime_type, senna.token_images.image_mime_type),
        image_size_bytes = coalesce(excluded.image_size_bytes, senna.token_images.image_size_bytes),
        image_data = coalesce(excluded.image_data, senna.token_images.image_data),
        description = excluded.description,
        website_url = excluded.website_url,
        x_url = excluded.x_url,
        telegram_url = excluded.telegram_url,
        discord_url = excluded.discord_url,
        uploaded_at = case when excluded.image_data is not null then now() else senna.token_images.uploaded_at end,
        updated_at = now()
      returning image_url, image_mime_type, image_size_bytes, uploaded_at, description, website_url, x_url, telegram_url, discord_url
    `,
    [
      input.id,
      input.chainId,
      input.tokenAddress,
      input.imageUrl ?? null,
      input.imageMimeType ?? null,
      input.imageSizeBytes ?? null,
      input.imageData ?? null,
      input.description ?? null,
      input.websiteUrl ?? null,
      input.xUrl ?? null,
      input.telegramUrl ?? null,
      input.discordUrl ?? null,
    ],
  );

  const row = result.rows[0];
  return {
    imageUrl: row.image_url ?? undefined,
    imageMimeType: row.image_mime_type ?? undefined,
    imageSizeBytes: row.image_size_bytes ?? undefined,
    uploadedAt: row.uploaded_at,
    description: row.description ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    xUrl: row.x_url ?? undefined,
    telegramUrl: row.telegram_url ?? undefined,
    discordUrl: row.discord_url ?? undefined,
  };
}

export async function getImageAsset(id: string): Promise<StoredImageAsset | null> {
  const result = await pool.query<{
    image_data: Buffer;
    image_mime_type: string;
    image_size_bytes: number;
  }>(
    `
      select image_data, image_mime_type, image_size_bytes
      from senna.collection_images
      where id = $1
        and image_data is not null
      union all
      select image_data, image_mime_type, image_size_bytes
      from senna.token_images
      where id = $1
        and image_data is not null
      limit 1
    `,
    [id],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    imageData: row.image_data,
    imageMimeType: row.image_mime_type,
    imageSizeBytes: row.image_size_bytes,
  };
}

export async function getCollectionImages(input: {
  chainId: number;
  addresses: string[];
}): Promise<Record<string, ProjectImageMapping>> {
  if (input.addresses.length === 0) return {};

  const normalizedAddresses = input.addresses.map((address) => address.toLowerCase());
  const result = await pool.query<{
    collection_address: string;
    image_url: string | null;
    image_mime_type: string | null;
    image_size_bytes: number | null;
    uploaded_at: string;
    description: string | null;
    website_url: string | null;
    x_url: string | null;
    telegram_url: string | null;
    discord_url: string | null;
  }>(
    `
      select collection_address, image_url, image_mime_type, image_size_bytes, uploaded_at, description, website_url, x_url, telegram_url, discord_url
      from senna.collection_images
      where chain_id = $1
        and collection_address = any($2::text[])
    `,
    [input.chainId, normalizedAddresses],
  );

  return Object.fromEntries(
    result.rows.map((row) => [
      row.collection_address,
      {
        imageUrl: row.image_url ?? undefined,
        imageMimeType: row.image_mime_type ?? undefined,
        imageSizeBytes: row.image_size_bytes ?? undefined,
        uploadedAt: row.uploaded_at,
        description: row.description ?? undefined,
        websiteUrl: row.website_url ?? undefined,
        xUrl: row.x_url ?? undefined,
        telegramUrl: row.telegram_url ?? undefined,
        discordUrl: row.discord_url ?? undefined,
      },
    ]),
  );
}

export async function getTokenImages(input: {
  chainId: number;
  addresses: string[];
}): Promise<Record<string, ProjectImageMapping>> {
  if (input.addresses.length === 0) return {};

  const normalizedAddresses = input.addresses.map((address) => address.toLowerCase());
  const result = await pool.query<{
    token_address: string;
    image_url: string | null;
    image_mime_type: string | null;
    image_size_bytes: number | null;
    uploaded_at: string;
    description: string | null;
    website_url: string | null;
    x_url: string | null;
    telegram_url: string | null;
    discord_url: string | null;
  }>(
    `
      select token_address, image_url, image_mime_type, image_size_bytes, uploaded_at, description, website_url, x_url, telegram_url, discord_url
      from senna.token_images
      where chain_id = $1
        and token_address = any($2::text[])
    `,
    [input.chainId, normalizedAddresses],
  );

  return Object.fromEntries(
    result.rows.map((row) => [
      row.token_address,
      {
        imageUrl: row.image_url ?? undefined,
        imageMimeType: row.image_mime_type ?? undefined,
        imageSizeBytes: row.image_size_bytes ?? undefined,
        uploadedAt: row.uploaded_at,
        description: row.description ?? undefined,
        websiteUrl: row.website_url ?? undefined,
        xUrl: row.x_url ?? undefined,
        telegramUrl: row.telegram_url ?? undefined,
        discordUrl: row.discord_url ?? undefined,
      },
    ]),
  );
}

export type CreatorApplicationType = "nft" | "presale";
export type CreatorApplicationStatus = "pending" | "approved" | "rejected";

export type CreatorTeamMember = {
  name: string;
  role: string;
  x?: string;
  telegram?: string;
  discord?: string;
};

export interface CreatorApplicationRecord {
  id: string;
  chainId: number;
  applicationType: CreatorApplicationType;
  applicantWallet: string;
  founderAddressInput: string;
  founderName: string;
  founderRole: string;
  founderEmail: string;
  founderX?: string;
  founderTelegram?: string;
  founderDiscord?: string;
  projectName: string;
  projectDescription: string;
  projectStage: string;
  projectWebsiteUrl?: string;
  projectX?: string;
  projectTelegram?: string;
  projectDiscord?: string;
  projectDetails: Record<string, string>;
  teamMembers: CreatorTeamMember[];
  imageUrl?: string;
  imageMimeType?: string;
  imageSizeBytes?: number;
  status: CreatorApplicationStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  notificationStatus: "pending" | "sent" | "partial" | "failed" | "skipped";
  notificationError?: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

type CreatorApplicationRow = {
  id: string;
  chain_id: number;
  application_type: CreatorApplicationType;
  applicant_wallet: string;
  founder_address_input: string;
  founder_name: string;
  founder_role: string;
  founder_email: string;
  founder_x: string | null;
  founder_telegram: string | null;
  founder_discord: string | null;
  project_name: string;
  project_description: string;
  project_stage: string;
  project_website_url: string | null;
  project_x: string | null;
  project_telegram: string | null;
  project_discord: string | null;
  project_details: Record<string, string> | null;
  team_members: CreatorTeamMember[] | null;
  image_url: string | null;
  image_mime_type: string | null;
  image_size_bytes: number | null;
  status: CreatorApplicationStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notification_status: CreatorApplicationRecord["notificationStatus"];
  notification_error: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

function toCreatorApplicationRecord(row: CreatorApplicationRow): CreatorApplicationRecord {
  return {
    id: row.id,
    chainId: row.chain_id,
    applicationType: row.application_type,
    applicantWallet: row.applicant_wallet,
    founderAddressInput: row.founder_address_input,
    founderName: row.founder_name,
    founderRole: row.founder_role,
    founderEmail: row.founder_email,
    founderX: row.founder_x ?? undefined,
    founderTelegram: row.founder_telegram ?? undefined,
    founderDiscord: row.founder_discord ?? undefined,
    projectName: row.project_name,
    projectDescription: row.project_description,
    projectStage: row.project_stage,
    projectWebsiteUrl: row.project_website_url ?? undefined,
    projectX: row.project_x ?? undefined,
    projectTelegram: row.project_telegram ?? undefined,
    projectDiscord: row.project_discord ?? undefined,
    projectDetails: row.project_details ?? {},
    teamMembers: row.team_members ?? [],
    imageUrl: row.image_url ?? undefined,
    imageMimeType: row.image_mime_type ?? undefined,
    imageSizeBytes: row.image_size_bytes ?? undefined,
    status: row.status,
    reviewNotes: row.review_notes ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    notificationStatus: row.notification_status,
    notificationError: row.notification_error ?? undefined,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CREATOR_APPLICATION_COLUMNS = `
  id, chain_id, application_type, applicant_wallet, founder_address_input,
  founder_name, founder_role, founder_email, founder_x, founder_telegram,
  founder_discord, project_name, project_description, project_stage,
  project_website_url, project_x, project_telegram, project_discord,
  project_details, team_members, image_url, image_mime_type, image_size_bytes,
  status, review_notes, reviewed_by, reviewed_at, notification_status,
  notification_error, submitted_at, created_at, updated_at
`;

export async function upsertCreatorApplication(input: {
  id: string;
  chainId: number;
  applicationType: CreatorApplicationType;
  applicantWallet: string;
  founderAddressInput: string;
  founderName: string;
  founderRole: string;
  founderEmail: string;
  founderX?: string | null;
  founderTelegram?: string | null;
  founderDiscord?: string | null;
  projectName: string;
  projectDescription: string;
  projectStage: string;
  projectWebsiteUrl?: string | null;
  projectX?: string | null;
  projectTelegram?: string | null;
  projectDiscord?: string | null;
  projectDetails: Record<string, string>;
  teamMembers: CreatorTeamMember[];
  imageUrl: string;
  imageMimeType: string;
  imageSizeBytes: number;
  imageData: Buffer;
}): Promise<CreatorApplicationRecord> {
  const result = await pool.query<CreatorApplicationRow>(
    `
      insert into senna.creator_applications (
        id, chain_id, application_type, applicant_wallet, founder_address_input,
        founder_name, founder_role, founder_email, founder_x, founder_telegram,
        founder_discord, project_name, project_description, project_stage,
        project_website_url, project_x, project_telegram, project_discord,
        project_details, team_members, image_url, image_mime_type,
        image_size_bytes, image_data
      ) values (
        $1, $2, $3, lower($4), $5, $6, $7, lower($8), $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb,
        $21, $22, $23, $24
      )
      on conflict (chain_id, application_type, applicant_wallet) where status = 'pending'
      do update set
        founder_address_input = excluded.founder_address_input,
        founder_name = excluded.founder_name,
        founder_role = excluded.founder_role,
        founder_email = excluded.founder_email,
        founder_x = excluded.founder_x,
        founder_telegram = excluded.founder_telegram,
        founder_discord = excluded.founder_discord,
        project_name = excluded.project_name,
        project_description = excluded.project_description,
        project_stage = excluded.project_stage,
        project_website_url = excluded.project_website_url,
        project_x = excluded.project_x,
        project_telegram = excluded.project_telegram,
        project_discord = excluded.project_discord,
        project_details = excluded.project_details,
        team_members = excluded.team_members,
        image_url = senna.creator_applications.image_url,
        image_mime_type = excluded.image_mime_type,
        image_size_bytes = excluded.image_size_bytes,
        image_data = excluded.image_data,
        notification_status = 'pending',
        notification_error = null,
        submitted_at = now(),
        updated_at = now()
      returning ${CREATOR_APPLICATION_COLUMNS}
    `,
    [
      input.id,
      input.chainId,
      input.applicationType,
      input.applicantWallet,
      input.founderAddressInput,
      input.founderName,
      input.founderRole,
      input.founderEmail,
      input.founderX ?? null,
      input.founderTelegram ?? null,
      input.founderDiscord ?? null,
      input.projectName,
      input.projectDescription,
      input.projectStage,
      input.projectWebsiteUrl ?? null,
      input.projectX ?? null,
      input.projectTelegram ?? null,
      input.projectDiscord ?? null,
      JSON.stringify(input.projectDetails),
      JSON.stringify(input.teamMembers),
      input.imageUrl,
      input.imageMimeType,
      input.imageSizeBytes,
      input.imageData,
    ],
  );

  return toCreatorApplicationRecord(result.rows[0]);
}

export async function getCreatorApplicationImage(id: string): Promise<StoredImageAsset | null> {
  const result = await pool.query<{
    image_data: Buffer;
    image_mime_type: string;
    image_size_bytes: number;
  }>(
    `
      select image_data, image_mime_type, image_size_bytes
      from senna.creator_applications
      where id = $1 and image_data is not null
    `,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    imageData: row.image_data,
    imageMimeType: row.image_mime_type,
    imageSizeBytes: row.image_size_bytes,
  };
}

export async function getCreatorAccess(input: { chainId: number; walletAddress: string }) {
  const [approvals, applications] = await Promise.all([
    pool.query<{ application_type: CreatorApplicationType; approved: boolean }>(
      `
        select application_type, approved
        from senna.creator_approvals
        where chain_id = $1 and wallet_address = lower($2)
      `,
      [input.chainId, input.walletAddress],
    ),
    pool.query<{
      application_type: CreatorApplicationType;
      id: string;
      status: CreatorApplicationStatus;
      project_name: string;
      submitted_at: string;
      review_notes: string | null;
    }>(
      `
        select distinct on (application_type)
          application_type, id, status, project_name, submitted_at, review_notes
        from senna.creator_applications
        where chain_id = $1 and applicant_wallet = lower($2)
        order by application_type, submitted_at desc
      `,
      [input.chainId, input.walletAddress],
    ),
  ]);

  const approvalMap = new Map(approvals.rows.map((row) => [row.application_type, row.approved]));
  const applicationMap = new Map(applications.rows.map((row) => [row.application_type, row]));
  const latestApplication = (applicationType: CreatorApplicationType) => {
    const row = applicationMap.get(applicationType);
    if (!row) return null;
    return {
      id: row.id,
      applicationType: row.application_type,
      status: row.status,
      projectName: row.project_name,
      submittedAt: row.submitted_at,
      reviewNotes: row.review_notes,
    };
  };
  return {
    nft: {
      approved: approvalMap.get("nft") === true,
      application: latestApplication("nft"),
    },
    presale: {
      approved: approvalMap.get("presale") === true,
      application: latestApplication("presale"),
    },
  };
}

export async function listCreatorApplications(input: {
  chainId: number;
  status?: CreatorApplicationStatus;
  limit?: number;
}) {
  const result = await pool.query<CreatorApplicationRow>(
    `
      select ${CREATOR_APPLICATION_COLUMNS}
      from senna.creator_applications
      where chain_id = $1
        and ($2::text is null or status = $2)
      order by
        case status when 'pending' then 0 when 'approved' then 1 else 2 end,
        submitted_at desc
      limit $3
    `,
    [input.chainId, input.status ?? null, input.limit ?? 100],
  );
  return result.rows.map(toCreatorApplicationRecord);
}

export async function setCreatorApproval(input: {
  chainId: number;
  applicationType: CreatorApplicationType;
  walletAddress: string;
  approved: boolean;
  approvedBy: string;
  applicationId?: string | null;
  notes?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        insert into senna.creator_approvals (
          chain_id, application_type, wallet_address, approved,
          application_id, approved_by, notes, approved_at
        ) values ($1, $2, lower($3), $4, $5, lower($6), $7, case when $4 then now() else null end)
        on conflict (chain_id, application_type, wallet_address)
        do update set
          approved = excluded.approved,
          application_id = coalesce(excluded.application_id, senna.creator_approvals.application_id),
          approved_by = excluded.approved_by,
          notes = excluded.notes,
          approved_at = case when excluded.approved then now() else null end,
          updated_at = now()
      `,
      [
        input.chainId,
        input.applicationType,
        input.walletAddress,
        input.approved,
        input.applicationId ?? null,
        input.approvedBy,
        input.notes ?? null,
      ],
    );

    if (input.applicationId) {
      await client.query(
        `
          update senna.creator_applications
          set status = $1,
              review_notes = $2,
              reviewed_by = lower($3),
              reviewed_at = now(),
              updated_at = now()
          where id = $4
            and chain_id = $5
            and application_type = $6
            and applicant_wallet = lower($7)
        `,
        [
          input.approved ? "approved" : "rejected",
          input.notes ?? null,
          input.approvedBy,
          input.applicationId,
          input.chainId,
          input.applicationType,
          input.walletAddress,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return getCreatorAccess({ chainId: input.chainId, walletAddress: input.walletAddress });
}

export async function markCreatorApplicationNotification(input: {
  id: string;
  status: CreatorApplicationRecord["notificationStatus"];
  error?: string | null;
}) {
  await pool.query(
    `
      update senna.creator_applications
      set notification_status = $2,
          notification_error = $3,
          updated_at = now()
      where id = $1
    `,
    [input.id, input.status, input.error ?? null],
  );
}

export type CreatorAdminChallenge = {
  id: string;
  chainId: number;
  adminAddress: string;
  nonce: string;
  expiresAt: string;
};

export async function createCreatorAdminChallenge(input: CreatorAdminChallenge) {
  await pool.query(
    `
      insert into senna.creator_admin_challenges (
        id, chain_id, admin_address, nonce, expires_at
      ) values ($1, $2, lower($3), lower($4), $5)
    `,
    [input.id, input.chainId, input.adminAddress, input.nonce, input.expiresAt],
  );

  await pool.query(
    `
      delete from senna.creator_admin_challenges
      where expires_at <= now() or used_at < now() - interval '1 hour'
    `,
  );
}

export async function getCreatorAdminChallenge(id: string): Promise<CreatorAdminChallenge | null> {
  const result = await pool.query<{
    id: string;
    chain_id: number;
    admin_address: string;
    nonce: string;
    expires_at: Date;
  }>(
    `
      select id, chain_id, admin_address, nonce, expires_at
      from senna.creator_admin_challenges
      where id = $1 and used_at is null and expires_at > now()
    `,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    chainId: row.chain_id,
    adminAddress: row.admin_address,
    nonce: row.nonce,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function consumeCreatorAdminChallenge(input: {
  challengeId: string;
  chainId: number;
  adminAddress: string;
  tokenHash: string;
  sessionExpiresAt: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const consumed = await client.query(
      `
        update senna.creator_admin_challenges
        set used_at = now()
        where id = $1
          and chain_id = $2
          and admin_address = lower($3)
          and used_at is null
          and expires_at > now()
        returning id
      `,
      [input.challengeId, input.chainId, input.adminAddress],
    );
    if (consumed.rowCount !== 1) {
      await client.query("rollback");
      return false;
    }

    await client.query(
      `
        insert into senna.creator_admin_sessions (
          token_hash, chain_id, admin_address, expires_at
        ) values ($1, $2, lower($3), $4)
      `,
      [input.tokenHash, input.chainId, input.adminAddress, input.sessionExpiresAt],
    );
    await client.query(
      `delete from senna.creator_admin_sessions where expires_at <= now()`,
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCreatorAdminSession(tokenHash: string) {
  const result = await pool.query<{
    chain_id: number;
    admin_address: string;
    expires_at: Date;
  }>(
    `
      update senna.creator_admin_sessions
      set last_used_at = now()
      where token_hash = $1 and expires_at > now()
      returning chain_id, admin_address, expires_at
    `,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    chainId: row.chain_id,
    adminAddress: row.admin_address,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function revokeCreatorAdminSession(tokenHash: string) {
  await pool.query(
    `delete from senna.creator_admin_sessions where token_hash = $1`,
    [tokenHash],
  );
}

export async function getHealthCounts() {
  const [sources, chunks] = await Promise.all([
    pool.query<{ count: string }>(`select count(*)::text as count from senna.doc_sources`),
    pool.query<{ count: string }>(`select count(*)::text as count from senna.doc_chunks`),
  ]);

  return {
    docSources: Number(sources.rows[0]?.count ?? "0"),
    docChunks: Number(chunks.rows[0]?.count ?? "0"),
  };
}
