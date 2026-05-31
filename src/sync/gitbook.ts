import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { basename, resolve } from "node:path";
import { config } from "../config.js";
import { closeDb, pool, replaceDocChunks, runMigrations, upsertDocSource } from "../db.js";
import { logger } from "../logger.js";

const MAX_PAGES_PER_RUN = 40;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const USER_AGENT = "senna-chat-api/0.1 docs-sync";

const DEFAULT_STAGE0_DOC_URLS = [
  "https://stagezerolabs.gitbook.io/stage0/abstract.md",
  "https://stagezerolabs.gitbook.io/stage0/everything-stage0/launchpad-overview.md",
  "https://stagezerolabs.gitbook.io/stage0/everything-stage0/who-benefits-from-stage0.md",
  "https://stagezerolabs.gitbook.io/stage0/stage0s-toolkit/launchpad.md",
  "https://stagezerolabs.gitbook.io/stage0/stage0s-toolkit/token-creator.md",
  "https://stagezerolabs.gitbook.io/stage0/stage0s-toolkit/nft-creator.md",
  "https://stagezerolabs.gitbook.io/stage0/stage0s-toolkit/locker-tokens-and-liquidity.md",
  "https://stagezerolabs.gitbook.io/stage0/stage0s-toolkit/airdrop-multi-send.md",
  "https://stagezerolabs.gitbook.io/stage0/platform/genesis-nfts.md",
  "https://stagezerolabs.gitbook.io/stage0/platform/contact-support.md",
];

const DEFAULT_RISE_DOC_URLS = [
  "https://docs.risechain.com/docs/builders/testnet-details.mdx",
  "https://docs.risechain.com/docs/builders/quick-start.mdx",
  "https://docs.risechain.com/docs/rise-wallet.mdx",
];

const BUNDLED_GUIDES = [
  resolve(process.cwd(), "docs/support/stage0_app_facts.md"),
  resolve(process.cwd(), "docs/support/rise_network_quick_guide.md"),
];

function chunkText(text: string, title: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks: Array<{ chunkIndex: number; title: string; headingPath: string; chunkText: string }> = [];

  let cursor = 0;
  let chunkIndex = 0;
  while (cursor < normalized.length) {
    const slice = normalized.slice(cursor, cursor + CHUNK_SIZE).trim();
    if (slice) {
      chunks.push({
        chunkIndex,
        title,
        headingPath: title,
        chunkText: slice,
      });
      chunkIndex += 1;
    }
    cursor += Math.max(CHUNK_SIZE - CHUNK_OVERLAP, 1);
  }

  return chunks;
}

function normalizeUrl(baseUrl: string, url: string): string | null {
  try {
    const parsed = new URL(url, baseUrl);
    const base = new URL(baseUrl);
    if (parsed.hostname !== base.hostname) return null;
    parsed.hash = "";
    parsed.search = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function extractMarkdownContent(markdown: string): { title: string; text: string } {
  const title =
    markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    markdown.match(/^title:\s*["']?(.+?)["']?$/m)?.[1]?.trim() ??
    "Untitled";

  const cleaned = markdown
    .replace(/^import\s+.+$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();

  return { title, text: cleaned };
}

function extractHtmlContent($: cheerio.CheerioAPI): { title: string; text: string } {
  const title = $("title").first().text().trim();

  $("script, style, nav, footer, header, noscript").remove();

  const mainText =
    $("main").text().trim() ||
    $("article").text().trim() ||
    $(".page-inner").text().trim() ||
    $(".markdown-section").text().trim() ||
    $("body").text().trim();

  const cleaned = mainText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();

  return { title: title || "Untitled", text: cleaned };
}

function isMarkdownUrl(url: string, contentType: string | null) {
  return /\.(md|mdx)(?:$|\?)/i.test(url) || /\b(markdown|text\/plain)\b/i.test(contentType ?? "");
}

function discoverLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const links = new Set<string>();
  const allowedHosts = new Set([
    new URL(config.docsBaseUrl).hostname,
    "docs.risechain.com",
  ]);

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const normalized = normalizeUrl(baseUrl, href);
    if (!normalized) return;

    const parsed = new URL(normalized);
    if (!allowedHosts.has(parsed.hostname)) return;
    if (!normalized.startsWith(config.docsBaseUrl) && !normalized.startsWith("https://docs.risechain.com/docs")) return;
    links.add(normalized);
  });

  return [...links];
}

async function getSyncedUrls(): Promise<Set<string>> {
  const result = await pool.query<{ source_url: string }>(
    `select source_url from senna.doc_sources`,
  );
  return new Set(result.rows.map((row) => row.source_url));
}

async function syncUrl(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
  });

  if (!response.ok) {
    logger.warn("Skipping URL fetch failure", { url, status: response.status });
    return;
  }

  const raw = await response.text();
  const contentType = response.headers.get("content-type");
  const { title, text } = isMarkdownUrl(url, contentType)
    ? extractMarkdownContent(raw)
    : extractHtmlContent(cheerio.load(raw));

  if (!text || text.length < 50) {
    logger.warn("Skipping URL with too little text", { url });
    return;
  }

  const contentHash = createHash("sha256").update(text).digest("hex");
  const sourceId = await upsertDocSource({ sourceUrl: url, title, contentHash });
  await replaceDocChunks({ sourceId, chunks: chunkText(text, title) });

  logger.info("Synced doc page", { url, title });
}

function resolveLocalGuideMetadata(filePath: string) {
  const fileName = basename(filePath).toLowerCase();

  if (fileName === "stage0_app_facts.md") {
    return {
      sourceUrl: "stage0-local://app-facts",
      title: "Stage0 App Facts",
    };
  }

  if (fileName === "rise_network_quick_guide.md") {
    return {
      sourceUrl: "stage0-local://rise-network-quick-guide",
      title: "RISE Network Quick Guide",
    };
  }

  return {
    sourceUrl: `stage0-local://${fileName}`,
    title: fileName,
  };
}

async function cleanupLegacyLocalGuideSource(filePath: string, canonicalSourceUrl: string) {
  const fileName = basename(filePath).toLowerCase();
  const legacySourceUrl = `local-guide://${fileName}`;

  if (legacySourceUrl === canonicalSourceUrl) return;

  await pool.query(
    `delete from senna.doc_sources where source_url = $1`,
    [legacySourceUrl],
  );
}

async function syncLocalGuide(filePath: string) {
  const text = (await readFile(filePath, "utf8")).trim();
  if (!text) {
    logger.warn("Skipping empty local guide", { filePath });
    return;
  }

  const metadata = resolveLocalGuideMetadata(filePath);
  await cleanupLegacyLocalGuideSource(filePath, metadata.sourceUrl);

  const contentHash = createHash("sha256").update(text).digest("hex");
  const sourceId = await upsertDocSource({
    sourceUrl: metadata.sourceUrl,
    title: metadata.title,
    contentHash,
  });

  await replaceDocChunks({
    sourceId,
    chunks: chunkText(text, metadata.title),
  });

  logger.info("Synced local guide", { filePath, sourceUrl: metadata.sourceUrl });
}

async function getBundledGuidePaths() {
  const resolved: string[] = [];

  for (const filePath of BUNDLED_GUIDES) {
    try {
      await access(filePath);
      resolved.push(filePath);
    } catch {
      logger.warn("Bundled guide not found, skipping", { filePath });
    }
  }

  return resolved;
}

async function main() {
  await runMigrations();

  const seedUrls =
    config.docsSeedUrls.length > 0
      ? config.docsSeedUrls
      : [...DEFAULT_STAGE0_DOC_URLS, ...DEFAULT_RISE_DOC_URLS];
  const synced = await getSyncedUrls();
  const toVisit: string[] = [];
  const visited = new Set<string>();

  for (const url of seedUrls) {
    if (!synced.has(url)) toVisit.push(url);
  }

  const discoverQueue: string[] = [...seedUrls];

  while (discoverQueue.length > 0 && toVisit.length + synced.size < MAX_PAGES_PER_RUN) {
    const current = discoverQueue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (!synced.has(current) && !toVisit.includes(current)) {
      toVisit.push(current);
    }

    try {
      const response = await fetch(current, {
        headers: { "user-agent": USER_AGENT },
      });

      if (!response.ok) continue;

      const raw = await response.text();
      if (isMarkdownUrl(current, response.headers.get("content-type"))) continue;

      const links = discoverLinks(cheerio.load(raw), current);
      for (const link of links) {
        if (!visited.has(link) && !synced.has(link)) {
          discoverQueue.push(link);
        }
      }
    } catch {
      logger.warn("Failed to discover links from URL", { url: current });
    }
  }

  for (const url of [...new Set(toVisit)].slice(0, MAX_PAGES_PER_RUN)) {
    await syncUrl(url);
  }

  for (const filePath of await getBundledGuidePaths()) {
    await syncLocalGuide(filePath);
  }

  logger.info("Docs sync complete", {
    synced: toVisit.length,
    totalSources: synced.size + toVisit.length,
  });
}

main()
  .catch((error) => {
    logger.error("Docs sync failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
