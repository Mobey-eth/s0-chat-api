import { config } from "../config.js";

export interface Stage0ContractAddresses {
  tokenLocker: string;
  nftFactory: string;
  nftFactoryLens: string;
  presaleFactory: string;
  tokenFactory: string;
  airdropMultisender: string;
}

export interface Stage0SupportLinks {
  x: string;
  discord: string;
}

export interface Stage0Facts {
  appUrl: string;
  docsUrl: string;
  supportLinks: Stage0SupportLinks;
  networkName: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: string;
  faucetUrl: string;
  contracts: Stage0ContractAddresses;
  publicRoutes: string[];
  walletRoutes: string[];
  adminRoutes: string[];
}

const STAGE0_CONTRACTS: Stage0ContractAddresses = {
  tokenLocker: "0x1A93972280714AB50115Ee839C8861CB37A0Ec61",
  nftFactory: "0x40Dc4C9655f6273803E0C5F049cFdB1Db026486B",
  nftFactoryLens: "0xa0b761A94013FF721fD682eEB7e57709C0e03f42",
  presaleFactory: "0x8DB306030Cf163A6C809fB3599500DBE28Df2CC6",
  tokenFactory: "0x80046108E1292E5d142BCbfaaC47069348AaBDe8",
  airdropMultisender: "0xDB7C570a0489cd0aab0B24816FEF06Acc4Fc01E8",
};

export function getStage0Facts(): Stage0Facts {
  return {
    appUrl: config.stage0AppUrl,
    docsUrl: config.docsBaseUrl,
    supportLinks: {
      x: config.stage0XUrl,
      discord: config.stage0DiscordUrl,
    },
    networkName: "RISE Mainnet",
    chainId: config.riseChainId,
    rpcUrl: config.riseRpcUrl,
    explorerUrl: config.riseExplorerUrl,
    nativeCurrency: "ETH",
    faucetUrl: "No faucet (mainnet)",
    contracts: STAGE0_CONTRACTS,
    publicRoutes: ["/", "/presales", "/presales/:address", "/nfts/:address"],
    walletRoutes: [
      "/dashboard",
      "/tools",
      "/create/nft",
      "/domains",
      "/create/token",
      "/create/presale",
      "/tools/token-locker",
      "/tools/airdrop",
      "/nfts/manage/:address",
      "/presales/manage/:address",
      "/project/:address",
      "/tokens",
      "/my-nfts",
      "/locks/:id",
    ],
    adminRoutes: ["/admin", "/admin/presales"],
  };
}

export function extractTxHashFromText(message: string) {
  const match = message.match(/\b0x[a-fA-F0-9]{64}\b/);
  return match?.[0] ?? null;
}

export function buildExplorerTxUrl(txHash: string) {
  return `${config.riseExplorerUrl}/tx/${txHash}`;
}

export function buildExplorerAddressUrl(address: string) {
  return `${config.riseExplorerUrl}/address/${address}`;
}

export function buildStage0ContextBlock(): string {
  const facts = getStage0Facts();

  return [
    "Stage0 and RISE context (do not fabricate different values):",
    `Stage0 app: ${facts.appUrl}`,
    `Stage0 docs: ${facts.docsUrl}`,
    `Stage0 X/support: ${facts.supportLinks.x}`,
    `Stage0 Discord/support: ${facts.supportLinks.discord}`,
    `Network: ${facts.networkName}`,
    `Chain ID: ${facts.chainId}`,
    `RPC URL: ${facts.rpcUrl}`,
    `Explorer: ${facts.explorerUrl}`,
    `Native currency: ${facts.nativeCurrency}`,
    `Faucet: ${facts.faucetUrl}`,
    "RISE is EVM-compatible. Users connect with EVM wallets and sign transactions in the app.",
    "Stage0 supports token launches, NFT drops, token locking, airdrops/multisend, launch browsing, dashboards, and names/domains.",
    "Stage0 public routes: " + facts.publicRoutes.join(", "),
    "Stage0 wallet routes: " + facts.walletRoutes.join(", "),
    "Stage0 admin control routes: " + facts.adminRoutes.join(", "),
    `Token factory: ${facts.contracts.tokenFactory}`,
    `NFT factory: ${facts.contracts.nftFactory}`,
    `NFT factory lens: ${facts.contracts.nftFactoryLens}`,
    `Presale factory: ${facts.contracts.presaleFactory}`,
    `Token locker: ${facts.contracts.tokenLocker}`,
    `Airdrop multisender: ${facts.contracts.airdropMultisender}`,
  ].filter(Boolean).join("\n");
}
