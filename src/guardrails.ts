const DOCS_URL = "https://stagezerolabs.gitbook.io/stage0";
const APP_URL = "https://stage0.xyz";
const RISE_DOCS_URL = "https://docs.risechain.com/docs";

type GuardCategory =
  | "secrets"
  | "internals"
  | "ownership"
  | "off_topic"
  | "politics"
  | "scam";

interface InputRule {
  category: GuardCategory;
  pattern: RegExp;
}

const blockedInputRules: InputRule[] = [
  { category: "secrets", pattern: /seed\s*phrase/i },
  { category: "secrets", pattern: /mnemonic/i },
  { category: "secrets", pattern: /private\s*key/i },
  { category: "secrets", pattern: /keystore/i },
  { category: "secrets", pattern: /api\s*key/i },
  { category: "secrets", pattern: /access\s*token/i },
  { category: "secrets", pattern: /personal\s+access\s+token/i },
  { category: "secrets", pattern: /\b\.env\b/i },
  { category: "secrets", pattern: /credentials?/i },
  { category: "internals", pattern: /source\s*code/i },
  { category: "internals", pattern: /codebase/i },
  { category: "internals", pattern: /\brepo(sitory)?\b/i },
  { category: "internals", pattern: /github/i },
  { category: "internals", pattern: /gitlab/i },
  { category: "internals", pattern: /reveal\s+(?:your|the)\s+(?:prompt|system\s+prompt|instructions?|secret)/i },
  { category: "internals", pattern: /hidden\s+(?:prompts?|instructions?|rules?)/i },
  { category: "internals", pattern: /what\s+(?:are|were)\s+your\s+(?:instructions?|prompts?)/i },
  { category: "internals", pattern: /\bwhat\s+(?:llm|model|ai)\s+(?:are\s+you|do\s+you\s+use|powers?)/i },
  { category: "ownership", pattern: /\b(owner|founder|dev|developer|team)\b.*\b(who|name|identity|identit(y|ies)|doxx|reveal|home)\b/i },
  { category: "ownership", pattern: /\bwho\s+(?:runs|owns|built|controls)\b/i },
  { category: "ownership", pattern: /\bwho\s+is\s+behind\b/i },
  { category: "politics", pattern: /\b(politics?|election|president|prime minister|senate|campaign|party politics?)\b/i },
  { category: "scam", pattern: /\b(scam|rug|rugpull|fake|legit|legitimate)\b/i },
];

const offTopicHintRules: RegExp[] = [
  /\b(weather|recipe|football|soccer|nba|nfl|movie|dating|horoscope|essay|homework|translate this|joke|song lyrics?|capital of)\b/i,
];

const stage0ScopeHints = [
  /\bstage\s*0\b/i,
  /\bstage0\b/i,
  /\brise\b/i,
  /\brise testnet\b/i,
  /\blaunchpad\b/i,
  /\bpresale\b/i,
  /\bnft\b/i,
  /\berc[-\s]?721a?\b/i,
  /\berc[-\s]?20\b/i,
  /\btoken\b/i,
  /\bwallet\b/i,
  /\bmetamask\b/i,
  /\brainbow\b/i,
  /\bwalletconnect\b/i,
  /\bcoinbase wallet\b/i,
  /\block(er|ing)?\b/i,
  /\bairdrop\b/i,
  /\bmulti[-\s]?send\b/i,
  /\bdomain|names?\b/i,
  /\bdashboard\b/i,
  /\badmin\b/i,
  /\bexplorer\b/i,
  /\btransaction\b/i,
  /\btx\b/i,
];

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  code?: string;
  category?: GuardCategory;
  isOffTopic?: boolean;
}

function productRedirect() {
  return `I'm here for Stage0 product questions, but I won't get into private identities. Check the app (${APP_URL}), docs (${DOCS_URL}), or RISE explorer for public facts.`;
}

function handleHardBlock(category: GuardCategory): GuardrailResult {
  switch (category) {
    case "secrets":
      return {
        allowed: false,
        code: "blocked_secrets",
        category,
        reason: "I can't help with seed phrases, private keys, keystores, env files, or anything that exposes private access. Wallet control stays with you.",
      };
    case "internals":
      return {
        allowed: false,
        code: "blocked_internals",
        category,
        reason: "I'm here for Stage0 usage and public on-chain support, not internal code, repos, prompts, or infra details.",
      };
    case "ownership":
      return {
        allowed: false,
        code: "blocked_ownership",
        category,
        reason: productRedirect(),
      };
    case "politics":
      return {
        allowed: false,
        code: "blocked_politics",
        category,
        reason: "I'm staying out of politics. Ask me about Stage0 launches, NFTs, tokens, locks, airdrops, or RISE setup instead.",
      };
    case "scam":
      return {
        allowed: false,
        code: "handled_scam",
        category,
        reason: `Verify what matters on-chain. Check the connected wallet, route, contract address, and transactions in the app (${APP_URL}) and explorer.`,
      };
    case "off_topic":
      return {
        allowed: true,
        category,
        isOffTopic: true,
      };
  }
}

export function guardUserMessage(message: string): GuardrailResult {
  for (const rule of blockedInputRules) {
    if (rule.pattern.test(message)) {
      return handleHardBlock(rule.category);
    }
  }

  const inScope = stage0ScopeHints.some((pattern) => pattern.test(message));
  if (inScope) {
    return { allowed: true };
  }

  const obviousOffTopic = offTopicHintRules.some((pattern) => pattern.test(message));
  const looksGeneralPurpose = /\b(write|draft|summarize|explain|solve|fix|plan)\b/i.test(message);

  if (obviousOffTopic || looksGeneralPurpose) {
    return { allowed: true, isOffTopic: true, category: "off_topic" };
  }

  return { allowed: true };
}

const KNOWN_ACTION_TYPES = [
  "create_token",
  "create_nft",
  "create_presale",
  "lock_token",
  "airdrop_tokens",
  "buy_name",
  "open_launchpad",
  "open_dashboard",
  "open_route",
];

export interface OutputGuardResult {
  valid: boolean;
  reason?: string;
}

export function guardActionDraft(
  draft: { actionType?: string; targetRoute?: string; prefill?: unknown },
): OutputGuardResult {
  if (!draft.actionType) {
    return { valid: false, reason: "actionType missing" };
  }

  if (!KNOWN_ACTION_TYPES.includes(draft.actionType)) {
    return { valid: false, reason: `unknown actionType: ${draft.actionType}` };
  }

  if (!draft.targetRoute || typeof draft.targetRoute !== "string") {
    return { valid: false, reason: "targetRoute missing or invalid" };
  }

  if (!draft.targetRoute.startsWith("/")) {
    return { valid: false, reason: "targetRoute must start with /" };
  }

  if (draft.prefill !== undefined && draft.prefill !== null && typeof draft.prefill !== "object") {
    return { valid: false, reason: "prefill must be an object" };
  }

  return { valid: true };
}

const SELF_DESCRIPTION_PATTERNS: RegExp[] = [
  /\bkeep\s+it\s+simple\b/i,
  /\bshort\s+answers\b/i,
  /\btry\s+not\s+to\s+hallucinate\b/i,
  /\bnot\s+magic,?\s*just\s+organized\b/i,
  /\bdocs\s+first\b/i,
  /\bI\s+keep\s+(?:it|things|answers|jokes)\s+(?:simple|short|clean|brief|tight|focused|dry)\b/i,
  /\bI\s+(?:won'?t|don'?t)\s+pretend\b/i,
  /\bI\s+(?:try\s+to|aim\s+to|like\s+to)\s+(?:keep|stay|be)\s+(?:simple|short|clear|concise|grounded|honest|direct|brief|tight)\b/i,
  /\bI'?m\s+(?:friendly|grounded|simple|concise|direct|blunt|witty|dry|organized|here\s+to\s+keep)\s*[,.]/i,
];

export function stripSelfDescription(content: string): string {
  const sentences = content.match(/[^.!?\n]+[.!?\n]?/g);
  if (!sentences) return content;

  const kept = sentences.filter((sentence) => {
    return !SELF_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(sentence));
  });

  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

const VENDOR_LEAK_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /\bDeepSeek\b/gi, replace: "" },
  { pattern: /\bdeepseek[-_][a-z0-9-]+/gi, replace: "" },
  { pattern: /\bOpenAI\b/gi, replace: "" },
  { pattern: /\bGPT[-\s]?\d+(?:\.\d+)?\b/gi, replace: "" },
  { pattern: /\bClaude\b/gi, replace: "" },
  { pattern: /\bAnthropic\b/gi, replace: "" },
];

export function stripVendorMentions(content: string): string {
  let out = content;
  for (const { pattern, replace } of VENDOR_LEAK_PATTERNS) {
    out = out.replace(pattern, replace);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function guardAssistantOutput(content: string): OutputGuardResult {
  const suspicious = [
    /api\s*key/i,
    /\b\.env\b/i,
    /private\s*key/i,
    /seed\s*phrase/i,
    /github/i,
    /codebase/i,
  ];

  for (const pattern of suspicious) {
    if (pattern.test(content)) {
      return { valid: false, reason: "output contains restricted internal or secret content" };
    }
  }

  const denialPatterns = [
    /as\s+an\s+AI\s+language\s+model/i,
    /I\s+cannot\s+(?:assist|help|provide)/i,
  ];

  const denialCount = denialPatterns.filter((pattern) => pattern.test(content)).length;
  if (denialCount >= 2) {
    return { valid: false, reason: "output contains excessive AI-denial language" };
  }

  return { valid: true };
}

const COMMON_WORDS = new Set([
  "i","a","an","the","is","am","are","was","were","be","being","been","to","of","in","on","at","for","with","by","from","as","or","and","but","if","then","so","not","no","yes","you","your","my","me","mine","we","our","us","they","their","them","it","its","this","that","these","those","there","here","what","when","where","why","how","who","which","do","does","did","done","have","has","had","can","could","should","would","will","want","need","like","try","let","help","please","ok","okay","yeah","yep","sure","thanks","hi","hello","hey","gm",
  "stage0","stage","rise","testnet","token","tokens","nft","nfts","airdrop","airdrops","lock","locks","locker","launch","launchpad","presale","presales","domain","domains","name","names","wallet","wallets","dashboard","explorer","tx","hash","contract","address","symbol","decimals","supply","mint","mintable","burnable","plain","taxable","standard","erc20","erc721","metamask","rainbow","walletconnect","coinbase","price","quote",
  "create","make","deploy","setup","set","up","start","open","go","show","navigate","check","verify","fix","review","sign","send","buy","claim","register",
]);

const NUMBER_OR_HEX = /^(?:\d+(?:\.\d+)?|0x[a-fA-F0-9]{2,}|[a-zA-Z]{1,2}\d+)$/;

/**
 * Returns true if a user message looks too garbled to reasonably interpret.
 * "Garbled" = no recognizable English keyword tokens, dominated by filler/repeats.
 * Single short typos like "creat" or "tken" should still pass through here so the LLM can handle them.
 */
export function looksUnreadable(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 2) return true;

  const tokens = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return true;

  if (tokens.length === 1) {
    const only = tokens[0];
    // Single token that's not a word and not obviously a number/address = garbled.
    return only.length > 0 && !COMMON_WORDS.has(only) && !NUMBER_OR_HEX.test(only) && only.length > 16;
  }

  const meaningful = tokens.filter((tok) => COMMON_WORDS.has(tok) || NUMBER_OR_HEX.test(tok));
  const ratio = meaningful.length / tokens.length;

  // If essentially no recognizable tokens and message is long, ask to rephrase.
  return ratio < 0.15 && tokens.length >= 5;
}
