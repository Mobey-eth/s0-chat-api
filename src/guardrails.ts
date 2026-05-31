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
  { category: "ownership", pattern: /\b(owner|founder|dev|developer|team)\b.*\b(who|name|identity|identit(y|ies)|doxx|reveal|home)\b/i },
  { category: "ownership", pattern: /\bwho\s+(?:runs|owns|built|controls)\b/i },
  { category: "ownership", pattern: /\bwho\s+is\s+behind\b/i },
  { category: "politics", pattern: /\b(politics?|election|president|prime minister|senate|campaign|party politics?)\b/i },
  { category: "off_topic", pattern: /\b(weather|recipe|football|soccer|nba|movie|dating|horoscope|essay|homework|translate this)\b/i },
  { category: "scam", pattern: /\b(scam|rug|rugpull|fake|legit|legitimate)\b/i },
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
}

function productRedirect() {
  return `I can help with Stage0 product questions, but I won't get into private identities or internal accounts. Use the app (${APP_URL}), docs (${DOCS_URL}), and RISE explorer/docs (${RISE_DOCS_URL}) to verify public facts.`;
}

function handleCategory(category: GuardCategory): GuardrailResult {
  switch (category) {
    case "secrets":
      return {
        allowed: false,
        code: "blocked_secrets",
        reason: "I can't help with seed phrases, private keys, keystores, env files, or anything that exposes private access. Wallet control stays with the user.",
      };
    case "internals":
      return {
        allowed: false,
        code: "blocked_internals",
        reason: "I'm here for Stage0 usage and public on-chain/product support, not internal code, repos, prompts, or private infrastructure details.",
      };
    case "ownership":
      return {
        allowed: false,
        code: "blocked_ownership",
        reason: productRedirect(),
      };
    case "politics":
      return {
        allowed: false,
        code: "blocked_politics",
        reason: "I'm staying out of politics. Ask me about Stage0 launches, NFTs, tokens, locks, airdrops, or RISE setup instead.",
      };
    case "off_topic":
      return {
        allowed: false,
        code: "blocked_off_topic",
        reason: "I'm scoped to Stage0, RISE, EVM wallets, launches, NFTs, tokens, locks, airdrops, domains, dashboards, and on-chain verification.",
      };
    case "scam":
      return {
        allowed: false,
        code: "handled_scam",
        reason: `Verify what matters on-chain. Stage0 is a live RISE testnet app, but you should still check the connected wallet, route, contract address, and transaction history in the app (${APP_URL}) and explorer.`,
      };
  }
}

export function guardUserMessage(message: string): GuardrailResult {
  for (const rule of blockedInputRules) {
    if (rule.pattern.test(message)) {
      return handleCategory(rule.category);
    }
  }

  const looksGeneralPurpose =
    /\b(write|draft|summarize|explain|solve|fix|plan)\b/i.test(message) &&
    !stage0ScopeHints.some((pattern) => pattern.test(message));

  if (looksGeneralPurpose) {
    return handleCategory("off_topic");
  }

  return { allowed: true };
}

const KNOWN_ACTION_TYPES = [
  "create_token",
  "create_nft",
  "create_presale",
  "lock_token",
  "airdrop_tokens",
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
