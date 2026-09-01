import { getAddress, verifyMessage, type Hex } from "viem";
import { config } from "./config.js";

const SIGNATURE_MAX_AGE_MS = 10 * 60 * 1_000;

export type CreatorApplicationType = "nft" | "presale";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isFreshTimestamp(timestamp: number) {
  const ageMs = Date.now() - timestamp;
  return ageMs >= -30_000 && ageMs <= SIGNATURE_MAX_AGE_MS;
}

export function buildCreatorApplicationAuthorizationMessage(input: {
  chainId: number;
  timestamp: number;
  payload: unknown;
}) {
  return [
    "Stage0 creator application",
    `Network: ${config.riseNetworkName} (${input.chainId})`,
    `Timestamp: ${input.timestamp}`,
    `Payload: ${stableJson(input.payload)}`,
  ].join("\n");
}

export function buildCreatorAdminSessionMessage(input: {
  chainId: number;
  adminAddress: string;
  challengeId: string;
  nonce: string;
  expiresAt: string;
}) {
  return [
    "Stage0 creator admin session",
    `Network: ${config.riseNetworkName} (${input.chainId})`,
    `Admin: ${input.adminAddress.toLowerCase()}`,
    `Challenge: ${input.challengeId}`,
    `Nonce: ${input.nonce.toLowerCase()}`,
    `Expires: ${input.expiresAt}`,
    "Purpose: Review and manage private creator applications",
    "This is an off-chain signature. It does not submit a transaction or cost gas.",
  ].join("\n");
}

export async function verifyCreatorApplicationAuthorization(input: {
  chainId: number;
  timestamp: number;
  address: string;
  signature: Hex;
  payload: unknown;
}) {
  if (!isFreshTimestamp(input.timestamp)) return false;

  let address: `0x${string}`;
  try {
    address = getAddress(input.address);
  } catch {
    return false;
  }

  return verifyMessage({
    address,
    message: buildCreatorApplicationAuthorizationMessage(input),
    signature: input.signature,
  });
}

export async function verifyCreatorAdminSessionAuthorization(input: {
  chainId: number;
  adminAddress: string;
  challengeId: string;
  nonce: string;
  expiresAt: string;
  signature: Hex;
}) {
  let address: `0x${string}`;
  try {
    address = getAddress(input.adminAddress);
  } catch {
    return false;
  }

  if (address.toLowerCase() !== config.creatorAdminAddress) return false;

  return verifyMessage({
    address,
    message: buildCreatorAdminSessionMessage({ ...input, adminAddress: address }),
    signature: input.signature,
  });
}
