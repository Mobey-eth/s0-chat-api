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
