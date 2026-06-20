import { randomBytes } from "node:crypto";
import { formatEther, getAddress, keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { normalizeRnsLabel } from "./service.js";

const YEAR_SECONDS = 365n * 24n * 60n * 60n;
const WEI_PER_ETH = 1_000_000_000_000_000_000n;
const MICROS_PER_USD = 1_000_000n;

const quoteActionIds = {
  register: 0,
  renew: 1,
} as const;

export type RnsQuoteAction = keyof typeof quoteActionIds;

let ethUsdCache:
  | {
      priceMicros: bigint;
      priceUsd: number;
      fetchedAt: number;
    }
  | null = null;

export function usdCentsPerYearForLabel(label: string) {
  if (label.length === 3) return 6_000;
  if (label.length === 4) return 1_500;
  return 500;
}

function yearsForDuration(durationSeconds: bigint) {
  return (durationSeconds + YEAR_SECONDS - 1n) / YEAR_SECONDS;
}

function usdLabel(cents: bigint | number) {
  return (Number(cents) / 100).toFixed(2);
}

function priceMultiplierBpsForYears(years: bigint) {
  if (years >= 5n) return 8_500;
  if (years >= 3n) return 9_000;
  if (years >= 2n) return 9_500;
  return 10_000;
}

function applyMultiplier(cents: bigint, multiplierBps: number) {
  return (cents * BigInt(multiplierBps)) / 10_000n;
}

function pricingDisplay(input: {
  usdCentsPerYear: number;
  years: bigint;
}) {
  const subtotalUsdCents = BigInt(input.usdCentsPerYear) * input.years;
  const priceMultiplierBps = priceMultiplierBpsForYears(input.years);
  const discountBps = 10_000 - priceMultiplierBps;
  const totalUsdCents = applyMultiplier(subtotalUsdCents, priceMultiplierBps);
  const discountUsdCents = subtotalUsdCents - totalUsdCents;

  return {
    subtotalUsdCents,
    subtotalUsd: usdLabel(subtotalUsdCents),
    priceMultiplierBps,
    discountBps,
    discountPercent: (discountBps / 100).toFixed(discountBps % 100 === 0 ? 0 : 2),
    discountUsdCents,
    discountUsd: usdLabel(discountUsdCents),
    totalUsdCents,
    totalUsd: usdLabel(totalUsdCents),
  };
}

function parseEthUsdMicros(payload: unknown) {
  const price =
    payload &&
    typeof payload === "object" &&
    "ethereum" in payload &&
    payload.ethereum &&
    typeof payload.ethereum === "object" &&
    "usd" in payload.ethereum
      ? Number(payload.ethereum.usd)
      : NaN;

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid ETH/USD price response");
  }

  return {
    priceUsd: price,
    priceMicros: BigInt(Math.round(price * Number(MICROS_PER_USD))),
  };
}

export async function getEthUsdPrice() {
  const now = Date.now();
  if (ethUsdCache && now - ethUsdCache.fetchedAt < config.rnsPriceSourceRefreshIntervalMs) {
    return ethUsdCache;
  }

  const response = await fetch(config.rnsPriceSourceUrl, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`ETH/USD source returned HTTP ${response.status}`);
  }

  const parsed = parseEthUsdMicros(await response.json());
  ethUsdCache = {
    ...parsed,
    fetchedAt: now,
  };
  return ethUsdCache;
}

export async function getRnsPricingSummary(input?: {
  name?: string;
  durationSeconds?: bigint;
}) {
  const ethUsd = await getEthUsdPrice();
  const label = input?.name ? normalizeRnsLabel(input.name) : null;
  const duration = input?.durationSeconds && input.durationSeconds > 0n ? input.durationSeconds : YEAR_SECONDS;
  const years = yearsForDuration(duration);
  const usdCentsPerYear = label ? usdCentsPerYearForLabel(label) : null;
  const display = usdCentsPerYear === null ? null : pricingDisplay({ usdCentsPerYear, years });
  const priceWei =
    display === null ? null : ((display.totalUsdCents * 10_000n) * WEI_PER_ETH) / ethUsd.priceMicros;

  return {
    chainId: config.riseTestnetChainId,
    ethUsd: ethUsd.priceUsd,
    priceFetchedAt: new Date(ethUsd.fetchedAt).toISOString(),
    multiYearPolicy: {
      type: "loyalty-discount",
      schedule: [
        { years: 1, priceMultiplierBps: 10_000, discountBps: 0 },
        { years: 2, priceMultiplierBps: 9_500, discountBps: 500 },
        { years: 3, priceMultiplierBps: 9_000, discountBps: 1_000 },
        { years: 5, priceMultiplierBps: 8_500, discountBps: 1_500 },
      ],
      description: "1 year is full price, 2 years is 5% off, 3-4 years is 10% off, and 5+ years is 15% off.",
    },
    tiers: [
      { label: "3 characters", minLength: 3, maxLength: 3, usdCentsPerYear: 6_000, usdPerYear: "60.00" },
      { label: "4 characters", minLength: 4, maxLength: 4, usdCentsPerYear: 1_500, usdPerYear: "15.00" },
      { label: "5+ characters", minLength: 5, maxLength: 32, usdCentsPerYear: 500, usdPerYear: "5.00" },
    ],
    estimate: label
      ? {
          label,
          name: `${label}.rise`,
          years: years.toString(),
          usdCentsPerYear,
          usdPerYear: usdLabel(usdCentsPerYear ?? 0),
          subtotalUsdCents: display?.subtotalUsdCents.toString() ?? null,
          subtotalUsd: display?.subtotalUsd ?? null,
          discountBps: display?.discountBps ?? 0,
          discountPercent: display?.discountPercent ?? "0",
          discountUsdCents: display?.discountUsdCents.toString() ?? null,
          discountUsd: display?.discountUsd ?? null,
          totalUsdCents: display?.totalUsdCents.toString() ?? null,
          totalUsd: display?.totalUsd ?? null,
          priceEth: priceWei === null ? null : formatEther(priceWei),
          priceWei: priceWei?.toString() ?? null,
        }
      : null,
  };
}

export async function buildRnsPriceQuote(input: {
  action: RnsQuoteAction;
  name: string;
  beneficiary: string;
  durationSeconds: bigint;
}) {
  if (!config.rnsPriceSignerPrivateKey) {
    throw new Error("RNS_PRICE_SIGNER_PRIVATE_KEY is not configured");
  }

  if (input.durationSeconds < YEAR_SECONDS) {
    throw new Error("Duration must be at least 365 days");
  }

  const label = normalizeRnsLabel(input.name);
  if (!label) {
    throw new Error("Invalid .rise name");
  }

  if (label.length < 3 && input.action === "register") {
    throw new Error("1-character and 2-character names are reserved");
  }

  const account = privateKeyToAccount(config.rnsPriceSignerPrivateKey as Hex);
  const beneficiary = getAddress(input.beneficiary);
  const duration = input.durationSeconds;
  const years = yearsForDuration(duration);
  const usdCentsPerYear = usdCentsPerYearForLabel(label);
  const display = pricingDisplay({ usdCentsPerYear, years });
  const ethUsd = await getEthUsdPrice();
  const priceUsdMicros = display.totalUsdCents * 10_000n;
  const priceWei = (priceUsdMicros * WEI_PER_ETH) / ethUsd.priceMicros;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + config.rnsPriceQuoteTtlSeconds);
  const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
  const labelHash = keccak256(stringToBytes(label));
  const action = quoteActionIds[input.action];

  const message = {
    action,
    labelHash,
    beneficiary,
    duration,
    priceWei,
    deadline,
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: "Stage0 RNS Registrar",
      version: "2",
      chainId: config.riseTestnetChainId,
      verifyingContract: config.rnsContracts.registrar as Hex,
    },
    types: {
      PriceQuote: [
        { name: "action", type: "uint8" },
        { name: "labelHash", type: "bytes32" },
        { name: "beneficiary", type: "address" },
        { name: "duration", type: "uint256" },
        { name: "priceWei", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "PriceQuote",
    message,
  });

  return {
    chainId: config.riseTestnetChainId,
    registrar: config.rnsContracts.registrar,
    label,
    name: `${label}.rise`,
    action: input.action,
    quote: {
      action,
      labelHash,
      beneficiary: beneficiary.toLowerCase(),
      duration: duration.toString(),
      priceWei: priceWei.toString(),
      deadline: deadline.toString(),
      nonce,
    },
    signature,
    display: {
      years: years.toString(),
      usdCentsPerYear,
      subtotalUsdCents: display.subtotalUsdCents.toString(),
      subtotalUsd: display.subtotalUsd,
      priceMultiplierBps: display.priceMultiplierBps,
      discountBps: display.discountBps,
      discountPercent: display.discountPercent,
      discountUsdCents: display.discountUsdCents.toString(),
      discountUsd: display.discountUsd,
      totalUsdCents: display.totalUsdCents.toString(),
      totalUsd: display.totalUsd,
      ethUsd: ethUsd.priceUsd,
      priceEth: formatEther(priceWei),
      priceWei: priceWei.toString(),
      quoteExpiresAt: new Date(Number(deadline) * 1000).toISOString(),
      priceFetchedAt: new Date(ethUsd.fetchedAt).toISOString(),
    },
  };
}
