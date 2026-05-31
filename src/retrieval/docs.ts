import { searchDocChunks, type RetrievedDocChunk } from "../db.js";

export interface RetrievalResult {
  chunks: RetrievedDocChunk[];
  citations: string[];
  isEmpty: boolean;
}

function normalizeQuery(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/(how|what|where|when|who|why|can|could|would|should|is|are|do|does|did|will|the|a|an)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function retrieveDocContext(query: string): Promise<RetrievalResult> {
  const normalized = normalizeQuery(query);

  if (normalized.length < 3) {
    return { chunks: [], citations: [], isEmpty: true };
  }

  let chunks: RetrievedDocChunk[] = [];

  try {
    chunks = await searchDocChunks(normalized, 6);
  } catch {
    return { chunks: [], citations: [], isEmpty: true };
  }

  if (chunks.length === 0) {
    return { chunks: [], citations: [], isEmpty: true };
  }

  const citations = [...new Set(chunks.map((chunk) => chunk.source_url))];
  return { chunks, citations, isEmpty: false };
}
