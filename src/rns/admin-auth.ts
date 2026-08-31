import { getAddress, verifyMessage, type Hex } from "viem";
import { config } from "../config.js";

const ADMIN_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1_000;
const RISE_TESTNET_CHAIN_ID = 11_155_931;

export type RnsAdminAction = "upsert_reserved";

function getRnsAdminNetworkName(chainId: number) {
  if (chainId === config.riseChainId) return config.riseNetworkName;
  if (chainId === RISE_TESTNET_CHAIN_ID) return "RISE Testnet";
  return "RISE";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function buildRnsAdminAuthorizationMessage(input: {
  action: RnsAdminAction;
  chainId: number;
  timestamp: number;
  payload: unknown;
}) {
  return [
    "Stage0 RNS admin authorization",
    `Network: ${getRnsAdminNetworkName(input.chainId)} (${input.chainId})`,
    `Action: ${input.action}`,
    `Timestamp: ${input.timestamp}`,
    `Payload: ${stableJson(input.payload)}`,
  ].join("\n");
}

export async function verifyRnsAdminAuthorization(input: {
  action: RnsAdminAction;
  chainId: number;
  timestamp: number;
  address: string;
  signature: Hex;
  payload: unknown;
}) {
  const ageMs = Date.now() - input.timestamp;
  if (ageMs < -30_000 || ageMs > ADMIN_SIGNATURE_MAX_AGE_MS) return false;

  let address: `0x${string}`;
  try {
    address = getAddress(input.address);
  } catch {
    return false;
  }

  if (address.toLowerCase() !== config.rnsAdminAddress) return false;

  return verifyMessage({
    address,
    message: buildRnsAdminAuthorizationMessage(input),
    signature: input.signature,
  });
}
