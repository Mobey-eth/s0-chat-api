import { config } from "../config.js";

export interface Stage0ContractAddresses {
  tokenLocker: string;
  nftFactory: string;
  nftFactoryLens: string;
  presaleFactory: string;
  tokenFactory: string;
  airdropMultisender: string;
}

export interface Stage0Facts {
  appUrl: string;
  docsUrl: string;
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
  tokenLocker: "0xb225cb8Ea90E0ab1F9f5011d31fD217083c31fc7",
  nftFactory: "0xCEA1A715927408216B838DcAcd90Dff025Ab0b2D",
  nftFactoryLens: "0x5F52461ac88ea4a9095A2eD82743Df17E1a1c1af",
  presaleFactory: "0x67064a9236050D3d947d7F5Bd3448BD4b5D947FC",
  tokenFactory: "0xa0b761A94013FF721fD682eEB7e57709C0e03f42",
  airdropMultisender: "0x8DB306030Cf163A6C809fB3599500DBE28Df2CC6",
};

export function getStage0Facts(): Stage0Facts {
  return {
    appUrl: config.stage0AppUrl,
    docsUrl: config.docsBaseUrl,
    networkName: "RISE Testnet",
    chainId: config.riseTestnetChainId,
    rpcUrl: config.riseTestnetRpcUrl,
    explorerUrl: config.riseTestnetExplorerUrl,
    nativeCurrency: "ETH",
    faucetUrl: "https://faucet.testnet.riselabs.xyz",
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
    adminRoutes: [
      "/admin",
      "/admin/presales",
      "/admin/whitelist",
    ],
  };
}

export function extractTxHashFromText(message: string) {
  const match = message.match(/\b0x[a-fA-F0-9]{64}\b/);
  return match?.[0] ?? null;
}

export function buildExplorerTxUrl(txHash: string) {
  return `${config.riseTestnetExplorerUrl}/tx/${txHash}`;
}

export function buildExplorerAddressUrl(address: string) {
  return `${config.riseTestnetExplorerUrl}/address/${address}`;
}

export function buildStage0ContextBlock(): string {
  const facts = getStage0Facts();

  return [
    "Stage0 and RISE context (do not fabricate different values):",
    `Stage0 app: ${facts.appUrl}`,
    `Stage0 docs: ${facts.docsUrl}`,
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
  ].join("\n");
}
