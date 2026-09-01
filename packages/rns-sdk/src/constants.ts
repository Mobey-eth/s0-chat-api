import { defineChain } from "viem";

export const RISE_MAINNET_CHAIN_ID = 4_153 as const;
export const STAGE0_RNS_API_URL = "https://rns.stage0.xyz/v1" as const;

export const riseMainnet = defineChain({
  id: RISE_MAINNET_CHAIN_ID,
  name: "RISE Mainnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.risechain.com"] },
  },
  blockExplorers: {
    default: { name: "RISE Explorer", url: "https://explorer.risechain.com" },
  },
});

export const rnsContracts = {
  registry: "0x6DDca710993C91402d52061868bE76043a4C5888",
  resolver: "0x36D6383774631565AB0D8F3710748610631A675d",
  registrar: "0xbCA437a93C2E7396a68Ce49BE224F65eE3CFd6Db",
  auctionHouse: "0x0E37994c19980A792B83A106cE03a9b8a9cD40Fc",
  marketplace: "0x323A04F474f80225DE60C1Af13a672796aFA6622",
} as const;
