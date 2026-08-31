export const ACTION_TYPES = [
  "create_token",
  "create_nft",
  "create_presale",
  "lock_token",
  "airdrop_tokens",
  "buy_name",
  "open_launchpad",
  "open_dashboard",
  "open_route",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export interface ActionDraft {
  actionType: ActionType;
  targetRoute: string;
  requiredWallet: "evm" | null;
  requiredChain: "rise_mainnet" | null;
  prefill: Record<string, string>;
  summary: string;
  warnings: string[];
  missingFields: string[];
  nextSteps: string[];
}
