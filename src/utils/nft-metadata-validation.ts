import {
  getContractMetadataCandidateUrls,
  ipfsUriToHttp,
  normalizeBaseURI,
  normalizeContractURI,
} from "./ipfs.js";

type MetadataJson = Record<string, unknown>;

export type NFTMetadataValidationResult =
  | {
      ok: true;
      normalizedBaseURI: string;
      normalizedContractURI: string;
      tokenMetadataUrl: string;
      contractMetadataUrl: string;
      warnings: string[];
    }
  | {
      ok: false;
      normalizedBaseURI: string;
      normalizedContractURI: string;
      message: string;
    };

const METADATA_FETCH_TIMEOUT_MS = 5_000;

function extractMetadataImage(parsed: MetadataJson): string | undefined {
  const candidates = [
    parsed.image,
    parsed.image_url,
    parsed.imageUrl,
    parsed.thumbnail,
    parsed.thumbnail_url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function extractTokenAttributes(parsed: MetadataJson): unknown[] | undefined {
  if (Array.isArray(parsed.attributes)) return parsed.attributes;
  if (Array.isArray(parsed.traits)) return parsed.traits;
  return undefined;
}

function addJsonFallback(candidates: string[], url: string) {
  const normalized = url.trim();
  if (!normalized) return;
  candidates.push(normalized);

  const lastSegment = normalized.split("/").filter(Boolean).pop() ?? "";
  if (!/\.[a-z0-9]+$/i.test(lastSegment)) {
    candidates.push(`${normalized}.json`);
  }
}

function getTokenMetadataCandidateUrls(baseUri: string, tokenId: number): string[] {
  const base = ipfsUriToHttp(baseUri).trim();
  if (!base) return [];

  const candidates: string[] = [];
  const trimmedBase = base.replace(/\/+$/, "");
  addJsonFallback(candidates, `${trimmedBase}/${tokenId}`);

  if (base.endsWith("/")) {
    addJsonFallback(candidates, `${base}${tokenId}`);
  } else {
    addJsonFallback(candidates, `${base}${tokenId}`);
  }

  return Array.from(new Set(candidates));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonFromCandidates(
  candidates: string[],
): Promise<{ url: string; json: MetadataJson } | null> {
  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) continue;

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.startsWith("image/")) continue;

      const text = await response.text();
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

      return { url: response.url || url, json: parsed as MetadataJson };
    } catch {
      continue;
    }
  }

  return null;
}

export async function validateNFTMetadataUris(input: {
  baseURI: string;
  contractURI: string;
}): Promise<NFTMetadataValidationResult> {
  const normalizedBaseURI = normalizeBaseURI(input.baseURI);
  const normalizedContractURI = normalizeContractURI(input.contractURI);

  if (!normalizedBaseURI) {
    return {
      ok: false,
      normalizedBaseURI,
      normalizedContractURI,
      message: "Base URI is invalid.",
    };
  }

  if (!normalizedContractURI) {
    return {
      ok: false,
      normalizedBaseURI,
      normalizedContractURI,
      message: "Contract URI is invalid.",
    };
  }

  const tokenMetadata = await fetchJsonFromCandidates(getTokenMetadataCandidateUrls(normalizedBaseURI, 1));
  if (!tokenMetadata) {
    return {
      ok: false,
      normalizedBaseURI,
      normalizedContractURI,
      message: "Base URI must resolve token #1 metadata JSON at `1` or `1.json`.",
    };
  }

  if (!extractMetadataImage(tokenMetadata.json)) {
    return {
      ok: false,
      normalizedBaseURI,
      normalizedContractURI,
      message: "Token #1 metadata must include an image field.",
    };
  }

  const contractMetadata = await fetchJsonFromCandidates(getContractMetadataCandidateUrls(normalizedContractURI));
  if (!contractMetadata) {
    return {
      ok: false,
      normalizedBaseURI,
      normalizedContractURI,
      message: "Contract URI must resolve collection metadata JSON.",
    };
  }

  const warnings: string[] = [];
  if (!extractMetadataImage(contractMetadata.json)) {
    warnings.push("Collection metadata JSON does not include an image field.");
  }
  if (!extractTokenAttributes(tokenMetadata.json)?.length) {
    warnings.push("Token #1 metadata has no attributes/traits array.");
  }

  return {
    ok: true,
    normalizedBaseURI,
    normalizedContractURI,
    tokenMetadataUrl: tokenMetadata.url,
    contractMetadataUrl: contractMetadata.url,
    warnings,
  };
}

