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

function parseTokenAddress(message: string) {
  return message.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0] ?? "";
}

function parseQuotedValue(message: string) {
  return message.match(/["']([^"']{2,120})["']/)?.[1]?.trim() ?? "";
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
  return (
    message.match(/(?:called|named|description(?: is)?|label(?: it)?)(?:\s+as)?\s+"?([A-Za-z0-9\s_-]{2,48})"?/i)?.[1]?.trim() ??
    ""
  );
}

function parseLooseShortText(message: string) {
  const quoted = parseQuotedValue(message);
  if (quoted) return quoted;

  const trimmed = message.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.length <= 64 &&
    !/\b0x[a-fA-F0-9]{40}\b/.test(trimmed) &&
    !/^\d+$/.test(trimmed) &&
    !/\bdays?\b/i.test(trimmed) &&
    !/^https?:\/\//i.test(trimmed) &&
    !/^ipfs:\/\//i.test(trimmed) &&
    !/^(hey|hi|hello|yo|sup|thanks|thank you|okay|ok)\b/i.test(trimmed) &&
    !/^(lock|vest|create|deploy|make|launch|buy|claim|airdrop|open|show|help)\b/i.test(trimmed)
  ) {
    return trimmed;
  }

  return "";
}

function parseNameAfterKind(message: string, kind: "token" | "nft") {
  const noun = kind === "token" ? "token" : "(?:nft|collection|drop)";
  return (
    message.match(new RegExp(`(?:${noun})\\s+(?:called|named)\\s+"?([A-Za-z0-9\\s_-]{2,48})"?`, "i"))?.[1]?.trim() ??
    message.match(/(?:called|named)\s+"?([A-Za-z0-9\s_-]{2,48})"?/i)?.[1]?.trim() ??
    parseLooseShortText(message)
  );
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

  if (/\bnon[-\s]?mintable\b|\bfixed\s+supply\b/.test(lower)) return "non_mintable";
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

function stripLeadingInterjections(lower: string) {
  return lower.replace(/^(?:hey|hi|hello|yo|sup|so|then|okay|ok|alright|please)[,!?\s]+/i, "").trim();
}

function looksActionable(message: string) {
  const raw = message.trim().toLowerCase();
  const lower = stripLeadingInterjections(raw);

  if (/^(how|what|where|when|why|is|are|do|does|did)\b/.test(lower)) return false;

  if (/^(can you|could you|would you|will you|help me|create|deploy|make|launch|lock|vest|airdrop|buy|contribute|open|take me|show me|navigate|set\s*up|setup)/i.test(lower)) {
    return true;
  }

  if (/\b(?:i\s+(?:want\s+to|need\s+to|would\s+like\s+to|wanna|gotta|am\s+trying\s+to|am\s+going\s+to)|i'?d\s+like\s+to|let'?s|let\s+me|gonna)\s+(?:create|deploy|make|launch|lock|vest|airdrop|open|set\s*up|setup)\b/i.test(lower)) {
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
  if (!input.initialSupply) missing.push("initialSupply");
  if (!input.tokenType) missing.push("tokenType");
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
    warnings: ["Token creation may be admin-restricted in the current Stage0 app."],
    missingFields: missing,
    nextSteps: [
      "Connect an EVM wallet on RISE Testnet",
      "Review the token details in Stage0",
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
    warnings: [
      "Base URI and collection image URI should be browser-readable after normalization.",
      "Review sale windows and wallet limits carefully before signing.",
    ],
    missingFields: missing,
    nextSteps: [
      "Connect an EVM wallet on RISE Testnet",
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
    warnings: [
      "Presale setup may be admin-restricted in the current Stage0 app.",
      "Sale schedules, caps, rates, and token addresses should be reviewed manually.",
    ],
    missingFields: [],
    nextSteps: [
      "Connect an EVM wallet on RISE Testnet",
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
  if (!input.name) missing.push("lock name");

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
    warnings: ["Token locker access may be admin-restricted in the current Stage0 app."],
    missingFields: missing,
    nextSteps: [
      "Connect an EVM wallet on RISE Testnet",
      "Approve the token transfer in the locker form",
      "Confirm the lock transaction",
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
    warnings: [
      "Airdrop access may be admin-restricted in the current Stage0 app.",
      "Double-check every recipient before signing. Airdrops are not reversible.",
    ],
    missingFields: missing,
    nextSteps: [
      "Connect an EVM wallet on RISE Testnet",
      "Add or review the recipient list",
      "Approve and sign the multisend transaction",
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

export function buildOpenRoute(route: string): ActionDraft {
  return ensure({
    actionType: "open_route",
    targetRoute: route,
    requiredWallet: null,
    requiredChain: null,
    prefill: {},
    summary: `Navigate to ${route}.`,
    warnings: route.startsWith("/admin") || route === "/domains" ? ["This route may be admin-restricted."] : [],
    missingFields: [],
    nextSteps: [`Open ${route} in the app.`],
  });
}

function mergeCreateToken(existing: ActionDraft, message: string) {
  const firstMissing = existing.missingFields[0];
  const tokenTypeStillMissing = existing.missingFields.includes("tokenType");
  const decimalsStillMissing = existing.missingFields.includes("decimals");

  let nextTokenType: string | undefined = tokenTypeStillMissing ? "" : existing.prefill.tokenType;
  if (tokenTypeStillMissing) {
    const parsed = parseTokenType(message);
    if (parsed) nextTokenType = parsed;
    else if (firstMissing === "tokenType" && isSkipResponse(message)) nextTokenType = "plain";
  }

  let nextDecimals: string | undefined = decimalsStillMissing ? "" : existing.prefill.decimals;
  if (decimalsStillMissing) {
    const parsed = parseDecimals(message);
    if (parsed) nextDecimals = parsed;
    else if (firstMissing === "decimals" && isSkipResponse(message)) nextDecimals = "18";
  }

  return buildCreateToken({
    name: existing.prefill.name || parseTokenName(message),
    symbol: existing.prefill.symbol || parseTokenSymbol(message),
    initialSupply: existing.prefill.initialSupply || parseSupply(message),
    decimals: nextDecimals || undefined,
    initialRecipient: existing.prefill.initialRecipient || parseTokenAddress(message),
    tokenType: nextTokenType || undefined,
    tokenImageURI: existing.prefill.tokenImageURI || parseCollectionImageUri(message),
  });
}

function mergeCreateNft(existing: ActionDraft, message: string) {
  const firstMissing = existing.missingFields[0];
  const dateLike = parseDateLike(message);

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
  const firstMissing = existing.missingFields[0];
  const shouldParseDuration = firstMissing === "durationDays" || /\bdays?\b/i.test(message);
  const parsedDuration = existing.prefill.duration || (shouldParseDuration ? parseDays(message) : "");
  const parsedName =
    firstMissing === "lock name"
      ? existing.prefill.name || parseExplicitLockName(message) || parseLooseShortText(message)
      : existing.prefill.name || parseExplicitLockName(message);

  return buildLockToken({
    tokenAddress: existing.prefill.token || parseTokenAddress(message),
    amount: existing.prefill.amount || parseAmount(message),
    durationDays: parsedDuration,
    name: parsedName,
    description: existing.prefill.description || parsedName,
  });
}

function mergeAirdrop(existing: ActionDraft, message: string) {
  return buildAirdrop({
    tokenAddress: existing.prefill.token || parseTokenAddress(message),
    recipientsData: existing.prefill.recipientsData || parseRecipientEntries(message),
    nativeToken: existing.prefill.nativeToken,
  });
}

export function canContinueActionDraft(existing: ActionDraft, message: string) {
  if (isCancel(message) || isGreeting(message)) return false;

  const firstMissing = existing.missingFields[0];
  if (!firstMissing) return false;

  if (existing.actionType === "lock_token") {
    if (firstMissing === "tokenAddress") return Boolean(parseTokenAddress(message));
    if (firstMissing === "amount") return Boolean(parseAmount(message));
    if (firstMissing === "durationDays") return Boolean(parseDays(message));
    if (firstMissing === "lock name") return Boolean(parseExplicitLockName(message) || parseLooseShortText(message));
  }

  if (existing.actionType === "create_token") {
    if (firstMissing === "name") return Boolean(parseTokenName(message));
    if (firstMissing === "symbol") return Boolean(parseTokenSymbol(message));
    if (firstMissing === "initialSupply") return Boolean(parseSupply(message));
    if (firstMissing === "tokenType") return Boolean(parseTokenType(message)) || isSkipResponse(message);
    if (firstMissing === "decimals") return Boolean(parseDecimals(message)) || isSkipResponse(message);
  }

  if (existing.actionType === "create_nft") {
    if (firstMissing === "name") return Boolean(parseCollectionName(message));
    if (firstMissing === "symbol") return Boolean(parseTokenSymbol(message));
    if (firstMissing === "baseURI") return Boolean(parseBaseUri(message) || parseUri(message, []));
    if (firstMissing === "collectionImageURI") return Boolean(parseCollectionImageUri(message) || parseUri(message, []));
    if (firstMissing === "maxSupply") return Boolean(parseSupply(message));
    if (firstMissing === "mintPrice") return Boolean(parseMintPrice(message));
    if (firstMissing === "saleStart" || firstMissing === "saleEnd") return Boolean(parseDateLike(message) || parseLooseShortText(message));
  }

  if (existing.actionType === "airdrop_tokens") {
    if (firstMissing === "tokenAddress") return Boolean(parseTokenAddress(message));
  }

  return false;
}

export function continueActionDraft(existing: ActionDraft, message: string): ActionDraft | null {
  if (!canContinueActionDraft(existing, message)) return null;

  if (existing.actionType === "lock_token") return mergeLockToken(existing, message);
  if (existing.actionType === "create_token") return mergeCreateToken(existing, message);
  if (existing.actionType === "create_nft") return mergeCreateNft(existing, message);
  if (existing.actionType === "airdrop_tokens") return mergeAirdrop(existing, message);

  return existing;
}

export function getActionFollowUp(draft: ActionDraft) {
  if (draft.actionType === "lock_token") {
    if (draft.missingFields.includes("tokenAddress")) return "Send me the ERC-20 token address first.";
    if (draft.missingFields.includes("amount")) return "How many tokens should I lock?";
    if (draft.missingFields.includes("durationDays")) return "How many days should the lock run?";
    if (draft.missingFields.includes("lock name")) return "Give the lock a short name or description, then I'll tee it up in the app.";
  }

  if (draft.actionType === "create_token") {
    if (draft.missingFields.includes("name")) return "What should the token name be?";
    if (draft.missingFields.includes("symbol")) return "What symbol should I use?";
    if (draft.missingFields.includes("initialSupply")) return "What total supply should I use? You can say a number or something like \"1 million\".";
    if (draft.missingFields.includes("tokenType")) {
      return [
        "What token type? Pick one:",
        "- plain - standard fixed supply",
        "- mintable - owner can mint more later",
        "- burnable - holders can burn tokens",
        "- non-mintable - fixed cap, no future minting",
        "",
        "Say \"plain\" if you're unsure.",
      ].join("\n");
    }
    if (draft.missingFields.includes("decimals")) return "How many decimals? 18 is the ERC-20 standard. Say a number, or \"default\" for 18.";
  }

  if (draft.actionType === "create_nft") {
    if (draft.missingFields.includes("name")) return "What should the NFT collection name be?";
    if (draft.missingFields.includes("symbol")) return "What collection symbol should I use?";
    if (draft.missingFields.includes("baseURI")) return "Send the base URI for token metadata. A CID, ipfs:// URI, or https:// URI is fine.";
    if (draft.missingFields.includes("collectionImageURI")) return "Send the collection image URI. A CID, ipfs:// URI, or https:// image link is fine.";
    if (draft.missingFields.includes("maxSupply")) return "What max supply should this collection have?";
    if (draft.missingFields.includes("mintPrice")) return "What public mint price in ETH should I use?";
    if (draft.missingFields.includes("saleStart")) return "When should public mint start? Use a clear date/time; the app will still need final review.";
    if (draft.missingFields.includes("saleEnd")) return "When should public mint end? Use a clear date/time; the app will still need final review.";
  }

  if (draft.actionType === "airdrop_tokens") {
    if (draft.missingFields.includes("tokenAddress")) return "Send me the ERC-20 token address you want to airdrop, or say native ETH if you mean RISE testnet ETH.";
  }

  return "I need one or two details before I can set that up in the app.";
}

export function getActionReadyReply(draft: ActionDraft) {
  if (draft.actionType === "lock_token") return "Lock details are ready. Review them in Stage0, then sign in your wallet.";
  if (draft.actionType === "create_token") return "Token setup is ready. Review it in Stage0, then sign in your wallet.";
  if (draft.actionType === "create_nft") return "NFT collection setup is ready. Review metadata, sale windows, and wallet limits in Stage0 before signing.";
  if (draft.actionType === "airdrop_tokens") return "Airdrop setup is ready. Review recipients carefully in Stage0 before signing.";
  if (draft.actionType === "create_presale") return "Presale setup opens in Stage0. Fill the final schedule, caps, and rates there before signing.";
  if (draft.actionType === "open_launchpad") return "Opening the Stage0 launchpad.";
  if (draft.actionType === "open_dashboard") return "Opening your Stage0 dashboard.";

  return "Done. I set that route up in the app.";
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
