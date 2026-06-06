import type { ActionDraft, ActionType } from "./types.js";

const BLANK: ActionDraft = {
  actionType: "open_route",
  targetRoute: "",
  requiredWallet: null,
  requiredChain: null,
  prefill: {},
  summary: "",
  warnings: [],
  missingFields: [],
  nextSteps: [],
};

const CREATE_TOKEN_ROUTE = "/create/token";
const CREATE_NFT_ROUTE = "/create/nft";
const CREATE_PRESALE_ROUTE = "/create/presale";
const TOKEN_LOCKER_ROUTE = "/tools/token-locker";
const AIRDROP_ROUTE = "/tools/airdrop";
const DOMAINS_ROUTE = "/domains";
const LAUNCHPAD_ROUTE = "/presales";
const DASHBOARD_ROUTE = "/dashboard";
const TOOLS_ROUTE = "/tools";

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
};

const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
};

const WORD_MULTIPLIERS: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

function ensure(overrides: Partial<ActionDraft> & { actionType: ActionType }): ActionDraft {
  return { ...BLANK, ...overrides };
}

function withTokenQuery(route: string, tokenAddress?: string) {
  return tokenAddress ? `${route}?token=${encodeURIComponent(tokenAddress)}` : route;
}

function withNameQuery(route: string, name?: string) {
  return name ? `${route}?name=${encodeURIComponent(name)}` : route;
}

function parseTokenAddress(message: string) {
  return message.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0] ?? "";
}

function parseQuotedValue(message: string) {
  const doubleQuoted = message.match(/"([^"]{2,120})"/)?.[1]?.trim();
  if (doubleQuoted) return doubleQuoted;

  const singleQuoted = message.match(/(?:^|[\s:=([{])'([^']{2,120})'(?:$|[\s.,;:)\]}])/)?.[1]?.trim();
  return singleQuoted ?? "";
}

function cleanCapturedLabel(value: string) {
  return value
    .trim()
    .replace(
      /\s+\b(?:with|symbol|ticker|supply|amount|decimals?|mintable|burnable|taxable|plain|standard|non[-\s]?mintable|fixed\s+supply|base\s*uri|metadata|image|price|cost|starts?|ends?|sale)\b[\s\S]*$/i,
      "",
    )
    .trim()
    .replace(/[,.!?;:]+$/g, "")
    .trim();
}

function parseNamedPhrase(message: string) {
  const match =
    message.match(/(?:called|named|name(?:d)?\s+is|name\s*:|name\s*=)\s+"?([A-Za-z0-9][A-Za-z0-9\s_-]{1,80})"?/i)?.[1] ??
    "";
  return match ? cleanCapturedLabel(match) : "";
}

function parseQuantityFromText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "";

  const digitsOnly = cleaned.match(/^([\d,]+(?:\.\d+)?)$/);
  if (digitsOnly) return digitsOnly[1].replace(/,/g, "");

  const suffixMatch = cleaned.match(/^([\d,]+(?:\.\d+)?)\s*([kmbt])\b/i);
  if (suffixMatch) {
    const num = Number.parseFloat(suffixMatch[1].replace(/,/g, ""));
    const mult = SUFFIX_MULTIPLIERS[suffixMatch[2].toLowerCase()];
    if (Number.isFinite(num) && mult) return String(Math.round(num * mult));
  }

  const wordMatch = cleaned.match(/^([\d,]+(?:\.\d+)?)\s+(thousand|million|billion|trillion)s?\b/i);
  if (wordMatch) {
    const num = Number.parseFloat(wordMatch[1].replace(/,/g, ""));
    const mult = WORD_MULTIPLIERS[wordMatch[2].toLowerCase()];
    if (Number.isFinite(num) && mult) return String(Math.round(num * mult));
  }

  return "";
}

function parseAmount(message: string) {
  const sanitized = message.replace(/\b0x[a-fA-F0-9]{40}\b/g, " ");

  const verbMatch = sanitized.match(/\b(?:lock|vest|airdrop|send|amount|supply|sell|mint)\s+([\d,]+(?:\.\d+)?(?:\s*[kmbt]\b|\s+(?:thousand|million|billion|trillion)s?\b)?)/i)?.[1];
  if (verbMatch) {
    const result = parseQuantityFromText(verbMatch);
    if (result) return result;
  }

  const tokenMatch = sanitized.match(/\b([\d,]+(?:\.\d+)?(?:\s*[kmbt]\b|\s+(?:thousand|million|billion|trillion)s?\b)?)\s*(?:tokens?|nfts?|eth)\b/i)?.[1];
  if (tokenMatch) {
    const result = parseQuantityFromText(tokenMatch);
    if (result) return result;
  }

  return parseQuantityFromText(sanitized);
}

function parseWordNumber(message: string) {
  const words = message
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

  if (words.length === 0) return "";
  if (words.length > 3) return "";
  if (words.some((word) => !(word in NUMBER_WORDS))) return "";

  let total = 0;
  let current = 0;

  for (const word of words) {
    const value = NUMBER_WORDS[word];
    if (value === 100 || value === 1000) {
      current = Math.max(current, 1) * value;
    } else {
      current += value;
    }
  }

  total += current;
  return total > 0 ? String(total) : "";
}

function parseDays(message: string) {
  const digitMatch =
    message.match(/(?:for\s+)?(\d{1,5})\s*days?/i)?.[1] ??
    message.match(/^\s*(\d{1,5})\s*$/)?.[1];
  if (digitMatch) return digitMatch;

  const wordWithUnit = message.match(/(?:for\s+)?([a-z\s-]{2,30})\s+days?/i)?.[1];
  if (wordWithUnit) return parseWordNumber(wordWithUnit);

  return parseWordNumber(message.trim());
}

function parseExplicitLockName(message: string) {
  const match =
    message.match(/(?:description(?: is)?|label(?: it)?)(?:\s+as)?\s+"?([A-Za-z0-9][A-Za-z0-9\s_-]{1,80})"?/i)?.[1] ??
    parseNamedPhrase(message);
  return match ? cleanCapturedLabel(match) : "";
}

function parseLooseShortText(message: string) {
  const quoted = parseQuotedValue(message);
  if (quoted) return quoted;

  const trimmed = message.trim();
  if (
    /\b(?:symbol|ticker|supply|amount|decimals?|mintable|burnable|taxable|plain|standard|non[-\s]?mintable|fixed\s+supply|token\s*type|address|recipient|recipients|days?|duration|native|eth|base\s*uri|metadata|image|price|cost|starts?|ends?|sale)\b/i.test(trimmed)
  ) {
    return "";
  }

  if (
    /[.!?]/.test(trimmed) ||
    /\b(?:i'?m|i\s+am)\s+trying\b/i.test(trimmed) ||
    /\b(?:what\s+can\s+you\s+do|let'?s\s+say|for\s+example|suppose|imagine)\b/i.test(trimmed)
  ) {
    return "";
  }

  if (
    trimmed.length >= 2 &&
    trimmed.length <= 64 &&
    !/\b0x[a-fA-F0-9]{40}\b/.test(trimmed) &&
    !/^\d+$/.test(trimmed) &&
    !/\bdays?\b/i.test(trimmed) &&
    !/^https?:\/\//i.test(trimmed) &&
    !/^ipfs:\/\//i.test(trimmed) &&
    !/^(hey|hi|hello|yo|sup|thanks|thank you|okay|ok)\b/i.test(trimmed) &&
    !/^(lock|vest|create|deploy|make|launch|buy|claim|airdrop|open|show|help)\b/i.test(trimmed) &&
    !/\b(?:i\s+(?:want|need|would\s+like|wanna|am\s+trying)\s+to|let'?s|help\s+me|can\s+you|could\s+you)\s+(?:create|deploy|make|launch|lock|vest|airdrop|buy|register|grab|reserve|claim)\b/i.test(trimmed)
  ) {
    return trimmed;
  }

  return "";
}

function parseLabeledTextField(message: string, labels: string[]) {
  const labelPattern = labels.join("|");
  const patterns = [
    new RegExp(`\\b(?:change|update|set|use|make)\\s+(?:the\\s+)?(?:${labelPattern})\\s+(?:to|as)\\s+["']?([A-Za-z0-9][A-Za-z0-9\\s_-]{1,80})["']?`, "i"),
    new RegExp(`\\b(?:${labelPattern})\\s*(?:is|should\\s+be|=|:|to)\\s+["']?([A-Za-z0-9][A-Za-z0-9\\s_-]{1,80})["']?`, "i"),
  ];

  for (const pattern of patterns) {
    const value = message.match(pattern)?.[1] ?? "";
    if (value) return cleanCapturedLabel(value);
  }

  return "";
}

function parseLabeledSymbolField(message: string) {
  const patterns = [
    /\b(?:change|update|set|use|make)\s+(?:the\s+)?(?:symbol|ticker)\s+(?:to|as)\s+"?([A-Z0-9]{2,10})"?/i,
    /\b(?:symbol|ticker)\s*(?:is|should\s+be|=|:|to)?\s+"?([A-Z0-9]{2,10})"?/i,
  ];

  for (const pattern of patterns) {
    const value = message.match(pattern)?.[1]?.trim() ?? "";
    if (value) return value.toUpperCase();
  }

  return "";
}

function parseNameAfterKind(message: string, kind: "token" | "nft") {
  const noun = kind === "token" ? "token" : "(?:nft|collection|drop)";
  const kindNamed =
    message.match(new RegExp(`(?:${noun})\\s+(?:called|named)\\s+"?([A-Za-z0-9][A-Za-z0-9\\s_-]{1,80})"?`, "i"))?.[1] ??
    "";
  const named = kindNamed || parseNamedPhrase(message);
  return named ? cleanCapturedLabel(named) : parseLooseShortText(message);
}

function parseTokenName(message: string) {
  return parseNameAfterKind(message, "token");
}

function parseCollectionName(message: string) {
  return parseNameAfterKind(message, "nft");
}

function parseTokenSymbol(message: string) {
  return (
    message.match(/(?:symbol|ticker)(?:\s+is)?\s+"?([A-Z0-9]{2,10})"?/i)?.[1]?.trim() ??
    message.match(/^\s*([A-Z0-9]{2,10})\s*$/)?.[1]?.trim() ??
    ""
  );
}

function parseSupply(message: string) {
  const explicitMatch = message.match(/(?:supply|amount|mint|total|max supply)(?:\s+of)?\s+([\d,]+(?:\.\d+)?(?:\s*[kmbt]\b|\s+(?:thousand|million|billion|trillion)s?\b)?)/i)?.[1];
  if (explicitMatch) {
    const result = parseQuantityFromText(explicitMatch);
    if (result) return result;
  }

  return parseQuantityFromText(message);
}

function parseTokenType(message: string) {
  const lower = message.toLowerCase();

  if (/\bnon[-\s]?mintable\b|\bfixed\s+supply\b/.test(lower)) return "nonMintable";
  if (/\bburnable\b/.test(lower)) return "burnable";
  if (/\bmintable\b/.test(lower)) return "mintable";
  if (/\btax(?:able)?\b/.test(lower)) return "taxable";
  if (/\b(?:plain|standard|basic|simple|regular|normal|erc[-\s]?20|default)\b/.test(lower)) return "plain";

  return "";
}

function parseNftStandard(message: string) {
  const lower = message.toLowerCase();
  if (/\berc\s*-?\s*721a\b|\b721a\b/.test(lower)) return "erc721a";
  if (/\berc\s*-?\s*721\b|\b721\b/.test(lower)) return "erc721";
  return "";
}

function parseDecimals(message: string) {
  const standalone = message.trim().match(/^(\d{1,2})$/);
  if (standalone) {
    const n = Number.parseInt(standalone[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 77) return String(n);
  }

  const explicit =
    message.match(/(?:^|\s)(\d{1,2})\s*decimals?\b/i)?.[1] ??
    message.match(/\bdecimals?\s*(?:is\s+|of\s+|=\s*|:\s*)?(\d{1,2})\b/i)?.[1];
  if (explicit) {
    const n = Number.parseInt(explicit, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 77) return String(n);
  }

  return "";
}

function parseUri(message: string, labels: RegExp[]) {
  for (const label of labels) {
    const labeled = message.match(new RegExp(`${label.source}\\s*(?:is|=|:)?\\s*["']?([^"'\\s,]+)`, "i"))?.[1]?.trim();
    if (labeled) return labeled;
  }

  return (
    message.match(/\bipfs:\/\/[^\s"'<>]+/i)?.[0] ??
    message.match(/\bhttps?:\/\/[^\s"'<>]+/i)?.[0] ??
    message.match(/\b(?:bafy|Qm)[A-Za-z0-9]{20,}\b/)?.[0] ??
    ""
  );
}

function parseBaseUri(message: string) {
  return parseUri(message, [/\bbase\s*uri\b/i, /\bmetadata\s*uri\b/i, /\bmetadata\b/i]);
}

function parseCollectionImageUri(message: string) {
  return parseUri(message, [/\bcollection\s*image\s*uri\b/i, /\bimage\s*uri\b/i, /\bcover\s*image\b/i, /\bcontract\s*uri\b/i]);
}

function parseMintPrice(message: string) {
  const match =
    message.match(/(?:price|mint price|cost)(?:\s+is)?\s+(\d+(?:\.\d+)?)\s*(?:eth)?/i)?.[1] ??
    message.match(/\b(\d+(?:\.\d+)?)\s*eth\b/i)?.[1];
  return match ?? "";
}

function parseDateLike(message: string) {
  return (
    message.match(/\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2})?\b/)?.[0] ??
    message.match(/\b(?:today|tomorrow|next\s+\w+|in\s+\d+\s+(?:hours?|days?|weeks?))\b/i)?.[0] ??
    ""
  );
}

function isSkipResponse(message: string) {
  return /^(?:skip|default|standard|none|no\s+preference|not\s+sure|n\/?a|whatever|any|either|don'?t\s+care|idk|use\s+(?:the\s+)?default|use\s+18)\.?\s*$/i.test(
    message.trim(),
  );
}

function parseRecipientEntries(message: string) {
  const matches = [...message.matchAll(/\b(0x[a-fA-F0-9]{40})\b\s*[, ]\s*(\d{1,20}(?:[.,]\d+)?)/g)];
  if (matches.length === 0) return "";

  return matches
    .map((match) => `${match[1]},${match[2].replace(/,/g, "")}`)
    .join("\n");
}

function countRecipientEntries(entries: string) {
  return entries
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function parseRnsName(message: string): string {
  const quoted = parseQuotedValue(message);
  if (quoted && /^[a-z0-9_-]{3,32}$/i.test(quoted)) return quoted.toLowerCase();

  const dotted = message.match(/\b([a-z0-9_-]{3,32})\.rise\b/i)?.[1];
  if (dotted) return dotted.toLowerCase();

  const labeled =
    message.match(/(?:name|domain|rns)\s*(?:is|:|=)?\s*["']?([a-z0-9_-]{3,32})["']?/i)?.[1] ??
    message.match(/(?:called|named)\s+["']?([a-z0-9_-]{3,32})["']?/i)?.[1] ??
    message.match(/(?:buy|register|get|claim|grab|reserve)\s+(?:a\s+|the\s+)?(?:name|domain|rns)?\s*["']?([a-z0-9_-]{3,32})["']?/i)?.[1];
  if (labeled && /^[a-z0-9_-]{3,32}$/i.test(labeled)) return labeled.toLowerCase();

  // Lone short alphanumeric token after stopwords
  const trimmed = message.trim().replace(/[.!?]+$/, "");
  if (/^[a-z0-9_-]{3,32}$/i.test(trimmed)) {
    if (!/^(hey|hi|hello|yo|sup|thanks|thank|okay|ok|yes|no|nope|yeah|please|cancel|stop)$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return "";
}

function stripLeadingInterjections(lower: string) {
  return lower.replace(/^(?:hey|hi|hello|yo|sup|so|then|okay|ok|alright|please|uhh+|umm+|uhmm+|err+|hmm+)[,!?\s]+/i, "").trim();
}

function looksActionable(message: string) {
  const raw = message.trim().toLowerCase();
  const lower = stripLeadingInterjections(raw);

  if (/^(how|what|where|when|why|is|are|do|does|did)\b/.test(lower)) return false;

  if (/^(can you|could you|would you|will you|help me|create|deploy|make|launch|lock|vest|airdrop|buy|register|reserve|grab|claim|contribute|open|take me|show me|navigate|set\s*up|setup)/i.test(lower)) {
    return true;
  }

  if (/\b(?:i\s+(?:want\s+to|need\s+to|would\s+like\s+to|wanna|gotta|am\s+trying\s+to|am\s+going\s+to)|i'?d\s+like\s+to|let'?s|let\s+me|gonna)\s+(?:create|deploy|make|launch|lock|vest|airdrop|buy|register|grab|reserve|claim|open|set\s*up|setup)\b/i.test(lower)) {
    return true;
  }

  if (
    /\b(?:create|deploy|make|launch|lock|vest|airdrop|bulk\s+send|multi[-\s]?send|buy|register|grab|reserve|claim)\b/i.test(lower) &&
    (/\b(?:token|tokens|erc[-\s]?20|nft|collection|drop|domain|name|rns|airdrop|lock|presale|launch)\b/i.test(lower) ||
      /\b0x[a-fA-F0-9]{40}\b/.test(raw) ||
      /\.rise\b/i.test(raw))
  ) {
    return true;
  }

  return false;
}

function isGreeting(message: string) {
  return /^(hey|hi|hello|yo|sup)\b/i.test(message.trim());
}

function isCancel(message: string) {
  return /^(cancel|stop|never mind|nevermind|leave it|drop it)\b/i.test(message.trim());
}

export function detectQuickActionIntent(message: string): ActionType | null {
  const lower = stripLeadingInterjections(message.trim().toLowerCase());
  if (/^(how|what|where|when|why|is|are|do|does|did)\b/.test(lower)) return null;

  if (/(?:airdrop|bulk\s+send|multi[-\s]?send|send\s+tokens?\s+to\s+multiple)/i.test(lower)) {
    return "airdrop_tokens";
  }

  if (/(?:buy|register|get|claim|grab|reserve)\s+(?:a\s+|the\s+)?(?:name|domain|rns)/i.test(lower) || /\.rise\b/i.test(lower)) {
    return "buy_name";
  }

  if (/\b(lock|vest)\b/i.test(lower) && /\b(token|tokens|erc[-\s]?20|liquidity|supply)\b/i.test(lower)) {
    return "lock_token";
  }

  if (/(?:create|deploy|make|launch)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:erc[-\s]?20\s+)?token/i.test(lower)) {
    return "create_token";
  }

  return null;
}

export function detectPageOnlyActionIntent(message: string): { route: string; reply: string; summary: string } | null {
  const lower = stripLeadingInterjections(message.trim().toLowerCase());
  if (/^(how|what|where|when|why|is|are|do|does|did)\b/.test(lower)) return null;

  if (/(?:go\s+to|open|show|show\s+me|navigate|take\s+me\s+to)\s+(?:my\s+)?dashboard/i.test(lower)) {
    return {
      route: DASHBOARD_ROUTE,
      reply: "Opening your dashboard.",
      summary: "Open the Stage0 dashboard.",
    };
  }

  if (/(?:go\s+to|open|show|show\s+me|navigate|take\s+me\s+to)\s+(?:the\s+)?(?:launchpad|presales?)/i.test(lower)) {
    return {
      route: LAUNCHPAD_ROUTE,
      reply: "Opening the launchpad.",
      summary: "Open the Stage0 launchpad.",
    };
  }

  if (/(?:go\s+to|open|show|show\s+me|navigate|take\s+me\s+to)\s+(?:my\s+)?(?:nfts?|collectibles|portfolio)/i.test(lower)) {
    return {
      route: "/my-nfts",
      reply: "Opening your collectibles.",
      summary: "Open your NFT collectibles.",
    };
  }

  if (/(?:go\s+to|open|show|show\s+me|navigate|take\s+me\s+to)\s+(?:the\s+)?tools/i.test(lower)) {
    return {
      route: TOOLS_ROUTE,
      reply: "Opening tools.",
      summary: "Open Stage0 tools.",
    };
  }

  if (/(?:go\s+to|open|show|show\s+me|navigate|take\s+me\s+to)\s+(?:the\s+)?(?:domains|names)(?:\s+page)?/i.test(lower)) {
    return {
      route: DOMAINS_ROUTE,
      reply: "Opening names.",
      summary: "Open the names page.",
    };
  }

  if (/(?:create|deploy|make|launch|mint)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:nft|collection|drop)/i.test(lower)) {
    return {
      route: CREATE_NFT_ROUTE,
      reply: "NFT creation lives on the full form. I can take you there.",
      summary: "Open the NFT creation page.",
    };
  }

  if (/(?:create|start|launch|setup|set\s+up)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:presale|token\s+sale|sale)/i.test(lower)) {
    return {
      route: CREATE_PRESALE_ROUTE,
      reply: "Presale setup lives on the full form. I can take you there.",
      summary: "Open the presale creation page.",
    };
  }

  return null;
}

// --- Builders -----------------------------------------------------------------

export function buildCreateToken(input: {
  name?: string;
  symbol?: string;
  decimals?: string;
  initialSupply?: string;
  initialRecipient?: string;
  tokenType?: string;
  tokenImageURI?: string;
}): ActionDraft {
  const missing: string[] = [];
  if (!input.name) missing.push("name");
  if (!input.symbol) missing.push("symbol");
  if (!input.tokenType) missing.push("tokenType");
  if (!input.initialSupply) missing.push("initialSupply");
  if (!input.decimals) missing.push("decimals");

  return ensure({
    actionType: "create_token",
    targetRoute: CREATE_TOKEN_ROUTE,
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {
      name: input.name || "",
      symbol: input.symbol || "",
      decimals: input.decimals || "18",
      initialSupply: input.initialSupply || "",
      initialRecipient: input.initialRecipient || "",
      tokenType: input.tokenType || "plain",
      tokenImageURI: input.tokenImageURI || "",
    },
    summary: `Create "${input.name || "..."}" (${input.symbol || "..."}) on RISE Testnet.`,
    warnings: [],
    missingFields: missing,
    nextSteps: [
      "Review the token details in Senna",
      "Sign the deployment transaction in your wallet",
    ],
  });
}

export function buildCreateNft(input: {
  name?: string;
  symbol?: string;
  standard?: string;
  baseURI?: string;
  collectionImageURI?: string;
  maxSupply?: string;
  walletLimit?: string;
  payoutWallet?: string;
  mintPrice?: string;
  saleStart?: string;
  saleEnd?: string;
}): ActionDraft {
  const missing: string[] = [];
  if (!input.name) missing.push("name");
  if (!input.symbol) missing.push("symbol");
  if (!input.baseURI) missing.push("baseURI");
  if (!input.collectionImageURI) missing.push("collectionImageURI");
  if (!input.maxSupply) missing.push("maxSupply");
  if (!input.mintPrice) missing.push("mintPrice");
  if (!input.saleStart) missing.push("saleStart");
  if (!input.saleEnd) missing.push("saleEnd");

  return ensure({
    actionType: "create_nft",
    targetRoute: CREATE_NFT_ROUTE,
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {
      mode: input.standard || "erc721",
      name: input.name || "",
      symbol: input.symbol || "",
      baseURI: input.baseURI || "",
      collectionImageURI: input.collectionImageURI || "",
      maxSupply: input.maxSupply || "",
      walletLimit: input.walletLimit || "",
      payoutWallet: input.payoutWallet || "",
      mintPrice: input.mintPrice || "",
      saleStart: input.saleStart || "",
      saleEnd: input.saleEnd || "",
    },
    summary: `Create NFT collection "${input.name || "..."}" (${input.symbol || "..."}) on RISE Testnet.`,
    warnings: [],
    missingFields: missing,
    nextSteps: [
      "Review collection metadata and sale phases",
      "Sign the deployment transaction in your wallet",
    ],
  });
}

export function buildCreatePresale(input: { saleToken?: string }): ActionDraft {
  return ensure({
    actionType: "create_presale",
    targetRoute: CREATE_PRESALE_ROUTE,
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {
      saleToken: input.saleToken || "",
    },
    summary: input.saleToken
      ? `Open presale setup for ${input.saleToken.slice(0, 8)}...`
      : "Open the Stage0 presale setup page.",
    warnings: [],
    missingFields: [],
    nextSteps: [
      "Fill sale schedule, caps, and token details",
      "Review carefully, then sign in the app",
    ],
  });
}

export function buildLockToken(input: {
  tokenAddress?: string;
  amount?: string;
  durationDays?: string;
  name?: string;
  description?: string;
}): ActionDraft {
  const missing: string[] = [];
  if (!input.tokenAddress) missing.push("tokenAddress");
  if (!input.amount) missing.push("amount");
  if (!input.durationDays) missing.push("durationDays");
  if (!input.name) missing.push("lockName");

  return ensure({
    actionType: "lock_token",
    targetRoute: withTokenQuery(TOKEN_LOCKER_ROUTE, input.tokenAddress),
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {
      token: input.tokenAddress || "",
      amount: input.amount || "",
      duration: input.durationDays || "",
      name: input.name || "",
      description: input.description || input.name || "",
    },
    summary: `Lock ${input.amount || "..."} tokens for ${input.durationDays || "..."} days${input.name ? ` (${input.name})` : ""}.`,
    warnings: [],
    missingFields: missing,
    nextSteps: [
      "Approve the token transfer",
      "Sign the lock transaction",
    ],
  });
}

export function buildAirdrop(input: {
  tokenAddress?: string;
  recipientsData?: string;
  nativeToken?: string;
}): ActionDraft {
  const isNative = input.nativeToken === "true";
  const missing: string[] = [];
  if (!isNative && !input.tokenAddress) missing.push("tokenAddress");
  if (!input.recipientsData || countRecipientEntries(input.recipientsData) === 0) {
    missing.push("recipientsData");
  }
  const recipientCount = countRecipientEntries(input.recipientsData || "");

  return ensure({
    actionType: "airdrop_tokens",
    targetRoute: withTokenQuery(AIRDROP_ROUTE, input.tokenAddress),
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {
      token: input.tokenAddress || "",
      recipientsData: input.recipientsData || "",
      nativeToken: isNative ? "true" : "false",
    },
    summary: `Airdrop ${isNative ? "native ETH" : "tokens"}${input.tokenAddress ? ` from ${input.tokenAddress.slice(0, 8)}...` : ""}${recipientCount > 0 ? ` to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}` : ""}.`,
    warnings: [],
    missingFields: missing,
    nextSteps: [
      isNative ? "Sign the bulk send transaction" : "Approve the token transfer, then sign the bulk send",
    ],
  });
}

export function buildBuyName(input: { name?: string }): ActionDraft {
  const missing: string[] = [];
  if (!input.name) missing.push("name");

  return ensure({
    actionType: "buy_name",
    targetRoute: withNameQuery(DOMAINS_ROUTE, input.name),
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {
      name: input.name || "",
    },
    summary: input.name ? `Register "${input.name}.rise" for 1 year.` : "Register a .rise name for 1 year.",
    warnings: [],
    missingFields: missing,
    nextSteps: [
      "Approve the RNS registry once (if first time)",
      "Sign the register transaction in your wallet",
    ],
  });
}

export function buildOpenLaunchpad(): ActionDraft {
  return ensure({
    actionType: "open_launchpad",
    targetRoute: LAUNCHPAD_ROUTE,
    requiredWallet: null,
    requiredChain: null,
    prefill: {},
    summary: "Open the Stage0 launchpad.",
    warnings: [],
    missingFields: [],
    nextSteps: ["Open /presales in the app."],
  });
}

export function buildOpenDashboard(): ActionDraft {
  return ensure({
    actionType: "open_dashboard",
    targetRoute: DASHBOARD_ROUTE,
    requiredWallet: "evm",
    requiredChain: "rise_testnet",
    prefill: {},
    summary: "Open the Stage0 dashboard.",
    warnings: [],
    missingFields: [],
    nextSteps: ["Connect an EVM wallet, then open /dashboard."],
  });
}

export function buildOpenRoute(route: string, summary?: string): ActionDraft {
  return ensure({
    actionType: "open_route",
    targetRoute: route,
    requiredWallet: null,
    requiredChain: null,
    prefill: {},
    summary: summary ?? `Navigate to ${route}.`,
    warnings: [],
    missingFields: [],
    nextSteps: [`Open ${route} in the app.`],
  });
}

// --- Order-agnostic merge helpers ---------------------------------------------

function mergeCreateToken(existing: ActionDraft, message: string) {
  const nextName = existing.prefill.name || parseTokenName(message);
  const nextSymbol = existing.prefill.symbol || parseTokenSymbol(message);
  const nextSupply = existing.prefill.initialSupply || parseSupply(message);

  const tokenTypeStillMissing = existing.missingFields.includes("tokenType");
  let nextTokenType = tokenTypeStillMissing ? "" : existing.prefill.tokenType;
  if (!nextTokenType || tokenTypeStillMissing) {
    const parsed = parseTokenType(message);
    if (parsed) nextTokenType = parsed;
    else if (isSkipResponse(message) && existing.missingFields[0] === "tokenType") nextTokenType = "plain";
  }

  let nextDecimals = existing.prefill.decimals && existing.prefill.decimals !== "18" ? existing.prefill.decimals : "";
  if (!existing.missingFields.includes("decimals") && existing.prefill.decimals) nextDecimals = existing.prefill.decimals;
  if (!nextDecimals || existing.missingFields.includes("decimals")) {
    const parsed = parseDecimals(message);
    if (parsed) nextDecimals = parsed;
    else if (isSkipResponse(message) && existing.missingFields[0] === "decimals") nextDecimals = "18";
  }

  return buildCreateToken({
    name: nextName,
    symbol: nextSymbol,
    initialSupply: nextSupply,
    decimals: nextDecimals || undefined,
    initialRecipient: existing.prefill.initialRecipient || parseTokenAddress(message),
    tokenType: nextTokenType || undefined,
    tokenImageURI: existing.prefill.tokenImageURI || parseCollectionImageUri(message),
  });
}

function mergeCreateNft(existing: ActionDraft, message: string) {
  const dateLike = parseDateLike(message);
  const firstMissing = existing.missingFields[0];

  return buildCreateNft({
    name: existing.prefill.name || parseCollectionName(message),
    symbol: existing.prefill.symbol || parseTokenSymbol(message),
    standard: existing.prefill.mode || parseNftStandard(message) || "erc721",
    baseURI: existing.prefill.baseURI || parseBaseUri(message),
    collectionImageURI: existing.prefill.collectionImageURI || parseCollectionImageUri(message),
    maxSupply: existing.prefill.maxSupply || parseSupply(message),
    walletLimit: existing.prefill.walletLimit || "",
    payoutWallet: existing.prefill.payoutWallet || parseTokenAddress(message),
    mintPrice: existing.prefill.mintPrice || parseMintPrice(message),
    saleStart: existing.prefill.saleStart || (firstMissing === "saleStart" ? dateLike : ""),
    saleEnd: existing.prefill.saleEnd || (firstMissing === "saleEnd" ? dateLike : ""),
  });
}

function mergeLockToken(existing: ActionDraft, message: string) {
  const parsedDuration = existing.prefill.duration || parseDays(message);
  const parsedName =
    existing.prefill.name ||
    parseExplicitLockName(message) ||
    (existing.missingFields[0] === "lockName" ? parseLooseShortText(message) : "");

  return buildLockToken({
    tokenAddress: existing.prefill.token || parseTokenAddress(message),
    amount: existing.prefill.amount || parseAmount(message),
    durationDays: parsedDuration,
    name: parsedName,
    description: existing.prefill.description || parsedName,
  });
}

function mergeAirdrop(existing: ActionDraft, message: string) {
  const isNative = existing.prefill.nativeToken === "true" || /\bnative\b|\beth\b/i.test(message);
  return buildAirdrop({
    tokenAddress: existing.prefill.token || (isNative ? "" : parseTokenAddress(message)),
    recipientsData: existing.prefill.recipientsData || parseRecipientEntries(message),
    nativeToken: isNative ? "true" : existing.prefill.nativeToken,
  });
}

function mergeBuyName(existing: ActionDraft, message: string) {
  return buildBuyName({
    name: existing.prefill.name || parseRnsName(message),
  });
}

function updateCreateTokenDraft(existing: ActionDraft, message: string) {
  const next = { ...existing.prefill };
  let changed = false;

  const name = parseLabeledTextField(message, ["token\\s+name", "name"]) || parseNamedPhrase(message);
  if (name) {
    next.name = name;
    changed = true;
  }

  const symbol = parseLabeledSymbolField(message);
  if (symbol) {
    next.symbol = symbol;
    changed = true;
  }

  if (/\b(?:supply|amount|mint|total|max\s+supply)\b/i.test(message)) {
    const supply = parseSupply(message);
    if (supply) {
      next.initialSupply = supply;
      changed = true;
    }
  }

  if (/\bdecimals?\b/i.test(message) || /^\s*\d{1,2}\s*$/.test(message)) {
    const decimals = parseDecimals(message);
    if (decimals) {
      next.decimals = decimals;
      changed = true;
    }
  }

  if (/\b(?:token\s*)?type\b/i.test(message) || /\b(?:plain|standard|basic|simple|regular|normal|mintable|burnable|taxable|non[-\s]?mintable|fixed\s+supply)\b/i.test(message)) {
    const tokenType = parseTokenType(message);
    if (tokenType) {
      next.tokenType = tokenType;
      changed = true;
    }
  }

  if (/\bimage\b/i.test(message)) {
    const tokenImageURI = parseCollectionImageUri(message);
    if (tokenImageURI) {
      next.tokenImageURI = tokenImageURI;
      changed = true;
    }
  }

  if (!changed) return null;

  return buildCreateToken({
    name: next.name,
    symbol: next.symbol,
    initialSupply: next.initialSupply,
    decimals: next.decimals,
    initialRecipient: next.initialRecipient,
    tokenType: next.tokenType,
    tokenImageURI: next.tokenImageURI,
  });
}

function updateLockTokenDraft(existing: ActionDraft, message: string) {
  const next = { ...existing.prefill };
  let changed = false;

  const tokenAddress = parseTokenAddress(message);
  if (tokenAddress) {
    next.token = tokenAddress;
    changed = true;
  }

  if (/\b(?:amount|lock|vest)\b/i.test(message)) {
    const amount = parseAmount(message);
    if (amount) {
      next.amount = amount;
      changed = true;
    }
  }

  if (/\b(?:days?|duration)\b/i.test(message)) {
    const duration = parseDays(message);
    if (duration) {
      next.duration = duration;
      changed = true;
    }
  }

  const name = parseExplicitLockName(message);
  if (name) {
    next.name = name;
    next.description = next.description || name;
    changed = true;
  }

  if (!changed) return null;

  return buildLockToken({
    tokenAddress: next.token,
    amount: next.amount,
    durationDays: next.duration,
    name: next.name,
    description: next.description,
  });
}

function updateAirdropDraft(existing: ActionDraft, message: string) {
  const next = { ...existing.prefill };
  let changed = false;

  if (/\bnative\b|\beth\b/i.test(message)) {
    next.nativeToken = "true";
    next.token = "";
    changed = true;
  }

  const tokenAddress = parseTokenAddress(message);
  if (tokenAddress && !/\brecipient/i.test(message)) {
    next.token = tokenAddress;
    next.nativeToken = "false";
    changed = true;
  }

  const recipientsData = parseRecipientEntries(message);
  if (recipientsData) {
    next.recipientsData = recipientsData;
    changed = true;
  }

  if (!changed) return null;

  return buildAirdrop({
    tokenAddress: next.token,
    recipientsData: next.recipientsData,
    nativeToken: next.nativeToken,
  });
}

function updateBuyNameDraft(existing: ActionDraft, message: string) {
  const name = parseRnsName(message);
  if (!name || name === existing.prefill.name) return null;
  return buildBuyName({ name });
}

export function canContinueActionDraft(existing: ActionDraft, message: string) {
  if (isCancel(message) || isGreeting(message)) return false;
  if (existing.missingFields.length === 0) return false;

  // Order-agnostic: any parser that lands a value, anywhere, can advance the draft.
  if (existing.actionType === "lock_token") {
    return (
      Boolean(parseTokenAddress(message)) ||
      Boolean(parseAmount(message)) ||
      Boolean(parseDays(message)) ||
      Boolean(parseExplicitLockName(message)) ||
      (existing.missingFields[0] === "lockName" && Boolean(parseLooseShortText(message)))
    );
  }

  if (existing.actionType === "create_token") {
    return (
      Boolean(parseTokenName(message)) ||
      Boolean(parseTokenSymbol(message)) ||
      Boolean(parseSupply(message)) ||
      Boolean(parseTokenType(message)) ||
      Boolean(parseDecimals(message)) ||
      isSkipResponse(message)
    );
  }

  if (existing.actionType === "create_nft") {
    return (
      Boolean(parseCollectionName(message)) ||
      Boolean(parseTokenSymbol(message)) ||
      Boolean(parseBaseUri(message) || parseUri(message, [])) ||
      Boolean(parseCollectionImageUri(message) || parseUri(message, [])) ||
      Boolean(parseSupply(message)) ||
      Boolean(parseMintPrice(message)) ||
      Boolean(parseDateLike(message))
    );
  }

  if (existing.actionType === "airdrop_tokens") {
    return (
      Boolean(parseTokenAddress(message)) ||
      Boolean(parseRecipientEntries(message)) ||
      /\bnative\b|\beth\b/i.test(message)
    );
  }

  if (existing.actionType === "buy_name") {
    return Boolean(parseRnsName(message));
  }

  return false;
}

export function continueActionDraft(existing: ActionDraft, message: string): ActionDraft | null {
  if (!canContinueActionDraft(existing, message)) return null;

  if (existing.actionType === "lock_token") return mergeLockToken(existing, message);
  if (existing.actionType === "create_token") return mergeCreateToken(existing, message);
  if (existing.actionType === "create_nft") return mergeCreateNft(existing, message);
  if (existing.actionType === "airdrop_tokens") return mergeAirdrop(existing, message);
  if (existing.actionType === "buy_name") return mergeBuyName(existing, message);

  return existing;
}

export function updateCompletedActionDraft(existing: ActionDraft, message: string): ActionDraft | null {
  if (isCancel(message) || isGreeting(message)) return null;
  if (existing.missingFields.length > 0) return null;

  if (existing.actionType === "create_token") return updateCreateTokenDraft(existing, message);
  if (existing.actionType === "lock_token") return updateLockTokenDraft(existing, message);
  if (existing.actionType === "airdrop_tokens") return updateAirdropDraft(existing, message);
  if (existing.actionType === "buy_name") return updateBuyNameDraft(existing, message);

  return null;
}

export function getActionFollowUp(draft: ActionDraft) {
  if (draft.actionType === "lock_token") {
    if (draft.missingFields.includes("tokenAddress")) return "Got it. What's the ERC-20 token address?";
    if (draft.missingFields.includes("amount")) return "How many tokens should we lock?";
    if (draft.missingFields.includes("durationDays")) return "Lock for how many days?";
    if (draft.missingFields.includes("lockName")) return "Give the lock a short name (something like 'Liquidity Lock').";
  }

  if (draft.actionType === "create_token") {
    if (draft.missingFields.includes("name")) return "What should the token be called?";
    if (draft.missingFields.includes("symbol")) return "What ticker symbol? (2-10 chars, like RISE.)";
    if (draft.missingFields.includes("tokenType")) {
      return [
        "What type of token?",
        "",
        "- Plain: standard fixed supply",
        "- Mintable: owner can mint more later",
        "- Burnable: holders can burn",
        "- Taxable: auto-tax on transfers",
        "- Non-mintable: fixed cap, no future mint",
        "",
        "If unsure, say plain.",
      ].join("\n");
    }
    if (draft.missingFields.includes("initialSupply")) return "What initial supply? You can say a number or '1 million'.";
    if (draft.missingFields.includes("decimals")) return "How many decimals? 18 is standard; say 'default' to use that.";
  }

  if (draft.actionType === "create_nft") {
    if (draft.missingFields.includes("name")) return "What should the NFT collection be called?";
    if (draft.missingFields.includes("symbol")) return "What collection symbol?";
    if (draft.missingFields.includes("baseURI")) return "What's the base URI for metadata? (CID, ipfs://, or https:// works.)";
    if (draft.missingFields.includes("collectionImageURI")) return "What's the collection image URI?";
    if (draft.missingFields.includes("maxSupply")) return "Max supply?";
    if (draft.missingFields.includes("mintPrice")) return "Public mint price in ETH?";
    if (draft.missingFields.includes("saleStart")) return "When should public mint start?";
    if (draft.missingFields.includes("saleEnd")) return "When should public mint end?";
  }

  if (draft.actionType === "airdrop_tokens") {
    if (draft.missingFields.includes("tokenAddress")) return "What ERC-20 token are we airdropping? Send the address, or say 'native ETH'.";
    if (draft.missingFields.includes("recipientsData")) return "Paste recipients, one per line as `0xaddress,amount`.";
  }

  if (draft.actionType === "buy_name") {
    if (draft.missingFields.includes("name")) return "What name do you want to grab? (Letters, numbers, hyphens or underscores, 3-32 chars.)";
  }

  return "Almost there. One more detail before we're set.";
}

export function getActionReadyReply(draft: ActionDraft) {
  if (draft.actionType === "lock_token") return "Lock is ready to sign. Review the details and sign in the chat.";
  if (draft.actionType === "create_token") return "Token is ready to sign. Take a look and sign below.";
  if (draft.actionType === "create_nft") return "NFT collection is ready. Review metadata and sale windows before signing.";
  if (draft.actionType === "airdrop_tokens") return "Airdrop is ready. Double-check recipients, then sign.";
  if (draft.actionType === "buy_name") return "Name is ready to register. Sign below to claim it for 1 year.";
  if (draft.actionType === "create_presale") return "Presale setup is staged. Open it in Stage0 to finish.";
  if (draft.actionType === "open_launchpad") return "Opening the Stage0 launchpad.";
  if (draft.actionType === "open_dashboard") return "Opening your Stage0 dashboard.";

  return "Done. Action ready below.";
}

export function classifyAndBuildAction(message: string): ActionDraft | null {
  const lower = message.toLowerCase();

  if (!looksActionable(message)) return null;

  if (/(?:create|deploy|make|launch)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:erc[-\s]?20\s+)?token/i.test(lower)) {
    return buildCreateToken({
      name: parseTokenName(message),
      symbol: parseTokenSymbol(message),
      initialSupply: parseSupply(message),
      tokenType: parseTokenType(message) || undefined,
      decimals: parseDecimals(message) || undefined,
      tokenImageURI: parseCollectionImageUri(message),
    });
  }

  if (/(?:create|deploy|make|launch|mint)\s+(?:(?:a|an)\s+)?(?:new\s+)?(?:nft|collection|drop)/i.test(lower)) {
    return buildCreateNft({
      name: parseCollectionName(message),
      symbol: parseTokenSymbol(message),
      standard: parseNftStandard(message) || undefined,
      baseURI: parseBaseUri(message),
      collectionImageURI: parseCollectionImageUri(message),
      maxSupply: parseSupply(message),
      mintPrice: parseMintPrice(message),
      payoutWallet: parseTokenAddress(message),
    });
  }

  if (/(?:create|start|launch|setup|set\s+up)\s+(?:(?:a|an)\s+)?(?:new\s+)?presale/i.test(lower)) {
    return buildCreatePresale({ saleToken: parseTokenAddress(message) });
  }

  if (/\b(lock|vest)\b/i.test(lower) && (/\b(token|tokens|erc[-\s]?20)\b/i.test(lower) || /\b0x[a-fA-F0-9]{40}\b/.test(message))) {
    return buildLockToken({
      tokenAddress: parseTokenAddress(message),
      amount: parseAmount(message),
      durationDays: parseDays(message),
      name: parseExplicitLockName(message),
    });
  }

  if (/(?:airdrop|bulk\s+send|multi[-\s]?send|send\s+tokens?\s+to\s+multiple)/i.test(lower)) {
    return buildAirdrop({
      tokenAddress: parseTokenAddress(message),
      recipientsData: parseRecipientEntries(message),
      nativeToken: /\bnative\b|\beth\b/i.test(lower) && !parseTokenAddress(message) ? "true" : "false",
    });
  }

  if (/(?:buy|register|get|claim|grab|reserve)\s+(?:a\s+|the\s+)?(?:name|domain|rns)/i.test(lower) || /\.rise\b/i.test(lower)) {
    return buildBuyName({ name: parseRnsName(message) });
  }

  if (/(?:go\s+to|open|show|navigate|take\s+me\s+to)\s+(?:the\s+)?(?:launchpad|presales?)/i.test(lower)) {
    return buildOpenLaunchpad();
  }

  if (/(?:go\s+to|open|show|navigate|take\s+me\s+to)\s+(?:my\s+)?dashboard/i.test(lower)) {
    return buildOpenDashboard();
  }

  if (/(?:go\s+to|open|show|navigate|take\s+me\s+to)\s+(?:the\s+)?tools/i.test(lower)) {
    return buildOpenRoute(TOOLS_ROUTE);
  }

  if (/(?:go\s+to|open|show|navigate|take\s+me\s+to)\s+\/(dashboard|admin|presales|nfts|tools|domains|tokens|my-nfts|create)/i.test(lower)) {
    const routeMatch = message.match(/\/(dashboard\S*|admin\S*|presales\S*|nfts\S*|tools\S*|domains\S*|tokens\S*|my-nfts\S*|create\S*)/i);
    if (routeMatch) return buildOpenRoute(routeMatch[0]);
  }

  return null;
}

/**
 * Build an empty draft for a known quick action, so the chat can immediately start asking
 * for the first missing field without any free-text classification.
 */
export function startQuickAction(actionType: ActionType): ActionDraft | null {
  switch (actionType) {
    case "create_token":
      return buildCreateToken({});
    case "lock_token":
      return buildLockToken({});
    case "airdrop_tokens":
      return buildAirdrop({ nativeToken: "false" });
    case "buy_name":
      return buildBuyName({});
    case "create_nft":
      return buildCreateNft({});
    case "create_presale":
      return buildCreatePresale({});
    case "open_launchpad":
      return buildOpenLaunchpad();
    case "open_dashboard":
      return buildOpenDashboard();
    default:
      return null;
  }
}

/**
 * Returns a short list of chip-style suggestions for the *current* missing field on a draft.
 * Used to populate the floating suggestion bubbles when the user is mid-flow.
 */
export function suggestForDraftField(draft: ActionDraft): string[] {
  const first = draft.missingFields[0];
  if (!first) return [];

  if (draft.actionType === "create_token") {
    if (first === "tokenType") return ["Plain", "Mintable", "Burnable"];
    if (first === "decimals") return ["18", "9", "6"];
    if (first === "initialSupply") return ["1,000,000", "100,000,000", "1,000,000,000"];
  }

  if (draft.actionType === "lock_token") {
    if (first === "durationDays") return ["30 days", "90 days", "365 days"];
  }

  if (draft.actionType === "airdrop_tokens") {
    if (first === "tokenAddress") return ["Native ETH"];
  }

  return [];
}
